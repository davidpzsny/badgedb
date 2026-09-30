"""
Builds crawlable static pages next to the single-page app, so search engines
can index every badge on its own URL:

  /badges/<set-id>/index.html   one page per global badge set
  /badges/index.html            list of all badges (links to every page)
  /timeline/index.html          badges available now / coming up
  /sitemap.xml, /robots.txt, /404.html

Runs in GitHub Actions after check_badges.py. Output is deterministic
(no "x minutes left" text), so files only change when the data changes.
"""
import json, os, html, datetime, re

ROOT = os.path.join(os.path.dirname(__file__), "..")
SITE = os.environ.get("SITE_URL", "").rstrip("/") or "https://badgedatabase.com"
CDN = "https://static-cdn.jtvnw.net/badges/v1/{}/3"
JUNK = re.compile(r"beta_title|_beta$|^beta$|placeholder|default-creator-campaign", re.I)
e = lambda s: html.escape(str(s or ""), quote=True)

def load(name, default):
    try: return json.load(open(os.path.join(ROOT, name), encoding="utf-8"))
    except Exception: return default

def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        open(path, "w", encoding="utf-8").write(text)
        return 1
    return 0

def utc(iso):
    if not iso: return ""
    d = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.strftime("%b %-d, %Y, %H:%M UTC")

def day(iso):
    if not iso: return ""
    d = datetime.date.fromisoformat(iso[:10])
    return d.strftime("%b %-d, %Y")

def status(ev, now):
    if not ev or not ev.get("start"): return "tba"
    if now < ev["start"]: return "soon"
    if now > ev["end"]: return "ended"
    return "live"

# ---------------------------------------------------------------- data
def build_sets():
    rows = load("badges.json", [])
    groups = {}
    for r in rows:
        while len(r) < 7: r.append("")
        if JUNK.search(r[0]) or JUNK.search(r[5] or ""): continue
        key = r[5] or r[1]
        groups.setdefault(key, []).append(r)
    sets = []
    for key, rs in groups.items():
        p = rs[-1]                                    # the bot prepends new rows; the original row is last
        vs = sorted(rs, key=lambda x: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", x[0])])
        dated = sorted(x[2] for x in rs if x[2])
        sets.append({"set": key, "name": p[0], "img": p[1], "added": p[2] or (dated[0] if dated else ""),
                     "free": any(x[3] == 1 for x in rs), "users": max(x[4] or 0 for x in rs),
                     "desc": p[6] or "", "versions": [{"title": x[0], "img": x[1]} for x in vs]})
    return sets

def slug_ok(s): return re.fullmatch(r"[A-Za-z0-9._~-]+", s or "") is not None

# ---------------------------------------------------------------- layout
CSS = """:root{--bg:#0C0B11;--panel:#16151E;--panel2:#1D1C27;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.14);--text:#F4F3F8;--muted:#9490A8;--dim:#5F5D70;--purple:#8B5CF6;--purple2:#A78BFA;--mint:#34D399;--amber:#FBBF24}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Manrope,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}img{display:block}
.top{position:sticky;top:0;z-index:5;background:#111017;border-bottom:1px solid var(--line)}
.top .in{max-width:1080px;margin:0 auto;display:flex;align-items:center;gap:18px;padding:12px 20px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.02em}
.logo img{width:32px;height:32px;border-radius:8px}.logo em{font-style:normal;color:var(--purple2)}
.top nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.top nav a{padding:8px 12px;border-radius:9px;color:var(--muted);font-weight:700;font-size:14px}.top nav a:hover{background:var(--panel);color:var(--text)}
main{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
.crumbs{font-size:13px;color:var(--muted);font-weight:600;display:flex;gap:6px;flex-wrap:wrap}.crumbs a:hover{color:var(--text)}.crumbs span{color:var(--dim)}
h1{font-size:36px;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin:12px 0 8px}
h2{font-size:19px;font-weight:800;margin:0 0 14px}
.lead{color:var(--muted);font-size:16px;max-width:65ch}
.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.pill{font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--muted)}
.pill.free,.pill.live{background:rgba(52,211,153,.14);color:var(--mint)}.pill.paid{background:rgba(139,92,246,.2);color:var(--purple2)}.pill.soon{background:rgba(251,191,36,.14);color:var(--amber)}
.hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;margin-top:18px}
.tile{width:168px;height:168px;border-radius:28px;background:radial-gradient(circle at 30% 30%,#252433,#16151E);border:1px solid var(--line);display:grid;place-items:center}
.tile img{width:108px;height:108px;object-fit:contain}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:26px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.how{font-size:15.5px;line-height:1.65}
dl{display:grid;grid-template-columns:120px 1fr;gap:10px 14px;font-size:14px}dt{color:var(--muted);font-weight:600}dd{word-break:break-word}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;background:var(--panel2);padding:2px 6px;border-radius:6px;color:var(--purple2)}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:11px;background:var(--purple);color:#fff;font-weight:700;font-size:14px}
.btn.ghost{background:var(--panel2);border:1px solid var(--line2);color:var(--text)}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.item{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;text-align:center}
.item:hover{border-color:var(--line2);background:var(--panel2)}
.item img{width:48px;height:48px;object-fit:contain}.item b{font-size:13px;line-height:1.3}.item small{font-size:11.5px;color:var(--muted)}
.rows{display:flex;flex-direction:column;gap:8px}
.row{display:grid;grid-template-columns:44px 1fr auto;gap:14px;align-items:center;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:14px}
.row:hover{border-color:var(--line2)}.row img{width:40px;height:40px;object-fit:contain}.row b{display:block;font-size:14.5px}.row small{color:var(--muted);font-size:12.5px}
.row .when{font-size:12.5px;color:var(--muted);text-align:right;font-weight:600}
section{margin-top:34px}
.vers{display:flex;gap:10px;flex-wrap:wrap}.vers div{display:flex;flex-direction:column;align-items:center;gap:6px;width:92px;font-size:11.5px;color:var(--muted);text-align:center}
.vers img{width:40px;height:40px;object-fit:contain}
footer{border-top:1px solid var(--line);margin-top:40px}
footer .in{max-width:1080px;margin:0 auto;padding:22px 20px 34px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--dim)}
footer a{color:var(--muted);font-weight:600}footer a:hover{color:var(--text)}footer .l{display:flex;gap:14px;flex-wrap:wrap}
@media (max-width:720px){h1{font-size:28px}.hero{grid-template-columns:1fr;gap:16px}.tile{width:120px;height:120px;border-radius:22px}.tile img{width:76px;height:76px}
.grid2{grid-template-columns:1fr}dl{grid-template-columns:100px 1fr}.list{grid-template-columns:repeat(2,1fr)}
.top .in{flex-wrap:wrap;gap:6px;padding:10px 16px 6px}.top nav{margin-left:0;width:100%;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.top nav::-webkit-scrollbar{display:none}
.top nav a{white-space:nowrap;padding:6px 10px;font-size:13px}main{padding:20px 16px 48px}
.row{grid-template-columns:40px 1fr}.row .when{grid-column:2;text-align:left}}
"""

def page(title, desc, path, body, image=None, jsonld=None):
    url = f"{SITE}{path}"
    img = image or f"{SITE}/og-image.png"
    ld = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in (jsonld or []))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Badge Database">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}"><meta property="og:image" content="{e(img)}">
