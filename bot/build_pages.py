"""
Builds real, crawlable URLs for the site — every page uses the SAME shell as the
homepage (index.html + /assets/app.css + /assets/app.js), so the site looks
identical everywhere. Each page arrives pre-filled with its content (for search
engines and no-JS visitors); the app then takes over with live data.

  /badges/<set>/   one page per global badge set
  /badges/         all global badges
  /timeline/       active / upcoming badges
  /channel/        channel campaign badges
  /faq/ /privacy/ /terms/
  /404.html        fallback: the app routes any other path (e.g. /channel/<id>/, /admin/)
  /sitemap.xml, /robots.txt

Output is deterministic, so files only change when the data changes.
"""
import json, os, html, datetime, re

ROOT = os.path.join(os.path.dirname(__file__), "..")
SITE = (os.environ.get("SITE_URL") or "").rstrip("/") or "https://badgedatabase.com"
CDN = "https://static-cdn.jtvnw.net/badges/v1/{}/3"
JUNK = re.compile(r"beta_title|_beta$|^beta$|placeholder|default-creator-campaign", re.I)
e = lambda s: html.escape(str(s or ""), quote=True)
CTYPE = {"sub": "Sub badge", "watch": "Watch badge", "ranking": "Top supporter", "other": "Campaign"}

def load(name, default):
    try: return json.load(open(os.path.join(ROOT, name), encoding="utf-8"))
    except Exception: return default

def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path) or ROOT, exist_ok=True)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        open(path, "w", encoding="utf-8").write(text); return 1
    return 0

def utc(iso):
    if not iso: return ""
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %-d, %Y, %H:%M UTC")

def day(iso):
    if not iso: return ""
    return datetime.date.fromisoformat(iso[:10]).strftime("%b %-d, %Y")

def status(ev, now):
    if not ev or not ev.get("start"): return "tba"
    if now < ev["start"]: return "soon"
    if now > ev["end"]: return "ended"
    return "live"

# ---------------------------------------------------------------- data
def build_sets():
    groups = {}
    for r in load("badges.json", []):
        while len(r) < 7: r.append("")
        if JUNK.search(r[0]) or JUNK.search(r[5] or ""): continue
        groups.setdefault(r[5] or r[1], []).append(r)
    sets = []
    for key, rs in groups.items():
        p = rs[-1]
        vs = sorted(rs, key=lambda x: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", x[0])])
        dated = sorted(x[2] for x in rs if x[2])
        sets.append({"set": key, "name": p[0], "img": p[1], "added": p[2] or (dated[0] if dated else ""),
                     "free": any(x[3] == 1 for x in rs), "users": max(x[4] or 0 for x in rs), "desc": p[6] or "",
                     "versions": [{"title": x[0], "img": x[1]} for x in vs]})
    return sets

STALE_DAYS = 21
def is_stale(ev, by_img, now):
    """An event without dates whose badges have been on Twitch for 3+ weeks has almost certainly ended."""
    if not ev or ev.get("start"): return False
    added = sorted(by_img[b["img"]]["added"] for b in ev.get("badges", []) if b.get("img") in by_img and by_img[b["img"]]["added"])
    if not added: return False
    return (datetime.date.fromisoformat(now[:10]) - datetime.date.fromisoformat(added[0])).days > STALE_DAYS

def slug_ok(s): return re.fullmatch(r"[A-Za-z0-9._~-]+", s or "") is not None

# ---------------------------------------------------------------- page shell
TEMPLATE = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

def _meta(h, attr, key, value):
    pat = re.compile(r'(<meta\s+' + attr + r'="' + re.escape(key) + r'"\s+content=")[^"]*(")')
    return pat.sub(lambda m: m.group(1) + e(value) + m.group(2), h, count=1)

def page(path, title, desc, section, fills=None, jsonld=None, image=None, noindex=False):
    h = TEMPLATE
    h = re.sub(r"<title>.*?</title>", f"<title>{e(title)}</title>", h, count=1, flags=re.S)
    h = _meta(h, "name", "description", desc)
    h = _meta(h, "property", "og:title", title); h = _meta(h, "property", "og:description", desc)
    h = _meta(h, "property", "og:url", SITE + path)
    h = _meta(h, "name", "twitter:title", title); h = _meta(h, "name", "twitter:description", desc)
    if image:
        h = _meta(h, "property", "og:image", image); h = _meta(h, "name", "twitter:image", image)
        h = _meta(h, "name", "twitter:card", "summary")
        h = re.sub(r'<meta property="og:image:width"[^>]*>\s*<meta property="og:image:height"[^>]*>', "", h, count=1)
    h = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{e(SITE + path)}">', h, count=1)
    if noindex:
        h = re.sub(r'<meta name="robots" content="[^"]*">', '<meta name="robots" content="noindex">', h, count=1)
    # show only this page's section
    h = re.sub(r'<section data-page="([a-z]+)"( hidden)?>', lambda m: f'<section data-page="{m.group(1)}"{"" if m.group(1) == section else " hidden"}>', h)
    for old, new in (fills or {}).items():
        assert old in h, f"container not found in index.html: {old}"
        h = h.replace(old, new, 1)
    if fills: h = h.replace("<body>", '<body data-ssr="1">', 1)
    if jsonld:
        h = h.replace("</head>", "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n' for x in jsonld) + "</head>", 1)
    return h

def crumbs_ld(*items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, **({"item": SITE + h} if h else {})} for i, (n, h) in enumerate(items)]}

