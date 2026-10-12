"""Keep the Discord server's Events list in sync with events.json (the site's Timeline).

Needs a Discord bot (not a webhook) that is on the server with the "Create Events" / "Manage Events" permission:
  DISCORD_BOT_TOKEN   repo secret
  DISCORD_GUILD_ID    repo variable (falls back to the BadgeDatabase server id)

One Discord "external" event per site event: name, start/end, how to get each badge, location = the badge page.
Running events are set to "Happening now", ended ones are closed. The mapping lives in discord-events.json.
"""
import base64, datetime, json, os, time
import requests

API = "https://discord.com/api/v10"
DEFAULT_GUILD = "1549031412638679083"
MAP_DB = "discord-events.json"          # {site_event_id: {"id": discord_event_id, "sig": "..."}}
MAX_NEW_PER_RUN = 6                     # Discord rate-limits event creation; the rest follow on the next runs
HORIZON_DAYS = 60                       # don't list events that start further away than this
SCHEDULED, ACTIVE, COMPLETED = 1, 2, 3


def _dt(t): return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
def _iso(d): return d.astimezone(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Discord:
    def __init__(self, token, guild):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bot {token}", "Content-Type": "application/json",
                               "User-Agent": "BadgeDatabaseBot (https://badgedatabase.com, 1.0)"})
        self.guild = guild

    def call(self, method, path, body=None):
        for _ in range(4):
            r = self.s.request(method, API + path, json=body, timeout=30)
            if r.status_code == 429:
                time.sleep(float((r.json() or {}).get("retry_after", 5)) + 0.5); continue
            if r.status_code >= 400:
                raise RuntimeError(f"{method} {path} -> {r.status_code} {r.text[:300]}")
            return r.json() if r.content else None
        raise RuntimeError(f"{method} {path} -> still rate limited")


def describe(ev, site, links):
    lines = []
    for b in ev.get("badges", []):
        how = (b.get("how") or "").strip() or "Details not announced yet."
        lines.append(f"• {b.get('name') or 'Badge'}: {how}")
    lines.append("")
    lines.append(f"Details and all dates: {links}")
    lines.append(f"Timeline: {site}/timeline/")
    return "\n".join(lines)[:1000]


def sync_discord_events(events, live, site, make_card=None, status=print, root="."):
    token = (os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    if not token:
        return
    dc = Discord(token, (os.environ.get("DISCORD_GUILD_ID") or DEFAULT_GUILD).strip())
    path = os.path.join(root, MAP_DB)
    mapping = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    existing = {e["id"]: e for e in dc.call("GET", f"/guilds/{dc.guild}/scheduled-events") or []}
    by_img = {b["img"]: b for b in live}
    now = datetime.datetime.now(datetime.timezone.utc)
    created = updated = started = closed = 0
    errors = []

    for ev in events:
        if not ev.get("id") or not ev.get("start") or not ev.get("end"):
            continue
        start, end = _dt(ev["start"]), _dt(ev["end"])
        known = mapping.get(ev["id"])
        dev = existing.get(known["id"]) if known else None
        try:
            # finished on the site: close (or drop) the Discord event
            if end <= now:
                if dev:
                    if dev["status"] == ACTIVE:
                        dc.call("PATCH", f"/guilds/{dc.guild}/scheduled-events/{dev['id']}", {"status": COMPLETED})
                    elif dev["status"] == SCHEDULED:
                        dc.call("DELETE", f"/guilds/{dc.guild}/scheduled-events/{dev['id']}")
                    closed += 1
                mapping.pop(ev["id"], None)
                continue
            if start > now + datetime.timedelta(days=HORIZON_DAYS):
                continue

            metas = [by_img[b["img"]] for b in ev.get("badges", []) if b.get("img") in by_img]
            page = f"{site}/badges/{metas[0]['set']}/" if metas else f"{site}/timeline/"
            body = {
                "name": ev["name"][:100],
                "description": describe(ev, site, page),
                "entity_metadata": {"location": page[:100]},
                "scheduled_end_time": _iso(end),
            }
            sig = json.dumps([body, ev["start"]], sort_keys=True)

            if not dev:                                          # new (or deleted by hand on Discord): create it
                if created >= MAX_NEW_PER_RUN:
                    continue
                # Discord does not accept a start in the past: running events start in a minute and are
                # switched to "Happening now" on the next run
                body.update({"privacy_level": 2, "entity_type": 3,
                             "scheduled_start_time": _iso(max(start, now + datetime.timedelta(minutes=2)))})
                if make_card and metas:
                    try:
                        pngs = [requests.get(m["url"], timeout=30).content for m in metas[:5]]
                        card = make_card(pngs, ev["name"], header="TWITCH BADGE EVENT",
                                         header_sub=f"{start:%b %-d} - {end:%b %-d, %Y}")
                        body["image"] = "data:image/png;base64," + base64.b64encode(card).decode()
                    except Exception as e:
                        print("discord events: cover image skipped ->", e)
                res = dc.call("POST", f"/guilds/{dc.guild}/scheduled-events", body)
                mapping[ev["id"]] = {"id": res["id"], "sig": sig}
                created += 1
                continue

            if dev["status"] == SCHEDULED and start <= now and _dt(dev["scheduled_start_time"]) <= now:
                dc.call("PATCH", f"/guilds/{dc.guild}/scheduled-events/{dev['id']}", {"status": ACTIVE})
                started += 1
            if known.get("sig") != sig:                         # dates, name or objectives changed on the site
                patch = dict(body)
                if dev["status"] == SCHEDULED and start > now:
                    patch["scheduled_start_time"] = _iso(start)
                dc.call("PATCH", f"/guilds/{dc.guild}/scheduled-events/{dev['id']}", patch)
                known["sig"] = sig
                updated += 1
        except Exception as e:
            errors.append(f"{ev['id']}: {e}")
            print("discord events:", ev["id"], "->", e)

    json.dump(mapping, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    msg = f"{created} created, {started} started, {updated} updated, {closed} closed" + (f", {len(errors)} errors: {errors[:2]}" if errors else "")
    print("discord events:", msg)
    status("discord_events", msg)
