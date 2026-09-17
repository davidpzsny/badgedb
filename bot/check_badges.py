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

# ---------- events.json: one entry per badge set so it shows on the timeline ----------
def slugify(t):
    import re as _re
    return _re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:48] or "badge"

def add_events(new_sets):
    """Create a timeline entry for each newly discovered badge set.
    start/end stay empty -> the site lists it under 'Date not announced'.
    Fill in the dates by editing events.json in the repo (or on the web UI)."""
    try: events = json.load(open(EV_DB, encoding="utf-8"))
    except Exception: events = []
    known_imgs = {b.get("img") for e in events for b in e.get("badges", [])}
    by_id = {e["id"] for e in events}
    added = 0
    for b in new_sets:
        if b["img"] in known_imgs: continue
        eid = slugify(b["set"] or b["title"])
        while eid in by_id: eid += "-2"
        by_id.add(eid); known_imgs.add(b["img"]); added += 1
        events.insert(0, {"id": eid, "name": b["title"], "category": "Unknown", "start": "", "end": "",
                          "badges": [{"name": b["title"], "img": b["img"],
                                      "how": b.get("desc") or "Objective not announced yet.", "cost": "na"}]})
    if added:
        json.dump(events, open(EV_DB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"events.json: {added} new timeline entries (dates still need filling in)")

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
    now = datetime.datetime.utcnow(); now_iso = now.isoformat(timespec="seconds")

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
# badges.json rows: [title, img, added, free, users, set_id]
def main():
    rows = json.load(open(DB, encoding="utf-8"))
    live = twitch_global_badges()
    img_to_set = {b["img"]: b["set"] for b in live}
    changed = False

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
                post_to_x(b, img); post_to_discord(b)
            except Exception as e:
                print("posting failed:", e)
        posted += 1

    # 2) save every new version: extra versions of a known set inherit that set's date (not announced),
    #    versions of a brand-new set get today's date
    for b in new_versions:
        added = set_added.get(b["set"], "") if b["set"] in known_sets else today
        rows.insert(0, [b["title"], b["img"], added, 0, 0, b["set"]]); changed = True

    if changed:
        json.dump(rows, open(DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("badges.json updated")

    add_events(new_sets)

    try: crawl_channel_badges(app_token())
    except Exception as e: print("channel crawl failed:", e)

if __name__ == "__main__":
    main()