PILL = {"live": '<span class="pill live">Active</span>', "ending": '<span class="pill ending">Ends soon</span>',
        "soon": '<span class="pill soon">Upcoming</span>', "tba": '<span class="pill tba">Date not announced</span>', "ended": '<span class="pill ended">Ended</span>'}
def state_of(ev, by_img, now):
    if not ev: return None
    st = status(ev, now)
    if st == "live":
        left = datetime.datetime.fromisoformat(ev["end"].replace("Z", "+00:00")) - datetime.datetime.fromisoformat(now.replace("Z", "+00:00"))
        return "ending" if left.total_seconds() < 48 * 3600 else "live"
    if st == "tba": return "ended" if is_stale(ev, by_img, now) else "tba"
    return st

def tile(img, alt=""):
    return f'<span class="tile"><img src="{CDN.format(img)}" alt="{e(alt)}" loading="lazy"></span>' if img else '<span class="tile"><span class="ph">?</span></span>'

def brow(s, state=None):
    pills = ('<span class="pill free">Free</span>' if s["free"] else "") + (PILL.get(state, "") if state else "")
    meta = " · ".join(x for x in [f"Added {day(s['added'])}" if s["added"] else "", f"{s['users']:,} users" if s["users"] else ""] if x)
    return (f'<a class="brow" href="/badges/{e(s["set"])}/" data-badge="{e(s["set"])}" data-type="global">{tile(s["img"], s["name"])}'
            f'<span class="t"><span class="n">{e(s["name"])}</span><span class="m">{pills}<span>{meta}</span></span></span></a>')