<meta name="twitter:card" content="{'summary' if image else 'summary_large_image'}"><meta name="twitter:site" content="@BadgeDatabase">
<meta name="twitter:title" content="{e(title)}"><meta name="twitter:description" content="{e(desc)}"><meta name="twitter:image" content="{e(img)}">
<meta name="theme-color" content="#0C0B11">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/static.css">
{ld}
</head>
<body>
<header class="top"><div class="in">
  <a class="logo" href="/"><img src="/favicon-32.png" srcset="/icon-192.png 2x" alt="">Badge <em>Database</em></a>
  <nav><a href="/timeline/">Timeline</a><a href="/badges/">Global Badges</a><a href="/#channel">Channel Badges</a><a href="/#faq">FAQ</a></nav>
</div></header>
<main>
{body}
</main>
<footer><div class="in">
  <span>© 2026 Badge Database · Not affiliated with Twitch Interactive, Inc. Badge images © their respective owners.</span>
  <span class="l"><a href="https://twitch.tv/badge_db">Twitch</a><a href="https://discord.gg/QkuRDXcZH5">Discord</a><a href="https://x.com/BadgeDatabase">X</a></span>
</div></footer>
</body>
</html>
"""

def crumbs(*items):
    parts = []
    for i, (name, href) in enumerate(items):
        parts.append(f'<a href="{href}">{e(name)}</a>' if href else e(name))
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, **({"item": SITE + h} if h else {})} for i, (n, h) in enumerate(items)]}
    return '<nav class="crumbs">' + ' <span>/</span> '.join(parts) + '</nav>', ld

# ---------------------------------------------------------------- pages
def badge_page(b, ev, evb, others, now):
    st = status(ev, now)
    cost = (evb or {}).get("cost") or ("free" if b["free"] else "")
    how = (evb or {}).get("how") or ""
    desc_text = b["desc"] or how or "A Twitch global badge."
    cat = (ev or {}).get("category") if ev and ev.get("category") not in (None, "", "Unknown") else ""
    when = f"Available {day(ev['start'])} – {day(ev['end'])}." if ev and ev.get("start") else ""
    meta = f"{b['name']} is a Twitch global badge. {how or desc_text} {when}".strip()
    meta = (meta[:157] + "…") if len(meta) > 158 else meta
    pills = []
    if cost == "free": pills.append('<span class="pill free">Free</span>')
    if cost == "paid": pills.append('<span class="pill paid">Sub / paid</span>')
    pills.append({"live": '<span class="pill live">Active now</span>', "soon": '<span class="pill soon">Upcoming</span>',
                  "ended": '<span class="pill">Ended</span>', "tba": ''}[st])
    rows = [("Set ID", f"<code>{e(b['set'])}</code>"), ("Added", day(b["added"]) or "Before tracking started")]
    if b["users"]: rows.append(("Users", f"{b['users']:,}"))
    if cat: rows.append(("Category", f'<a href="https://www.twitch.tv/directory/category/{e(re.sub(r"[^a-z0-9]+","-",cat.lower()).strip("-"))}?filter=drops" rel="nofollow">{e(cat)}</a>'))
    if ev and ev.get("channel"): rows.append(("Channel", f'<a href="https://twitch.tv/{e(ev["channel"])}" rel="nofollow">{e(ev["channel"])}</a>'))
    if ev and ev.get("start"):
        rows += [("Starts", utc(ev["start"])), ("Ends", utc(ev["end"]))]
    elif ev:
        rows.append(("Dates", "Not announced yet"))
    rows.append(("Versions", str(len(b["versions"]))))
    dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows)
    vers = ""
    if len(b["versions"]) > 1:
        vers = '<section class="card"><h2>Versions</h2><div class="vers">' + "".join(
            f'<div><img src="{CDN.format(v["img"])}" alt="{e(v["title"])}" loading="lazy">{e(v["title"])}</div>' for v in b["versions"]) + '</div></section>'
    rel = ""
    if others:
        rel = '<section><h2>' + ('More from this event' if ev and len(ev.get("badges", [])) > 1 else 'Recently added badges') + '</h2><div class="list">' + "".join(
            f'<a class="item" href="/badges/{e(o["set"])}/"><img src="{CDN.format(o["img"])}" alt="" loading="lazy"><b>{e(o["name"])}</b><small>{day(o["added"])}</small></a>' for o in others) + '</div></section>'
    nav, ld_crumbs = crumbs(("Home", "/"), ("Global Badges", "/badges/"), (b["name"], None))
    body = f"""{nav}
