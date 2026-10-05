"""
BadgeDB bot — runs on a schedule (GitHub Actions), compares Twitch's global
badge list with badges.json, and for every NEW badge:
  1. posts to X (@BadgeDatabase) with the badge image
  2. (optional) posts to a Discord webhook
  3. appends the badge to badges.json so the website updates too

Environment variables (set as GitHub Secrets):
  TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
  X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
  DISCORD_WEBHOOK   (optional)
  SITE_URL          (optional, e.g. https://badgedb.hu — only used in Discord,
                     NOT in X posts, because posts containing links cost more)
"""
import json, os, sys, io, datetime, requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
DB = os.path.join(ROOT, "badges.json")
MAX_POSTS_PER_RUN = 5          # safety valve so one bad run can't burn credits
import re
# Twitch internal / placeholder sets that should be saved but never announced
JUNK = re.compile(r"beta_title|_beta$|^beta$|placeholder|default-creator-campaign", re.I)
def is_junk(b): return bool(JUNK.search(b["set"]) or JUNK.search(b["title"]))
DRY_RUN = os.environ.get("DRY_RUN") == "1"

# ---------- Twitch ----------
def twitch_global_badges():
    r = requests.post("https://id.twitch.tv/oauth2/token", params={
        "client_id": os.environ["TWITCH_CLIENT_ID"],
        "client_secret": os.environ["TWITCH_CLIENT_SECRET"],
        "grant_type": "client_credentials"}, timeout=30)
    r.raise_for_status()
    token = r.json()["access_token"]
    r = requests.get("https://api.twitch.tv/helix/chat/badges/global", headers={
        "Client-Id": os.environ["TWITCH_CLIENT_ID"],
        "Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    out = []
    for s in r.json()["data"]:
        for v in s["versions"]:
            img_id = v["image_url_4x"].split("/badges/v1/")[1].split("/")[0]
            title = v.get("title") or s["set_id"].replace("-", " ").replace("_", " ").title()
            out.append({"set": s["set_id"], "version": v["id"], "title": title,
                        "img": img_id, "url": v["image_url_4x"],
                        "desc": v.get("description", "")})
    return out

# ---------- events.json: timeline entries, kept in sync with Twitch's own badge descriptions ----------
PLACEHOLDER_HOW = {"", "objective not announced yet.", "objective not confirmed yet."}
def is_placeholder_how(h):
    h = (h or "").strip().lower()
    return h in PLACEHOLDER_HOW or h.startswith("watch in the category (exact time") or h.startswith("this badge was")

def slugify(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:48] or "badge"

def parse_desc(desc):
    """Turn Twitch's badge description into structured info.
    e.g. 'This badge was earned by watching a streamer in the CONTROL Resonant category for 1 hour'
         -> {category: 'CONTROL Resonant', cost: 'free', how: 'Watch 60 minutes in the category.'}"""
    d = (desc or "").strip(); low = d.lower(); out = {}
    if not d: return out
    m = re.search(r"in the (.+?) category", d, re.I)
    if m: out["category"] = m.group(1).strip()
    mins = None
    m = re.search(r"for (\d+)\s*(hours?|minutes?|mins?)", low)
    if m: mins = int(m.group(1)) * (60 if m.group(2).startswith("hour") else 1)
    elif re.search(r"for (an|one) hour", low): mins = 60
    where = " in the category" if "category" in out else ""
    if re.search(r"subscrib|gift", low):
        out["cost"] = "paid"; out["how"] = f"Subscribe (Tier 1) or gift a Tier 1 sub{where}."
    elif "watch" in low:
        out["cost"] = "free"; out["how"] = (f"Watch {mins} minutes{where}." if mins else f"Watch a stream{where}.")
    elif re.search(r"cheer|bits", low):
        out["cost"] = "paid"; out["how"] = "Cheer Bits in a participating channel."
    m = re.search(r"(?:on|watching|to)\s+([A-Za-z0-9_]{3,25})(?:'s)?\s+channel", d)
    if m: out["channel"] = m.group(1)
    return out

_STOP = {"badge", "twitch", "elden", "ring", "the", "and", "launch", "event", "edition", "season", "supporter"}
def _words(t): return {w for w in re.findall(r"[a-z0-9]+", (t or "").lower()) if len(w) >= 4 and w not in _STOP}

def resolve_placeholders(events, title_to_img):
    """Badges entered before Twitch published them have no image. Link them to the real badge by name,
    or drop them once a real badge with a clearly matching name has joined the same event."""
    fixed = 0
    for ev in events:
        real = [b for b in ev.get("badges", []) if b.get("img")]
        keep = []
        for b in ev.get("badges", []):
            if b.get("img"): keep.append(b); continue
            img = title_to_img.get(_norm(b.get("name")))
            if img:
                if any(r["img"] == img for r in real): fixed += 1; continue          # already there -> drop the duplicate
                b["img"] = img; keep.append(b); fixed += 1; continue
            common = [w for r in real for w in _words(b.get("name")) & _words(r.get("name"))]
            if len(set(common)) >= 2 or any(len(w) >= 6 for w in common):
                fixed += 1; continue                                                # e.g. "Festering Bloody Finger" -> "Bloody Finger ELDEN RING"
            keep.append(b)
        ev["badges"] = keep
    return fixed

def load_events():
    try: return json.load(open(EV_DB, encoding="utf-8"))
    except Exception: return []

def save_events(events):
    json.dump(events, open(EV_DB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def sync_events(desc_by_img, new_sets, title_to_img=None):
    """1) Fill placeholder fields of existing events from Twitch descriptions (never overwrites manual edits).
       2) Put newly discovered badge sets on the timeline, grouped by category / merged into a matching open event."""
    events = load_events(); changed = 0
    for ev in events:
        for b in ev.get("badges", []):
            desc = desc_by_img.get(b.get("img") or "")
            if not desc: continue
            info = parse_desc(desc)
            if desc != b.get("desc"): b["desc"] = desc; changed += 1
            if info.get("how") and is_placeholder_how(b.get("how")): b["how"] = info["how"]; changed += 1
            if info.get("cost") and b.get("cost") in (None, "", "na"): b["cost"] = info["cost"]; changed += 1
            if info.get("category") and ev.get("category") in (None, "", "Unknown"):
                ev["category"] = info["category"]; changed += 1
            if info.get("channel") and not ev.get("channel"): ev["channel"] = info["channel"]; changed += 1

    known_imgs = {b.get("img") for e in events for b in e.get("badges", [])}
    ids = {e["id"] for e in events}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    def open_event_for(cat):
        for e in events:
            if (e.get("category") or "").lower() != cat.lower(): continue
            if e.get("end") and e["end"] < now: continue          # already over
            return e
        return None
    added = 0
    for b in new_sets:
        if b["img"] in known_imgs: continue
        info = parse_desc(b.get("desc"))
        badge = {"name": b["title"], "img": b["img"], "how": info.get("how") or "Objective not announced yet.",
                 "cost": info.get("cost") or "na"}
        if b.get("desc"): badge["desc"] = b["desc"]
        cat = info.get("category")
        target = open_event_for(cat) if cat else None
        if target:
            target["badges"].append(badge)
        else:
            eid = slugify(cat or b["set"] or b["title"])
            while eid in ids: eid += "-2"
            ids.add(eid)
            ev = {"id": eid, "name": cat or b["title"], "category": cat or "Unknown", "start": "", "end": "", "badges": [badge]}
            if info.get("channel"): ev["channel"] = info["channel"]
            events.insert(0, ev)
        known_imgs.add(b["img"]); added += 1
    linked = resolve_placeholders(events, title_to_img or {})
    if changed or added or linked:
        save_events(events)
        print(f"events.json: {added} new badge(s) on the timeline, {changed} field(s) filled from Twitch descriptions, {linked} placeholder(s) resolved")


# ---------- Twitch reward campaigns: dates, category, objective ----------
# The official Helix API has no start/end dates for badge rewards. twitch.tv itself loads them
# (Drops & Rewards page) from its internal GraphQL API — unofficial, may change without notice.
# Everything here is best-effort: if it fails, the rest of the bot keeps working.
GQL_CLIENT_ID = os.environ.get("TWITCH_GQL_CLIENT_ID") or "kimne78kx3ncx6brgo4mv6wki5h1ko"
GQL_OAUTH = (os.environ.get("TWITCH_GQL_OAUTH") or "").strip().removeprefix("OAuth ").strip()
GQL_HASH = os.environ.get("TWITCH_GQL_HASH") or "5a4da2ab3d5b47c9f9ce864e727b2cb346af1e3ea8b897fe8f704a97ff017619"
REWARD_QUERY = """query BadgeDBRewardCampaigns {
  rewardCampaignsAvailableToUser {
    id name brand startsAt endsAt status summary instructions externalURL aboutURL isSitewide
    game { id name displayName }
    unlockRequirements { subsGoal minuteWatchedGoal }
    rewards { id name earnableUntil bannerImage { image1xURL } thumbnailImage { image1xURL } }
  }
}"""

def fetch_reward_campaigns():
    if not GQL_OAUTH:
        print("twitch campaigns: skipped — add the TWITCH_GQL_OAUTH secret (a Twitch login token) to enable automatic dates")
        return []
    headers = {"Client-Id": GQL_CLIENT_ID, "Authorization": f"OAuth {GQL_OAUTH}", "Content-Type": "text/plain;charset=UTF-8",
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"}
    attempts = [
        {"operationName": "BadgeDBRewardCampaigns", "query": REWARD_QUERY, "variables": {}},
        {"operationName": "ViewerDropsDashboard", "variables": {"fetchRewardCampaigns": True},
         "extensions": {"persistedQuery": {"version": 1, "sha256Hash": GQL_HASH}}},
    ]
    for body in attempts:
        try:
            r = requests.post("https://gql.twitch.tv/gql", json=body, headers=headers, timeout=30)
            j = r.json()
            if isinstance(j, list): j = j[0] if j else {}
            camps = ((j or {}).get("data") or {}).get("rewardCampaignsAvailableToUser")
            if camps is not None:
                print(f"twitch campaigns: {len(camps)} found via {body['operationName']}")
                for c in camps[:40]:
                    print(f"   - {c.get('name')} | {c.get('startsAt')} -> {c.get('endsAt')} | rewards: {[x.get('name') for x in c.get('rewards') or []]}")
                return camps
            err = str((j or {}).get('errors') or j)
            print(f"twitch campaigns: {body['operationName']} gave no data -> {err[:300]}")
            if "unauthenticated" in err.lower() or "401" in err:
                print("twitch campaigns: the TWITCH_GQL_OAUTH token was rejected — it may have expired (log out = token invalid). Copy a fresh auth-token.")
                return []
        except Exception as e:
            print(f"twitch campaigns: {body['operationName']} failed -> {e}")
    return []

def _norm(t): return re.sub(r"[^a-z0-9]+", "", (t or "").lower())

def _iso(t):
    if not t: return ""
    try: return datetime.datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception: return ""

def _how_from(c):
    req = c.get("unlockRequirements") or {}
    where = " in the category" if (c.get("game") and not c.get("isSitewide")) else ""
    subs, mins = req.get("subsGoal") or 0, req.get("minuteWatchedGoal") or 0
    if subs:
        return ("paid", f"Subscribe (Tier 1) or gift a Tier 1 sub{where}." if subs == 1 else f"Subscribe or gift {subs} subs{where}.")
    if mins:
        return ("free", f"Watch {mins} minutes{where}.")
    return (None, None)

def apply_campaigns(rows):
    """Match Twitch reward campaigns to our badges and fill dates/objective/category.
    Fields you edited in the admin page are marked *_src='manual' and are never overwritten."""
    camps = fetch_reward_campaigns()
    if not camps: return
    events = load_events()
    title_of = {r[1]: r[0] for r in rows}
    by_title = {}
    for r in rows: by_title.setdefault(_norm(r[0]), r[1])
    ev_of = {}
    for ev in events:
        for b in ev.get("badges", []):
            if b.get("img"): ev_of[b["img"]] = ev
    ids = {e["id"] for e in events}
    matched = changed = created = 0
    for c in camps:
        imgs = []
        for rw in c.get("rewards") or []:
            urls = " ".join(filter(None, [(rw.get("thumbnailImage") or {}).get("image1xURL"), (rw.get("bannerImage") or {}).get("image1xURL")]))
            hit = next((u for u in re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", urls) if u in title_of), None)
            if not hit:
                n = _norm(rw.get("name"))
                hit = by_title.get(n) or next((img for t, img in by_title.items() if len(t) >= 5 and (t == n or (len(n) >= 5 and (t in n or n in t)))), None)
            if hit and hit not in imgs: imgs.append(hit)
        if not imgs: continue
        matched += 1
        start, end = _iso(c.get("startsAt")), _iso(c.get("endsAt"))
        cat = ((c.get("game") or {}).get("displayName") or "").strip()
        cost, how = _how_from(c)
        ev = next((ev_of[i] for i in imgs if i in ev_of), None)
        if not ev:
            eid = slugify(c.get("name") or cat or title_of[imgs[0]])
            while eid in ids: eid += "-2"
            ids.add(eid); created += 1
            ev = {"id": eid, "name": c.get("name") or title_of[imgs[0]], "name_src": "twitch", "category": cat or "Unknown", "start": "", "end": "", "badges": []}
            events.insert(0, ev)
        before = json.dumps(ev, sort_keys=True)
        # dates: fill when empty, keep following Twitch unless you set them by hand
        if start and end and (not ev.get("start") or ev.get("dates_src") == "twitch"):
            ev["start"], ev["end"], ev["dates_src"] = start, end, "twitch"
        ev["twitch_campaign"] = c.get("id")
        if cat and ev.get("category") in (None, "", "Unknown"): ev["category"] = cat
        if c.get("name") and ev.get("name_src") != "manual":
            generic = {_norm(ev.get("category")), _norm("Unknown")} | {_norm(title_of.get(i, "")) for i in imgs}
            if _norm(ev.get("name")) in generic or ev.get("name_src") == "twitch":
                ev["name"], ev["name_src"] = c["name"], "twitch"
        if c.get("summary") and ev.get("about_src") != "manual": ev["about"] = c["summary"].strip()
        have = {b.get("img") for b in ev["badges"]}
        for img in imgs:
            if img not in have:
                ev["badges"].append({"name": title_of[img], "img": img, "how": "Objective not announced yet.", "cost": "na"}); ev_of[img] = ev
        for b in ev["badges"]:
            if b.get("img") not in imgs: continue
            if how and (is_placeholder_how(b.get("how")) or b.get("how_src") == "twitch") and b.get("how_src") != "manual":
                b["how"], b["how_src"] = how, "twitch"
            if cost and (b.get("cost") in (None, "", "na") or b.get("how_src") == "twitch"): b["cost"] = cost
        if json.dumps(ev, sort_keys=True) != before: changed += 1
    # Second pass: events still without Twitch dates, matched to a reward campaign by category or event name.
    # Only dates are taken over (the rewards themselves are in-game items, not the badge).
    by_event = {}
    for c in camps:
        g, n = _norm((c.get("game") or {}).get("displayName")), _norm(c.get("name"))
        s_, e_ = _iso(c.get("startsAt")), _iso(c.get("endsAt"))
        if not (s_ and e_): continue
        for ev in events:
            if ev.get("dates_src") == "manual" or (ev.get("start") and ev.get("dates_src") != "twitch"): continue
            cat, nm = _norm(ev.get("category")), _norm(ev.get("name"))
            # same category = identical, or one is a clear prefix of the other ("CONTROL Resonant" vs "CONTROL Resonant: Deluxe"),
            # but not a short family name ("Pokémon" must not match "Pokémon Legends: Z-A")
            same_cat = bool(g and cat and cat != _norm("Unknown") and (g == cat or ((g.startswith(cat) or cat.startswith(g)) and min(len(g), len(cat)) / max(len(g), len(cat)) >= 0.7)))
            same_name = n and nm and len(n) >= 6 and (n in nm or nm in n)
            if same_cat or same_name:
                by_event.setdefault(ev["id"], []).append((s_, e_, c.get("id")))
    by_id = {ev["id"]: ev for ev in events}
    cat_filled = 0
    for eid, wins in by_event.items():
        ev = by_id[eid]
        # several campaigns can match (e.g. one per reward); take the most common window, earliest end on ties
        counts = {}
        for w in wins: counts[(w[0], w[1])] = counts.get((w[0], w[1]), 0) + 1
        (s_, e_), _ = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0][1]))[0]
        if ev.get("start") != s_ or ev.get("end") != e_:
            ev["start"], ev["end"], ev["dates_src"] = s_, e_, "twitch"
            ev["twitch_campaign"] = next(w[2] for w in wins if (w[0], w[1]) == (s_, e_))
            cat_filled += 1
    changed += cat_filled
    if changed or created:
        save_events(events)
    print(f"twitch campaigns: {matched} matched our badges by reward, {cat_filled} event(s) dated by category/name, {created} created")

# ---------- channel campaign badges (sub / watch / ranking) ----------
EV_DB = os.path.join(ROOT, "events.json")
CH_DB = os.path.join(ROOT, "channel-badges.json")
CH_STATE = os.path.join(ROOT, "channels-state.json")
CH_LIST = os.path.join(ROOT, "channels.txt")
CH_PER_RUN = 120            # channels checked per run
CH_RECHECK_HOURS = 24

def helix_get(token, path, params=None):
    r = requests.get("https://api.twitch.tv/helix/" + path, params=params or {}, timeout=30,
                     headers={"Client-Id": os.environ["TWITCH_CLIENT_ID"], "Authorization": f"Bearer {token}"})
    r.raise_for_status(); return r.json().get("data", [])

def app_token():
    r = requests.post("https://id.twitch.tv/oauth2/token", params={"client_id": os.environ["TWITCH_CLIENT_ID"],
        "client_secret": os.environ["TWITCH_CLIENT_SECRET"], "grant_type": "client_credentials"}, timeout=30)
    r.raise_for_status(); return r.json()["access_token"]

def load_json(path, default):
    try: return json.load(open(path, encoding="utf-8"))
    except Exception: return default

def crawl_channel_badges(token):
    db = load_json(CH_DB, [])                 # rows: [title, img, first_seen, channel_login, channel_display, set_id, type]
    state = load_json(CH_STATE, {})           # login -> {"id":..., "checked": iso}
    known = {r[1] for r in db}
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None); now_iso = now.isoformat(timespec="seconds")

    # candidates: manual list + top live streams
    wanted = {}
    if os.path.exists(CH_LIST):
        for line in open(CH_LIST, encoding="utf-8"):
            l = line.strip().lower().lstrip("@")
            if l and not l.startswith("#"): wanted[l] = None
    try:
        for st in helix_get(token, "streams", {"first": 100}):
            wanted[st["user_login"].lower()] = (st["user_id"], st["user_name"])
    except Exception as e: print("streams lookup failed:", e)

    # resolve ids for manual names
    need_ids = [l for l, v in wanted.items() if v is None and not state.get(l, {}).get("id")]
    for i in range(0, len(need_ids), 100):
        try:
            for u in helix_get(token, "users", [("login", l) for l in need_ids[i:i+100]]):
                wanted[u["login"].lower()] = (u["id"], u["display_name"])
        except Exception as e: print("users lookup failed:", e)

    due = []
    for login, v in wanted.items():
        st = state.get(login, {})
        if v: st["id"], st["display"] = v
        if not st.get("id"): continue
        last = st.get("checked")
        if not last or (now - datetime.datetime.fromisoformat(last)).total_seconds() > CH_RECHECK_HOURS * 3600:
            due.append(login)
        state[login] = st
    due.sort(key=lambda l: state[l].get("checked") or "")   # least-recently-checked first
    added = 0
    for login in due[:CH_PER_RUN]:
        st = state[login]
        try:
            for sset in helix_get(token, "chat/badges", {"broadcaster_id": st["id"]}):
                sid = sset["set_id"]
                if not sid.startswith("campaign-"): continue
                typ = "sub" if sid.endswith("-sub") else "watch" if sid.endswith("-mw") else "ranking" if sid.endswith("-ranking") else "other"
                for v in sset["versions"]:
                    img = v["image_url_4x"].split("/badges/v1/")[1].split("/")[0]
                    if img in known: continue
                    known.add(img); added += 1
                    db.insert(0, [v.get("title") or sid, img, now_iso[:10], login, st.get("display") or login, sid, typ])
        except Exception as e: print("channel", login, "failed:", e)
        st["checked"] = now_iso
    json.dump(db, open(CH_DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(state, open(CH_STATE, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"channel badges: checked {min(len(due), CH_PER_RUN)} channels, {added} new campaign badges, {len(db)} total")

# ---------- global emotes (official Helix API) ----------
EMOTES_DB = os.path.join(ROOT, "emotes.json")      # rows: [id, name, first_seen, animated(0/1), active(0/1), removed_date]
def sync_emotes(token):
    data = helix_get(token, "chat/emotes/global")          # helix_get already returns the "data" list
    if not data:
        print("global emotes: none returned"); return
    first_run = not os.path.exists(EMOTES_DB)
    rows = load_json(EMOTES_DB, [])
    by_id = {r[0]: r for r in rows}
    today = datetime.date.today().isoformat()
    live_ids, new = set(), []
    for e in data:
        eid = e.get("id"); live_ids.add(eid)
        animated = 1 if "animated" in (e.get("format") or []) else 0
        if eid in by_id:
            r = by_id[eid]
            while len(r) < 6: r.append("")
            r[1], r[3], r[4], r[5] = e.get("name", r[1]), animated, 1, ""
        else:
            r = [eid, e.get("name", ""), "" if first_run else today, animated, 1, ""]
            rows.append(r); by_id[eid] = r            # file stays oldest → newest, like Twitch's own list
            if not first_run: new.append(r[1])
    removed = []
    for r in rows:
        while len(r) < 6: r.append("")
        if r[0] not in live_ids and r[4] != 0:     # removed from the global set: keep it in the archive with the date
            r[4], r[5] = 0, today; removed.append(r[1])
    before = open(EMOTES_DB, encoding="utf-8").read() if os.path.exists(EMOTES_DB) else ""
    out = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    if out != before:
        open(EMOTES_DB, "w", encoding="utf-8").write(out)
    status("emotes", f"{len(data)} live, {len(new)} new, {len(removed)} removed")
    print(f"global emotes: {len(data)} live, {len(new)} new, {len(removed)} removed" + (f" -> new: {', '.join(new[:10])}" if new else "")
          + (f" -> removed: {', '.join(removed[:10])}" if removed else "") + (" (first run: baseline saved)" if first_run else ""))

# ---------- badge popularity (public PotatBotat API, updated once a day) ----------
STATUS = {}                                          # small run report -> status.json (readable from the repo for debugging)
def status(key, msg):
    STATUS[key] = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "msg": str(msg)[:600]}
def write_status():
    try:
        old = load_json(os.path.join(ROOT, "status.json"), {})
        old.update(STATUS)
        json.dump(old, open(os.path.join(ROOT, "status.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    except Exception as e: print("status.json not written:", e)

POP_DB = os.path.join(ROOT, "popularity.json")      # {"updated": "YYYY-MM-DD", "source": ..., "counts": {set_id: users}}
POTAT_URL = "https://api.potat.app/twitch/badges"
def _find_list(j, depth=0):
    """First list of dicts anywhere in the response (handles {data:[...]}, {data:{badges:[...]}} etc.)."""
    if isinstance(j, list): return j
    if isinstance(j, dict) and depth < 4:
        for k in ("data", "badges", "results", "items"):
            if k in j:
                r = _find_list(j[k], depth + 1)
                if r: return r
        # {set_id: count} or {set_id: {...}} — checked before diving into the values
        if len(j) > 1 and all(isinstance(v, (int, float, dict)) and not isinstance(v, bool) for v in j.values()):
            return [dict(v, badge=k) if isinstance(v, dict) else {"badge": k, "user_count": v} for k, v in j.items()]
        for v in j.values():
            r = _find_list(v, depth + 1)
            if r and isinstance(r[0], dict): return r
    return []

def update_popularity(live):
    pop = load_json(POP_DB, {})
    today = datetime.date.today().isoformat()
    if pop.get("updated") == today:
        return
    try:
        r = requests.get(POTAT_URL, timeout=40, headers={"User-Agent": "BadgeDatabase (badgedatabase.com)", "Accept": "application/json"})
        print(f"popularity: potat.app answered HTTP {r.status_code}, {len(r.content)} bytes")
        status("popularity_http", f"HTTP {r.status_code}, {len(r.content)} bytes, starts with: {r.text[:300]}")
        j = r.json()
    except Exception as e:
        print("popularity: request failed ->", e); status("popularity", f"request failed: {e}"); return
    items = _find_list(j)
    if not items:
        print(f"popularity: unexpected response -> {str(j)[:400]}"); status("popularity", f"unexpected response: {str(j)[:400]}"); return
    print(f"popularity: {len(items)} rows, first row: {str(items[0])[:300]}")
    sets = {b["set"] for b in live}
    by_title = {_norm(b["title"]): b["set"] for b in live}
    by_img = {b["img"]: b["set"] for b in live}
    uuid_re = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    counts = {}
    for it in items:
        if not isinstance(it, dict): continue
        flat = dict(it)
        for k, v in it.items():                                  # one level of nesting, e.g. {"badge": {"set_id": ..}}
            if isinstance(v, dict): flat.update({f"{k}_{kk}": vv for kk, vv in v.items()})
        nums = [(k, v) for k, v in flat.items() if isinstance(v, (int, float)) and not isinstance(v, bool)]
        pref = [v for k, v in nums if re.search(r"user|count|total|amount|seen", k, re.I)]
        n = pref[0] if pref else (max(v for k, v in nums) if nums else None)
        if n is None: continue
        strs = [str(v) for v in flat.values() if isinstance(v, str)]
        sid = next((v for v in strs if v in sets), None)
        if not sid:
            sid = next((by_img[u] for v in strs for u in uuid_re.findall(v) if u in by_img), None)
        if not sid:
            sid = next((by_title[_norm(v)] for v in strs if _norm(v) in by_title), None)
        if sid: counts[sid] = max(counts.get(sid, 0), int(n))    # multi-version sets: the largest version
    if not counts:
        print(f"popularity: could not match any badge -> first row {str(items[0])[:300]}"); status("popularity", f"no badge matched, first row: {str(items[0])[:300]}"); return
    json.dump({"updated": today, "source": "PotatBotat (potat.app)", "counts": dict(sorted(counts.items(), key=lambda kv: -kv[1]))},
              open(POP_DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    top = max(counts, key=counts.get)
    print(f"popularity: {len(counts)} badge sets updated (top: {top} {counts[top]:,})")
    status("popularity", f"ok: {len(counts)} badge sets, top {top} {counts[top]:,}")

# ---------- top Twitch categories right now (official Helix API) ----------
TOPCAT_DB = os.path.join(ROOT, "top-categories.json")
def helix_page(token, path, params):
    r = requests.get("https://api.twitch.tv/helix/" + path, params=params, timeout=30,
                     headers={"Client-Id": os.environ["TWITCH_CLIENT_ID"], "Authorization": f"Bearer {token}"})
    r.raise_for_status(); return r.json()

def update_top_categories(token, n=150):
    """Top Twitch categories (official Helix API, paginated — max 100 per request).
    Viewers = sum of the 100 biggest live streams in each category; looked up in parallel."""
    games, cursor = [], None
    while len(games) < n:
        params = {"first": min(100, n - len(games))}
        if cursor: params["after"] = cursor
        j = helix_page(token, "games/top", params)
        games += j.get("data", [])
        cursor = (j.get("pagination") or {}).get("cursor")
        if not cursor or not j.get("data"): break
    games = games[:n]

    def lookup(g):
        try:
            live = helix_get(token, "streams", {"game_id": g["id"], "first": 100, "type": "live"})
        except Exception as e:
            print("top categories: streams lookup failed for", g.get("name"), "->", e); live = []
        row = {"id": g["id"], "name": g.get("name", ""), "box": g.get("box_art_url", ""),
               "viewers": sum(x.get("viewer_count", 0) for x in live), "streams": len(live)}
        if live:
            t = max(live, key=lambda x: x.get("viewer_count", 0))
            row["top"] = {"login": t.get("user_login", ""), "name": t.get("user_name", ""), "viewers": t.get("viewer_count", 0)}
        return row

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        out = list(pool.map(lookup, games))          # keeps Twitch's own ranking order
    json.dump({"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "note": "viewers = top 100 live streams", "games": out},
              open(TOPCAT_DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    status("top_categories", f"{len(out)} categories, #1 {out[0]['name'] if out else '-'}")
    print(f"top categories: {len(out)} saved" + (f" (#1 {out[0]['name']}, ~{out[0]['viewers']:,} viewers)" if out else ""))

# ---------- post image (1200x675 card) ----------
def make_card(badge_png_bytes, title, subtitle=""):
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    W, H = 1200, 675
    def font(sz, bold=True):
        p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        try: return ImageFont.truetype(p, sz)
        except Exception: return ImageFont.load_default(size=sz)
    img = Image.new("RGB", (W, H), (12, 11, 17))
    glow = Image.new("RGB", (W, H), (12, 11, 17)); ImageDraw.Draw(glow).ellipse((330, 120, 870, 600), fill=(60, 38, 110))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(130)), 0.9)
    d = ImageDraw.Draw(img)
    # header
    try:
        logo = Image.open(os.path.join(ROOT, "logo.png")).convert("RGBA").resize((72, 72)); img.paste(logo, (56, 46), logo)
    except Exception: pass
    d.text((148, 52), "NEW TWITCH GLOBAL BADGE", font=font(24), fill=(167, 139, 250))
    d.text((148, 82), "Badge added on Twitch", font=font(26, False), fill=(158, 154, 176))
    d.line((56, 150, W - 56, 150), fill=(45, 43, 58), width=2)
    # badge on a rounded tile, centered
    tile = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, 299, 299), radius=52, fill=(30, 29, 42), outline=(70, 66, 95), width=2)
    b = Image.open(io.BytesIO(badge_png_bytes)).convert("RGBA").resize((216, 216), Image.NEAREST)
    tile.alpha_composite(b, (42, 42)); img.paste(tile, ((W - 300) // 2, 178), tile)
    # title
    tsz = 66 if len(title) <= 22 else 52 if len(title) <= 40 else 40
    f = font(tsz); lines, cur = [], ""
    for w in title.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > W - 160 and cur: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur); y = 500 if len(lines) == 1 else 490
    for ln in lines[:2]: d.text(((W - d.textlength(ln, font=f)) / 2, y), ln, font=f, fill=(244, 243, 248)); y += int(tsz * 1.12)
    # footer
    d.line((56, H - 78, W - 56, H - 78), fill=(45, 43, 58), width=2)
    f = font(24); d.text((56, H - 56), "BADGEDATABASE.COM", font=f, fill=(120, 116, 140))
    r = "X.COM/BADGEDATABASE"; d.text((W - 56 - d.textlength(r, font=f), H - 56), r, font=f, fill=(120, 116, 140))
    c = "TWITCH.TV/BADGE_DB"; d.text(((W - d.textlength(c, font=f)) / 2, H - 56), c, font=f, fill=(120, 116, 140))
    out = io.BytesIO(); img.save(out, "PNG"); return out.getvalue()

def subtitle_for(badge): return ""

# ---------- X ----------
def post_to_x(badge, image_bytes):
    import tweepy
    kw = dict(consumer_key=os.environ["X_API_KEY"], consumer_secret=os.environ["X_API_SECRET"],
              access_token=os.environ["X_ACCESS_TOKEN"], access_token_secret=os.environ["X_ACCESS_SECRET"])
    sub = ""
    text = f"Twitch global badge added: {badge['title']}"
    client = tweepy.Client(**kw)
    media_ids = None
    try:  # media upload (v1.1 endpoint) — falls back to text-only if unavailable on your plan
        api = tweepy.API(tweepy.OAuth1UserHandler(*kw.values()))
        try: card = make_card(image_bytes, badge["title"], sub)
        except Exception as e: print("card render failed, using raw badge:", e); card = image_bytes
        m = api.media_upload(filename=f"{badge['img']}.png", file=io.BytesIO(card))
        media_ids = [m.media_id]
    except Exception as e:
        print("media upload failed, posting text only:", e)
    resp = client.create_tweet(text=text, media_ids=media_ids)
    print("posted to X:", resp.data)
    return (resp.data or {}).get("id")

# ---------- X: reply with the badge's page link once it is live ----------
POSTS_DB = os.path.join(ROOT, "posts.json")        # {set_id: {"tweet": id, "title": ..., "posted": iso, "replied": bool}}
X_LINK_REPLY = (os.environ.get("X_LINK_REPLY") or "1").strip().lower() not in ("0", "false", "no", "off")
def remember_post(badge, tweet_id):
    if not tweet_id: return
    posts = load_json(POSTS_DB, {})
    posts[badge["set"]] = {"tweet": str(tweet_id), "title": badge["title"],
                           "posted": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "replied": False}
    json.dump(posts, open(POSTS_DB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def reply_with_links(max_per_run=3):
    """Next runs after a post: as soon as /badges/<set>/ is online, reply to the post with that link."""
    if not X_LINK_REPLY or DRY_RUN: return
    posts = load_json(POSTS_DB, {})
    site = (os.environ.get("SITE_URL") or "https://badgedatabase.com").rstrip("/")
    now = datetime.datetime.now(datetime.timezone.utc)
    pending = [(k, v) for k, v in posts.items() if not v.get("replied") and v.get("tweet")]
    if not pending: return
    import tweepy
    client = tweepy.Client(consumer_key=os.environ["X_API_KEY"], consumer_secret=os.environ["X_API_SECRET"],
                           access_token=os.environ["X_ACCESS_TOKEN"], access_token_secret=os.environ["X_ACCESS_SECRET"])
    done = 0
    for set_id, v in pending:
        if done >= max_per_run: break
        if (now - datetime.datetime.fromisoformat(v["posted"])).total_seconds() > 3 * 86400:
            v["replied"] = "skipped (too old)"; continue
        url = f"{site}/badges/{set_id}/"
        try:
            live = requests.get(url, timeout=20).status_code == 200
        except Exception:
            live = False
        if not live:
            print(f"x link reply: {url} not online yet, will retry"); continue
        try:
            client.create_tweet(text=f"How to get {v['title']} and when it's available: {url}", in_reply_to_tweet_id=v["tweet"])
            v["replied"] = True; done += 1
            print(f"x link reply: posted for {set_id}")
        except Exception as e:
            print(f"x link reply failed for {set_id}:", e)
    json.dump(posts, open(POSTS_DB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------- Discord (free) ----------
def post_to_discord(badge):
    hook = os.environ.get("DISCORD_WEBHOOK")
    if not hook:
        return
    site = os.environ.get("SITE_URL", "")
    requests.post(hook, json={"embeds": [{
        "title": f"New Twitch global badge: {badge['title']}",
        "description": badge["desc"] or "Availability and objective TBA.",
        "url": f"{site}#global" if site else None,
        "thumbnail": {"url": badge["url"]},
        "color": 0x8B5CF6}]}, timeout=30).raise_for_status()
    print("posted to Discord")

# ---------- main ----------
# badges.json rows: [title, img, added, free, users, set_id, description]
def main():
    rows = json.load(open(DB, encoding="utf-8"))
    live = twitch_global_badges()
    img_to_set = {b["img"]: b["set"] for b in live}
    by_img = {b["img"]: b for b in live}
    changed = False

    # 0) Twitch sometimes fills in or edits a badge's title/description days later — pick that up every run
    updated = 0
    for r in rows:
        while len(r) < 7: r.append("")
        lb = by_img.get(r[1])
        if not lb: continue
        if lb.get("desc") and lb["desc"] != r[6]: r[6] = lb["desc"]; updated += 1
        if lb.get("title") and lb["title"] != r[0] and not is_junk(lb): r[0] = lb["title"]; updated += 1
    if updated: changed = True; print(f"refreshed {updated} title/description field(s) from Twitch")

    # 1) make sure every existing row knows its set id (older rows had no 6th field)
    for r in rows:
        if len(r) < 6:
            r.append(img_to_set.get(r[1], "")); changed = True
        elif not r[5] and r[1] in img_to_set:
            r[5] = img_to_set[r[1]]; changed = True

    known_imgs = {r[1] for r in rows}
    known_sets = {r[5] for r in rows if r[5]}
    set_added = {}
    for r in rows:
        if r[5] and r[2] and (r[5] not in set_added or r[2] < set_added[r[5]]):
            set_added[r[5]] = r[2]

    new_versions = [b for b in live if b["img"] not in known_imgs]
    new_sets, seen = [], set()
    for b in new_versions:
        if b["set"] not in known_sets and b["set"] not in seen:
            seen.add(b["set"])
            if is_junk(b): print("skipping internal badge:", b["title"])
            else: new_sets.append(b)
    print(f"{len(live)} versions live, {len(new_versions)} new versions, {len(new_sets)} new sets to announce")

    today = datetime.date.today().isoformat()
    posted = 0
    for b in new_sets:
        if posted >= MAX_POSTS_PER_RUN:
            print("post cap for this run reached; remaining badges are still saved"); break
        if DRY_RUN:
            print("DRY RUN, would post:", b["title"])
        else:
            try:
                img = requests.get(b["url"], timeout=30).content
                remember_post(b, post_to_x(b, img)); post_to_discord(b)
            except Exception as e:
                print("posting failed:", e)
        posted += 1

    # 2) save every new version: extra versions of a known set inherit that set's date (not announced),
    #    versions of a brand-new set get today's date
    for b in new_versions:
        added = set_added.get(b["set"], "") if b["set"] in known_sets else today
        rows.insert(0, [b["title"], b["img"], added, 0, 0, b["set"], b.get("desc", "")]); changed = True

    if changed:
        json.dump(rows, open(DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("badges.json updated")

    sync_events({b["img"]: b.get("desc", "") for b in live}, new_sets, {_norm(b["title"]): b["img"] for b in live})
    try: apply_campaigns(rows)
    except Exception as e: print("twitch campaigns: skipped ->", e)

    try: reply_with_links()
    except Exception as e: print("x link reply: skipped ->", e)

    try: update_popularity(live)
    except Exception as e: print("popularity: skipped ->", e); status("popularity", f"crashed: {e!r}")

    tok = None
    try: tok = app_token()
    except Exception as e: print("app token failed:", e)
    if tok:
        try: update_top_categories(tok)
        except Exception as e: print("top categories: skipped ->", e)
        try: sync_emotes(tok)
        except Exception as e: print("global emotes: skipped ->", e)
        try: crawl_channel_badges(tok)
        except Exception as e: print("channel crawl failed:", e)

    write_status()

if __name__ == "__main__":
    main()