# ---------------------------------------------------------------- pages
def badge_page(s, ev, evb, related, now, stale=False):
    st = status(ev, now)
    cost = (evb or {}).get("cost") or ("free" if s["free"] else "")
    how = (evb or {}).get("how") or ""
    desc_text = s["desc"] or how or "A Twitch global badge."
    cat = ev.get("category") if ev and ev.get("category") not in (None, "", "Unknown") else ""
    when = f"Available {day(ev['start'])} – {day(ev['end'])}." if ev and ev.get("start") else ""
    meta = f"{s['name']} is a Twitch global badge. {how or desc_text} {when}".strip()
    meta = (meta[:157] + "…") if len(meta) > 158 else meta
    pills = ('<span class="pill free">Free</span> ' if s["free"] else "") + \
            {"live": '<span class="pill live">Active</span>', "soon": '<span class="pill soon">Upcoming</span>', "ended": '<span class="pill na">Ended</span>', "tba": ""}[st]
    base = CDN.format(s["img"])[:-1]
    sizes = "".join(f'<a href="{base}{n}" target="_blank" rel="noopener"><span class="box"><img src="{base}{n}" width="{w}" height="{w}" alt=""></span>{lbl}</a>'
                    for n, w, lbl in ((1, 18, "1x"), (2, 36, "2x"), (3, 72, "4x")))
    vers = ""
    if len(s["versions"]) > 1:
        vers = '<h3 style="margin-top:18px">Versions</h3><div class="vers">' + "".join(
            f'<a href="/badges/{e(s["set"])}/"><img src="{CDN.format(v["img"])}" alt="" loading="lazy">{e(v["title"])}</a>' for v in s["versions"]) + "</div>"
    description = s["desc"] or (f'This badge is earned during the {ev["name"]} event: {how}' if ev and how else "Twitch does not provide a description for this badge.")
    details = [("Title", e(s["name"])), ("Description", e(description)), ("Set ID", f'<code>{e(s["set"])}</code>'),
               ("Version ID", f'<code>1</code>{" of " + str(len(s["versions"])) if len(s["versions"]) > 1 else ""}')]
    if s["added"]: details.append(("Added", day(s["added"])))
    if s["users"]: details.append(("Users", f'{s["users"]:,}'))
    details.append(("Cost", {"free": "Free", "paid": "Paid (subscription / gift sub)"}.get(cost, "—")))
    cat_link = f'<a href="https://www.twitch.tv/directory/category/{e(re.sub(r"[^a-z0-9]+", "-", cat.lower()).strip("-"))}?filter=drops" target="_blank" rel="noopener">{e(cat)}</a>' if cat else "—"
    avail = [("Status", ("Ended (dates were never announced)" if stale else {"live": "Active", "soon": "Upcoming", "ended": "Ended", "tba": "Date not announced"}[st]) if ev else "Unknown / not a timed event"),
             ("Objective", e(how) if how else "—"), ("Category", cat_link),
             ("Channels", f'<a href="https://twitch.tv/{e(ev["channel"])}" target="_blank" rel="noopener">{e(ev["channel"])}</a>' if ev and ev.get("channel") else "Any"),
             ("Started", utc(ev["start"]) if ev and ev.get("start") else "—"), ("Ends", utc(ev["end"]) if ev and ev.get("end") else "—")]
    dl = lambda rows: '<dl class="kv2">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows) + "</dl>"
    context = (ev or {}).get("about") or (ev or {}).get("note") or (
        f'This badge was added to promote {ev["name"]}{" in the " + cat + " category" if cat else ""} on Twitch.' if ev else "No additional context yet. Follow twitch.tv/badge_db for updates.")
    rel = ""
    if related:
        rel = f'<h2>{"More from this event" if ev and len(ev.get("badges", [])) > 1 else "Recently added badges"}</h2><div class="blist">' + "".join(brow(r) for r in related) + "</div>"
    body = f"""<div class="page-head"><div><h1>{e(s['name'])}</h1><p class="lead">Everything you need to know about this Twitch global badge.</p></div><div>{pills}</div></div>
<div class="bp-grid">
  <div class="card2"><h3>Images</h3><div class="sizes" style="--bp-bg:#18181b">{sizes}</div>{vers}</div>
  <div class="card2"><h3>Details</h3>{dl(details)}</div>
  <div class="card2"><h3>Availability</h3>{dl(avail)}</div>
  <div class="card2"><h3>Context</h3><p class="ctx">{e(context)}</p><h3 style="margin-top:18px">History</h3>{dl([("Added", day(s["added"]) or "Before tracking started")])}</div>
</div>{rel}"""
    ld_page = {"@context": "https://schema.org", "@type": "WebPage", "name": f"{s['name']} – Twitch Global Badge", "description": meta,
               "url": f"{SITE}/badges/{s['set']}/", "primaryImageOfPage": {"@type": "ImageObject", "url": CDN.format(s["img"])},
               "isPartOf": {"@type": "WebSite", "name": "Badge Database", "url": SITE + "/"}}
    if s["added"]: ld_page["datePublished"] = s["added"]
    return page(f"/badges/{s['set']}/", f"{s['name']} – Twitch Badge | Badge Database", meta, "badge",
                fills={'<div id="badgePage"></div>': f'<div id="badgePage">{body}</div>'},
                jsonld=[crumbs_ld(("Home", "/"), ("Global Badges", "/badges/"), (s["name"], None)), ld_page], image=CDN.format(s["img"]))