<div class="hero">
  <div class="tile"><img src="{CDN.format(b['img'])}" alt="{e(b['name'])} Twitch badge" width="108" height="108"></div>
  <div><h1>{e(b['name'])}</h1><p class="lead">Twitch global badge{(' · ' + e(cat)) if cat else ''}</p><div class="pills">{''.join(pills)}</div></div>
</div>
<div class="grid2">
  <div class="card"><h2>How to get it</h2><p class="how">{e(how or desc_text)}</p>{f'<p class="how" style="margin-top:10px">{e(ev["about"])}</p>' if ev and ev.get("about") else ''}{f'<p class="how" style="margin-top:10px;color:var(--muted)">{e(b["desc"])}</p>' if b["desc"] and how and b["desc"] != how else ''}
    <div class="btns"><a class="btn" href="/#badge/{e(b['set'])}">Live countdown &amp; details</a><a class="btn ghost" href="/timeline/">All active badges</a></div></div>
  <div class="card"><h2>Details</h2><dl>{dl}</dl></div>
</div>
{vers}
{rel}"""
    ld_page = {"@context": "https://schema.org", "@type": "WebPage", "name": f"{b['name']} – Twitch Global Badge", "description": meta,
               "url": f"{SITE}/badges/{b['set']}/", "primaryImageOfPage": {"@type": "ImageObject", "url": CDN.format(b["img"])},
               "isPartOf": {"@type": "WebSite", "name": "Badge Database", "url": SITE + "/"}}
    if b["added"]: ld_page["datePublished"] = b["added"]
    return page(f"{b['name']} – Twitch Badge | Badge Database", meta, f"/badges/{b['set']}/", body,
                image=CDN.format(b["img"]), jsonld=[ld_crumbs, ld_page])

def index_page(sets):
    items = "".join(f'<a class="item" href="/badges/{e(b["set"])}/"><img src="{CDN.format(b["img"])}" alt="" loading="lazy"><b>{e(b["name"])}</b><small>{day(b["added"]) or "&nbsp;"}</small></a>' for b in sets)
    nav, ld = crumbs(("Home", "/"), ("Global Badges", None))
    body = f"""{nav}<h1>All Twitch Global Badges</h1>
