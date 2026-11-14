"""User counts from an external badge list for the newest badges (the stream overlay's "Added in the last 14 days" column).

Runs on its own every AUTO_MIN minutes, and right away when asked for with the "Overlay user counts" button in /admin/
(the button writes sdb-request.json; that runs when the request is newer than the last one handled). One page load a time:
The global badge list at LIST_URL (newest first) shows "Users" for every badge. The counts go into popularity.json
under "sdb" (only the stream overlay uses them; the site keeps PotatBotat's counts, which are counted differently and
are much higher); the result is reported in status.json under "sdb_users".
"""
import datetime, html as htmlmod, json, os, re
import requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
REQ = os.path.join(ROOT, "sdb-request.json")
POP_DB = os.path.join(ROOT, "popularity.json")
BADGES = os.path.join(ROOT, "badges.json")
LIST_URL = "https://www.streamdatabase.com/twitch/global-badges"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36",
           "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"}
DAYS = 14
AUTO_MIN = 30           # load the list on its own this often, so the overlay's USERS stay current


def _load(path, default):
    try: return json.load(open(path, encoding="utf-8"))
    except Exception: return default


def _now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _text(fragment):
    t = re.sub(r"<(script|style)\b.*?</\1>", " ", fragment, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", htmlmod.unescape(t)).strip()


def _num(v):
    v = (v or "").strip().replace(",", "").replace(" ", "")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([KkMm]?)", v)
    if not m: return None
    n = float(m.group(1)) * {"": 1, "k": 1e3, "m": 1e6}[m.group(2).lower()]
    return int(round(n))


USERS_RE = re.compile(r"\bUsers\s*:?\s*(\d[\d,\.]*\s*[KkMm]?|N\s*/\s*A)", re.I)
LINK_RE = re.compile(r'href="(?:https?://(?:www\.)?streamdatabase\.com)?/twitch/global-badges/([^/"?#]+)/(\d+)[^"]*"', re.I)


def parse_list(page):
    """{set_id: users or None} from the list page. Every row links to /twitch/global-badges/<set>/<version>; its
    "Users" value sits either after that link (card wrapped in the link) or before it (link on the name at the end)."""
    rows = []                                                     # (set, start, end) of each row's first link
    for m in LINK_RE.finditer(page):
        sid = m.group(1).lower()
        if rows and rows[-1][0] == sid: continue                  # image link + name link of the same row
        rows.append((sid, m.start(), m.end()))
    if not rows: return {}
    after, before = {}, {}
    for i, (sid, s, e) in enumerate(rows):
        nxt = rows[i + 1][1] if i + 1 < len(rows) else min(len(page), e + 4000)
        prv = rows[i - 1][2] if i else max(0, s - 4000)
        a, b = USERS_RE.search(_text(page[e:nxt])), USERS_RE.findall(_text(page[prv:s]))
        after[sid] = a.group(1) if a else ""
        before[sid] = b[-1] if b else ""
    use = after if sum(1 for v in after.values() if v) >= sum(1 for v in before.values() if v) else before
    return {sid: _num(v) for sid, v in use.items() if v}


def parse_json(page):
    """Fallback: data embedded as JSON (e.g. a Next.js payload): a set id with a user count next to it."""
    raw = page.replace('\\"', '"')
    out = {}
    for m in re.finditer(r'"(?:set_?id|setId|setID)"\s*:\s*"([^"]+)"', raw):
        win = raw[max(0, m.start() - 600): m.end() + 600]
        c = re.search(r'"(?:user_?count|userCount|usersCount|users_count|users|holders)"\s*:\s*(\d+|null)', win)
        if c and m.group(1).lower() not in out:
            out[m.group(1).lower()] = None if c.group(1) == "null" else int(c.group(1))
    return out


def probe(page):
    """What the list page holds besides the 100 rendered rows: links to other pages, embedded data with more badges."""
    raw = page.replace('\\"', '"')
    hrefs = sorted(set(h for h in re.findall(r'href="([^"]+)"', page) if re.search(r"page|offset|cursor|p=\d", h, re.I)))[:20]
    sets_in_links = len({m.group(1).lower() for m in LINK_RE.finditer(page)})
    set_ids = len(set(re.findall(r'"(?:set_?id|setId|setID)"\s*:\s*"([^"]+)"', raw)))
    keys = sorted(set(re.findall(r'"(user_?count|userCount|usersCount|users_count|holders|totalPages|total_pages|pageCount|perPage|per_page|total)"', raw)))
    api = sorted(set(re.findall(r'(?:https?://[^"\s\']*)?/api/[^"\s\'<>]{3,120}', raw)))[:20]
    pg = [raw[max(0, m.start() - 150): m.end() + 150] for m in re.finditer(r"Page\s*\d+\s*of\s*\d+|totalPages|pageCount", raw)][:3]
    return {"bytes": len(page), "sets_in_links": sets_in_links, "set_ids_in_data": set_ids, "keys": keys, "page_hrefs": hrefs,
            "api_urls": api, "next_data": "__NEXT_DATA__" in page, "near_page": pg}


def run():
    """Returns {status_key: {"at", "msg"}} for status.json; does nothing until the next turn is due (or asked for)."""
    req = _load(REQ, {})
    st = _load(os.path.join(ROOT, "status.json"), {}).get("sdb_users", {})
    asked = bool(req.get("at")) and st.get("req") != req.get("at")
    try: age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(st["at"])).total_seconds() / 60
    except Exception: age = 1e9
    if not asked and age < AUTO_MIN:
        return {}
    out = {"sdb_users": {"at": _now(), "req": req.get("at") if asked else st.get("req", ""), "msg": ""}}
    rows = _load(BADGES, [])
    cutoff = (datetime.date.today() - datetime.timedelta(days=DAYS)).isoformat()
    targets = {}
    for r in rows:                                                  # [title, img, added, free, users, set, desc]
        if len(r) > 5 and r[5] and r[2] and r[2] >= cutoff: targets.setdefault(r[5].lower(), r[0])
    try:
        resp = requests.get(LIST_URL, headers=HEADERS, timeout=40)
        page = resp.text
    except Exception as e:
        out["sdb_users"]["msg"] = f"The badge list could not be loaded: {e}"[:600]; return out
    if resp.status_code != 200:
        out["sdb_users"]["msg"] = f"The badge list answered HTTP {resp.status_code} ({len(page)} bytes): {_text(page)[:300]}"[:600]
        return out
    out["sdb_users_probe"] = {"at": _now(), "msg": json.dumps(probe(page), ensure_ascii=False)[:3000]}   # how the list pages
    found = parse_list(page)
    how = "list"
    if not any(found.get(s) is not None for s in targets):
        found, how = parse_json(page), "json"
    # nothing recognised: keep what the page looked like, so the parser can be fixed if the page changes its layout
    first = next((m for m in LINK_RE.finditer(page)), None)
    keys = sorted(set(re.findall(r'"(user_?count|userCount|usersCount|users_count|holders)"', page.replace('\\"', '"'))))
    if not found: out["sdb_users_debug"] = {"at": _now(), "msg": json.dumps({
        "bytes": len(page), "links": len(LINK_RE.findall(page)), "users_labels": len(USERS_RE.findall(_text(page))), "json_keys": keys,
        "parsed": how, "sample": dict(list(found.items())[:8]),
        "html_near_first_badge": page[max(0, first.start() - 1200): first.start() + 1800] if first else page[:2500]}, ensure_ascii=False)}
    counts = {s: found[s] for s in targets if found.get(s) is not None}
    missing = [targets[s] for s in targets if s not in found]
    pop = _load(POP_DB, {})
    if counts and any((pop.get("sdb") or {}).get(s) != n for s, n in counts.items()):   # only write when a number changed
        pop["sdb"] = {**(pop.get("sdb") or {}), **counts}            # kept when the daily PotatBotat update rewrites the file
        pop["sdb_updated"] = _now()
        json.dump(pop, open(POP_DB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    na = [targets[s] for s in targets if s in found and found[s] is None]
    out["sdb_users"]["msg"] = (f"{len(counts)} of {len(targets)} badges from the last {DAYS} days updated"
                               + (f"; no number yet: {', '.join(na)}" if na else "")
                               + (f"; not in the list: {', '.join(missing)}" if missing else ""))[:600]
    print("sdb users:", out["sdb_users"]["msg"])
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=1, ensure_ascii=False)[:3000])