def global_page(sets, ev_of, by_img, now):
    rows = "".join(brow(s, state_of(ev_of.get(s["img"], (None,))[0], by_img, now)) for s in sets)
    return page("/badges/", f"All {len(sets)} Twitch Global Badges – Full List | Badge Database",
                f"The complete list of all {len(sets)} Twitch global badges with images, how to get each one, and when it is available. Updated automatically.",
                "global", fills={'<div class="count-line" id="gCount"></div>': f'<div class="count-line" id="gCount">{len(sets)} badge sets</div>',
                                 '<div class="blist" id="gridGlobal"></div>': f'<div class="blist" id="gridGlobal">{rows}</div>'},
                jsonld=[crumbs_ld(("Home", "/"), ("Global Badges", None))])

def timeline_page(events, by_img, now):
    def card(ev, b, st):
        s = by_img.get(b.get("img"))
        href = f"/badges/{s['set']}/" if s else "/timeline/"
        cost = {"free": "Free", "paid": "Sub / paid"}.get(b.get("cost"), "TBA")
        when = {"live": f"Ends {day(ev['end'])}", "soon": f"Starts {day(ev['start'])}", "tba": "Dates not announced"}[st]
        cat = f' · {e(ev["category"])}' if ev.get("category") not in (None, "", "Unknown") else ""
        return (f'<a class="ev {st}" href="{href}"><span class="top">{tile(b.get("img"), b.get("name"))}<span><span class="title">{e((s or {}).get("name") or b["name"])}</span>'
                f'<span class="cat">{e(ev.get("name"))}{cat}</span></span></span><span class="obj">{e(b.get("how") or "")}</span>'
                f'<span class="foot"><span class="st {st}"></span><span class="lbl">{when}</span><span class="pill {b.get("cost") or "na"}">{cost}</span></span></a>')
    groups = {"live": [], "soon": [], "tba": []}
    for ev in events:
        st = status(ev, now)
        if st == "tba" and is_stale(ev, by_img, now): continue
        if st in groups:
            for b in ev.get("badges", []): groups[st].append((ev, b))
    groups["live"].sort(key=lambda x: x[0]["end"]); groups["soon"].sort(key=lambda x: x[0]["start"])
    fills = {}
    for key, cid, nid in (("live", "evLive", "nLive"), ("soon", "evSoon", "nSoon"), ("tba", "evTba", "nTba")):
        fills[f'<div class="events" id="{cid}"></div>'] = f'<div class="events" id="{cid}">' + ("".join(card(ev, b, key) for ev, b in groups[key]) or '<div class="empty">Nothing here right now.</div>') + "</div>"
        fills[f'<span class="n" id="{nid}"></span>'] = f'<span class="n" id="{nid}">{len(groups[key]) or ""}</span>'
    n = len(groups["live"])
    return page("/timeline/", f"{n} Twitch Badges Available Now – Timeline | Badge Database",
                f"{n} Twitch global badges can be earned right now. See what each one needs, when it ends, and which badges are coming next.",
                "timeline", fills=fills, jsonld=[crumbs_ld(("Home", "/"), ("Timeline", None))])

def channel_page(rows):
    shown = rows[:240]
    items = "".join(f'<a class="brow" href="/channel/{e(r[1])}/" data-cbadge="{e(r[1])}">{tile(r[1], r[0])}<span class="t"><span class="n">{e(r[0])}</span>'
                    f'<span class="m"><span class="pill {e(r[6])}">{CTYPE.get(r[6], r[6])}</span><span class="ch">{e(r[4] or r[3])}</span>{"<span>· " + day(r[2]) + "</span>" if r[2] else ""}</span></span></a>'
                    for r in shown if len(r) >= 7)
    chans = len({r[3] for r in rows if len(r) > 3})
    return page("/channel/", f"{len(rows):,} Twitch Channel Badges – Sub, Watch & Top Supporter | Badge Database",
                f"Browse {len(rows):,} Twitch channel campaign badges from {chans} channels — sub badges, watch-time badges and top-supporter badges, collected automatically.",
                "channel", fills={'<div class="count-line" id="chCount"></div>': f'<div class="count-line" id="chCount">{len(rows):,} campaign badges from {chans} channels</div>',
                                  '<div class="blist" id="gridChannel"></div>': f'<div class="blist" id="gridChannel">{items}</div>'},
                jsonld=[crumbs_ld(("Home", "/"), ("Channel Badges", None))])