<p class="lead">Every Twitch global badge set — {len(sets)} and counting — newest first. Open a badge to see how to get it, when it is available and all of its versions.</p>
<section><div class="list">{items}</div></section>"""
    return page(f"All {len(sets)} Twitch Global Badges – Full List | Badge Database",
                f"The complete list of all {len(sets)} Twitch global badges with images, how to get each one, and when it is available. Updated automatically.",
                "/badges/", body, jsonld=[ld])

def timeline_page(events, by_img, now):
    def row(ev, b):
        s = by_img.get(b.get("img"))
        href = f"/badges/{s['set']}/" if s else "/#timeline"
        cost = {"free": "Free", "paid": "Sub / paid"}.get(b.get("cost"), "")
        when = f"{day(ev['start'])} – {day(ev['end'])}" if ev.get("start") else "Date not announced"
        return f'<a class="row" href="{href}"><img src="{CDN.format(b["img"]) if b.get("img") else "/favicon-32.png"}" alt="" loading="lazy"><span><b>{e((s or {}).get("name") or b["name"])}</b><small>{e(b.get("how") or "")}</small></span><span class="when">{when}{("<br>" + cost) if cost else ""}</span></a>'
    groups = {"live": [], "soon": [], "tba": []}
    for ev in events:
        st = status(ev, now)
        if st in groups:
            for b in ev.get("badges", []): groups[st].append((ev, b))
    groups["live"].sort(key=lambda x: x[0]["end"]); groups["soon"].sort(key=lambda x: x[0]["start"])
    secs = ""
    for key, title in (("live", "Available right now"), ("soon", "Coming up"), ("tba", "Announced, dates not confirmed")):
        if groups[key]:
            secs += f'<section><h2>{title} ({len(groups[key])})</h2><div class="rows">' + "".join(row(ev, b) for ev, b in groups[key]) + '</div></section>'
    nav, ld = crumbs(("Home", "/"), ("Timeline", None))
    body = f"""{nav}<h1>Twitch Badges Available Now</h1>
<p class="lead">Every Twitch global badge you can earn right now and the ones coming next, with start and end dates. For live countdowns open the <a href="/#timeline" style="color:var(--purple2);font-weight:700">interactive timeline</a>.</p>
{secs}"""
    n = len(groups["live"])
    return page(f"{n} Twitch Badges Available Now – Timeline | Badge Database",
                f"{n} Twitch global badges can be earned right now. See what each one needs, when it ends, and which badges are coming next.",
                "/timeline/", body, jsonld=[ld])

def not_found():
    return page("Page not found | Badge Database", "This page does not exist.", "/404.html",
                '<h1>Page not found</h1><p class="lead">This page does not exist (anymore).</p><div class="btns"><a class="btn" href="/">Go to the homepage</a><a class="btn ghost" href="/badges/">Browse all badges</a></div>')

# ---------------------------------------------------------------- main
def main():
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sets = [s for s in build_sets() if slug_ok(s["set"])]
    sets.sort(key=lambda s: (s["added"] or "0000", s["name"]), reverse=True)
    events = load("events.json", [])
    by_img = {}
    for s in sets:
        for v in s["versions"]: by_img[v["img"]] = s
    ev_of = {}
    for ev in events:
        for b in ev.get("badges", []):
            if b.get("img"): ev_of[b["img"]] = (ev, b)
    changed = 0
    changed += write("assets/static.css", CSS)
    recent = sets[:8]
    for s in sets:
        ev, evb = ev_of.get(s["img"], (None, None))
        if not ev:
            for v in s["versions"]:
                if v["img"] in ev_of: ev, evb = ev_of[v["img"]]; break
        if ev and len(ev.get("badges", [])) > 1:
            others = [by_img[b["img"]] for b in ev["badges"] if b.get("img") in by_img and by_img[b["img"]]["set"] != s["set"]]
        else:
            others = [r for r in recent if r["set"] != s["set"]][:6]
        changed += write(f"badges/{s['set']}/index.html", badge_page(s, ev, evb, others, now))
    changed += write("badges/index.html", index_page(sets))
    changed += write("timeline/index.html", timeline_page(events, by_img, now))
    changed += write("404.html", not_found())
    urls = [("/", now[:10], "hourly", "1.0"), ("/timeline/", now[:10], "hourly", "0.9"), ("/badges/", now[:10], "daily", "0.9")]
    urls += [(f"/badges/{s['set']}/", s["added"] or None, "weekly", "0.7") for s in sets]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, lm, cf, pr in urls:
        sm.append(f"  <url><loc>{SITE}{u}</loc>{f'<lastmod>{lm}</lastmod>' if lm else ''}<changefreq>{cf}</changefreq><priority>{pr}</priority></url>")
    sm.append("</urlset>")
    changed += write("sitemap.xml", "\n".join(sm) + "\n")
    changed += write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")
    print(f"static pages: {len(sets)} badge pages, {changed} file(s) changed")

if __name__ == "__main__":
    main()