def faq_page():
    qa = re.findall(r'<details(?: open)?><summary>(.*?)</summary><div class="a">(.*?)</div></details>', TEMPLATE, flags=re.S)
    strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s))
    ld = {"@context": "https://schema.org", "@type": "FAQPage",
          "mainEntity": [{"@type": "Question", "name": strip(q), "acceptedAnswer": {"@type": "Answer", "text": strip(a)}} for q, a in qa]}
    return page("/faq/", "FAQ – Twitch Badges Explained | Badge Database",
                "How to get Twitch badges, whether gifted subs or Prime count, what time zone the dates use, and how Badge Database tracks every badge.",
                "faq", jsonld=[crumbs_ld(("Home", "/"), ("FAQ", None)), ld])

# ---------------------------------------------------------------- main
def main():
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sets = [s for s in build_sets() if slug_ok(s["set"])]
    sets.sort(key=lambda s: (s["added"] or "0000", s["name"]), reverse=True)
    events = load("events.json", [])
    by_img, ev_of = {}, {}
    for s in sets:
        for v in s["versions"]: by_img[v["img"]] = s
    for ev in events:
        for b in ev.get("badges", []):
            if b.get("img"): ev_of[b["img"]] = (ev, b)
    changed = 0
    recent = sets[:8]
    for s in sets:
        ev, evb = ev_of.get(s["img"], (None, None))
        if not ev:
            for v in s["versions"]:
                if v["img"] in ev_of: ev, evb = ev_of[v["img"]]; break
        if ev and len(ev.get("badges", [])) > 1:
            related = [by_img[b["img"]] for b in ev["badges"] if b.get("img") in by_img and by_img[b["img"]]["set"] != s["set"]]
        else:
            related = [r for r in recent if r["set"] != s["set"]][:6]
        changed += write(f"badges/{s['set']}/index.html", badge_page(s, ev, evb, related, now, stale=is_stale(ev, by_img, now)))
    changed += write("badges/index.html", global_page(sets, ev_of, by_img, now))
    changed += write("timeline/index.html", timeline_page(events, by_img, now))
    changed += write("channel/index.html", channel_page(load("channel-badges.json", [])))
    changed += write("faq/index.html", faq_page())
    changed += write("privacy/index.html", page("/privacy/", "Privacy Policy | Badge Database", "How Badge Database handles personal data: no accounts, no tracking cookies, which third-party services are used, and your rights under the GDPR.", "privacy"))
    changed += write("terms/index.html", page("/terms/", "Terms of Service | Badge Database", "Terms of Service for Badge Database, an independent fan project not affiliated with Twitch: accuracy of badge information, acceptable use and liability.", "terms"))
    changed += write("404.html", page("/404.html", "Badge Database", "Every Twitch badge and when to get it.", "home", noindex=True))
    urls = [("/", now[:10], "hourly", "1.0"), ("/timeline/", now[:10], "hourly", "0.9"), ("/badges/", now[:10], "daily", "0.9"),
            ("/channel/", now[:10], "daily", "0.8"), ("/faq/", None, "monthly", "0.5")]
    urls += [(f"/badges/{s['set']}/", s["added"] or None, "weekly", "0.7") for s in sets]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, lm, cf, pr in urls:
        sm.append(f"  <url><loc>{SITE}{u}</loc>{f'<lastmod>{lm}</lastmod>' if lm else ''}<changefreq>{cf}</changefreq><priority>{pr}</priority></url>")
    sm.append("</urlset>")
    changed += write("sitemap.xml", "\n".join(sm) + "\n")
    changed += write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: {SITE}/sitemap.xml\n")
    print(f"pages: {len(sets)} badge pages + list/timeline/channel/faq, {changed} file(s) changed")

if __name__ == "__main__":
    main()
