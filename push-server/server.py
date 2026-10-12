#!/usr/bin/env python3
"""BadgeDatabase "Remind me" server (browser push notifications).

The website asks this server to remember "notify this browser about event X".
The server then sends a push notification:
  - when the dates of an event get announced (if it had none when the reminder was set),
  - when the event starts,
  - before it ends: 24 hours before, or 2 hours before if the event (or the reminder) is shorter than that.
When the event is over, the reminder is deleted.

What is stored: the browser's push address (endpoint + its two encryption keys) and event ids.
No IP addresses, no names, no Twitch accounts, no access logs.

Endpoints (all JSON):
  GET  /push/key      -> {"key": "<public VAPID key>"}
  POST /push/remind   {"sub": <PushSubscription JSON>, "event": "<event id>", "on": true|false} -> {"ok": true, "events": [...]}
  POST /push/list     {"endpoint": "<push endpoint>"} -> {"events": [...]}
  GET  /push/health   -> {"ok": true, "events": <events known>}

Settings come from /opt/badgedb-push/.env (see install.sh). Runs behind Caddy, which adds HTTPS.
"""
import base64
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

DIR = os.environ.get("PUSH_DIR") or os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIR, "push.db")
KEY_PATH = os.path.join(DIR, "vapid_private.pem")
SITE = os.environ.get("SITE_URL", "https://badgedatabase.com").rstrip("/")
DATA = os.environ.get("DATA_URL", SITE).rstrip("/")          # where events.json and badges.json are read from
PORT = int(os.environ.get("PUSH_PORT", "8787"))
CONTACT = os.environ.get("VAPID_CONTACT", "mailto:support@badgedatabase.com")
ORIGINS = {o.strip().rstrip("/") for o in os.environ.get("ALLOW_ORIGINS", f"{SITE},https://www.badgedatabase.com").split(",") if o.strip()}
# push services of Chrome/Edge/Opera/Brave/Samsung (Google), Firefox (Mozilla), Safari (Apple), old Edge (Windows)
PUSH_HOSTS = ("googleapis.com", "mozilla.com", "push.apple.com", "notify.windows.com")
TEST_HOSTS = {h.strip() for h in os.environ.get("PUSH_TEST_HOSTS", "").split(",") if h.strip()}   # local tests only
TICK = int(os.environ.get("PUSH_TICK", "60"))                   # seconds between checks
REFRESH = int(os.environ.get("PUSH_REFRESH", "300"))            # seconds between events.json downloads
MAX_PER_BROWSER = 100
MAX_BROWSERS = 50000
HOUR, DAY = 3600, 86400

def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)

# ---------- VAPID key (created once, kept in vapid_private.pem) ----------
def load_vapid():
    if os.path.exists(KEY_PATH):
        v = Vapid.from_file(private_key_file=KEY_PATH)
    else:
        v = Vapid()
        v.generate_keys()
        v.save_key(KEY_PATH)
        os.chmod(KEY_PATH, 0o600)
        log("created a new VAPID key")
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return v, base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

VAPID, PUBLIC_KEY = load_vapid()

# ---------- database ----------
DB_LOCK = threading.Lock()
DB = sqlite3.connect(DB_PATH, check_same_thread=False)
DB.executescript("""
CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (
  endpoint TEXT NOT NULL, event TEXT NOT NULL, created INTEGER NOT NULL,
  sent_dates INTEGER NOT NULL DEFAULT 0, sent_start INTEGER NOT NULL DEFAULT 0, sent_end INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint, event));
""")
DB.commit()

def q(sql, args=(), commit=False):
    with DB_LOCK:
        cur = DB.execute(sql, args)
        rows = cur.fetchall()
        if commit:
            DB.commit()
        return rows

# ---------- events (read from the website, refreshed every few minutes) ----------
EVENTS, EV_LOADED = {}, 0.0

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "BadgeDatabase-push/1.0", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None

def refresh_events(force=False):
    global EVENTS, EV_LOADED
    if not force and time.time() - EV_LOADED < REFRESH:
        return
    try:
        evs = fetch_json(DATA + "/events.json")
        try:
            badges = fetch_json(DATA + "/badges.json")
        except Exception:
            badges = []
        set_by_img = {}
        for row in badges if isinstance(badges, list) else []:
            if isinstance(row, list) and len(row) > 5 and row[1] and row[5]:
                set_by_img.setdefault(row[1], row[5])
        out = {}
        for ev in evs:
            if not isinstance(ev, dict) or not ev.get("id"):
                continue
            bs = [b for b in ev.get("badges", []) if isinstance(b, dict)]
            first = next((b for b in bs if b.get("img") in set_by_img), None)
            url = f"{SITE}/badges/{set_by_img[first['img']]}/" if first else f"{SITE}/timeline/?event={ev['id']}"
            name = bs[0]["name"] if len(bs) == 1 and bs[0].get("name") else ev.get("name") or ev["id"]
            how = next((b.get("how") for b in bs if b.get("how") and not re.match(r"objective not", b["how"], re.I)), "")
            img = next((b["img"] for b in bs if b.get("img")), "")
            out[ev["id"]] = {"name": name, "start": ts(ev.get("start")), "end": ts(ev.get("end")), "how": how, "url": url,
                             "icon": f"https://static-cdn.jtvnw.net/badges/v1/{img}/3" if img else f"{SITE}/icon-192.png"}
        if out:
            EVENTS, EV_LOADED = out, time.time()
    except Exception as e:
        log("could not read events.json:", e)
        EV_LOADED = time.time() - REFRESH + 60          # try again in a minute

# ---------- sending ----------
def utc(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%b %-d, %H:%M UTC")

def clip(s, n=170):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"

def send(endpoint, p256dh, auth, payload, ttl):
    """True = delivered, False = try again later, None = this browser is gone (delete it)."""
    try:
        webpush({"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}, json.dumps(payload),
                vapid_private_key=VAPID, vapid_claims={"sub": CONTACT}, ttl=ttl, timeout=15,
                headers={"Urgency": "high"})
        return True
    except WebPushException as e:
        code = getattr(e.response, "status_code", None)
        if code in (400, 401, 403, 404, 410):
            return None
        log("push failed:", code, str(e)[:160])
        return False
    except Exception as e:
        log("push failed:", e)
        return False

def lead_time(ev, created):
    """24 hours before the end, or 2 hours if there was less than ~30 hours between start (or the reminder) and the end."""
    begin = max(created, ev["start"] or created)
    return DAY if ev["end"] - begin > 30 * HOUR else 2 * HOUR

def drop_browser(endpoint):
    q("DELETE FROM reminders WHERE endpoint=?", (endpoint,))
    q("DELETE FROM subs WHERE endpoint=?", (endpoint,), commit=True)

def tick():
    refresh_events()
    if not EVENTS:
        return
    now = time.time()
    rows = q("""SELECT r.endpoint, r.event, r.created, r.sent_dates, r.sent_start, r.sent_end, s.p256dh, s.auth
                FROM reminders r JOIN subs s ON s.endpoint = r.endpoint""")
    gone = set()
    for endpoint, evid, created, s_dates, s_start, s_end, p256dh, auth in rows:
        if endpoint in gone:
            continue
        ev = EVENTS.get(evid)
        if not ev:
            if now - created > 30 * DAY:                       # removed from the site long ago
                q("DELETE FROM reminders WHERE endpoint=? AND event=?", (endpoint, evid), commit=True)
            continue
        start, end = ev["start"], ev["end"]
        if end and now >= end:                                  # over: the reminder is done
            q("DELETE FROM reminders WHERE endpoint=? AND event=?", (endpoint, evid), commit=True)
            continue
        msg, mark = None, None
        if start and now >= start and not s_start:
            left = f" Ends {utc(end)}." if end else ""
            msg = {"title": f"Now available: {ev['name']}", "body": clip((ev["how"] or "You can earn this Twitch badge now.") + left),
                   "tag": f"{evid}-start", "ttl": 6 * HOUR}
            mark = "sent_start=1, sent_dates=1"
            if end and end - now <= lead_time(ev, created):     # short event: this message is also the last-chance one
                mark += ", sent_end=1"
        elif start and now < start and not s_dates:
            msg = {"title": f"Dates announced: {ev['name']}", "body": f"Starts {utc(start)}" + (f", ends {utc(end)}." if end else ".") + " We'll remind you when it begins.",
                   "tag": f"{evid}-dates", "ttl": DAY}
            mark = "sent_dates=1"
        elif end and start and now >= start and not s_end and end - now <= lead_time(ev, created):
            h = int((end - now) // HOUR)
            left = "Less than an hour left" if h < 1 else f"About {h} hour{'s' if h != 1 else ''} left"
            msg = {"title": f"Ends soon: {ev['name']}", "body": clip(f"{left} to get this badge. {ev['how']}"),
                   "tag": f"{evid}-end", "ttl": 2 * HOUR}
            mark = "sent_end=1"
        if not msg:
            continue
        ttl = msg.pop("ttl")
        ok = send(endpoint, p256dh, auth, {**msg, "icon": ev["icon"], "url": ev["url"]}, ttl)
        if ok is None:
            gone.add(endpoint)
            drop_browser(endpoint)
            log("browser unsubscribed, removed")
        elif ok:
            q(f"UPDATE reminders SET {mark} WHERE endpoint=? AND event=?", (endpoint, evid), commit=True)
            log("sent", msg["tag"])
    q("DELETE FROM subs WHERE endpoint NOT IN (SELECT endpoint FROM reminders)", commit=True)

def loop():
    while True:
        try:
            tick()
        except Exception as e:
            log("tick error:", e)
        time.sleep(TICK)

# ---------- HTTP API ----------
B64 = re.compile(r"^[A-Za-z0-9_-]+={0,2}$")
RATE, RATE_LOCK = {}, threading.Lock()

def endpoint_ok(url):
    if not isinstance(url, str) or len(url) > 1000:
        return False
    u = urlparse(url)
    if u.netloc in TEST_HOSTS and u.scheme in ("http", "https"):
        return True
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)

def events_of(endpoint):
    return [r[0] for r in q("SELECT event FROM reminders WHERE endpoint=? ORDER BY created, rowid", (endpoint,))]

class Handler(BaseHTTPRequestHandler):
    server_version = "BadgeDB-push"
    sys_version = ""

    def log_message(self, *a):                                  # no access log (privacy)
        pass

    def cors(self):
        o = (self.headers.get("Origin") or "").rstrip("/")
        if o in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def limited(self):
        ip = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        now = time.time()
        with RATE_LOCK:
            if len(RATE) > 5000:
                RATE.clear()
            start, n = RATE.get(ip, (now, 0))
            if now - start > 60:
                start, n = now, 0
            RATE[ip] = (start, n + 1)
            return n + 1 > 40                                   # 40 requests a minute per visitor is plenty

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/push/key":
            return self.reply(200, {"key": PUBLIC_KEY})
        if path == "/push/health":
            return self.reply(200, {"ok": True, "events": len(EVENTS)})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if self.limited():
            return self.reply(429, {"error": "Too many requests, try again in a minute."})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 8192:
                return self.reply(413, {"error": "bad size"})
            data = json.loads(self.rfile.read(n))
            if not isinstance(data, dict):
                raise ValueError
        except Exception:
            return self.reply(400, {"error": "bad json"})

        if path == "/push/list":
            ep = data.get("endpoint")
            return self.reply(200, {"events": events_of(ep) if endpoint_ok(ep) else []})

        if path != "/push/remind":
            return self.reply(404, {"error": "not found"})
        sub, evid, on = data.get("sub") or {}, str(data.get("event") or ""), data.get("on", True) is not False
        ep = sub.get("endpoint") if isinstance(sub, dict) else None
        keys = sub.get("keys") if isinstance(sub, dict) and isinstance(sub.get("keys"), dict) else {}
        p256dh, auth = str(keys.get("p256dh") or ""), str(keys.get("auth") or "")
        if not endpoint_ok(ep) or not (60 <= len(p256dh) <= 120 and B64.match(p256dh)) or not (10 <= len(auth) <= 40 and B64.match(auth)):
            return self.reply(400, {"error": "This browser's push subscription looks invalid."})
        if not on:
            q("DELETE FROM reminders WHERE endpoint=? AND event=?", (ep, evid), commit=True)
            q("DELETE FROM subs WHERE endpoint=? AND endpoint NOT IN (SELECT endpoint FROM reminders)", (ep,), commit=True)
            return self.reply(200, {"ok": True, "events": events_of(ep)})

        refresh_events()
        ev = EVENTS.get(evid)
        if not ev:
            return self.reply(404 if EVENTS else 503, {"error": "Unknown event." if EVENTS else "Not ready yet, try again in a minute."})
        now = time.time()
        if ev["end"] and ev["end"] - now < 2 * HOUR:
            return self.reply(409, {"error": "This badge ends too soon for a reminder."})
        if not q("SELECT 1 FROM subs WHERE endpoint=?", (ep,)) and q("SELECT COUNT(*) FROM subs")[0][0] >= MAX_BROWSERS:
            return self.reply(503, {"error": "Reminders are full right now."})
        if len(events_of(ep)) >= MAX_PER_BROWSER and evid not in events_of(ep):
            return self.reply(409, {"error": "That's a lot of reminders. Turn some off first."})
        started = 1 if ev["start"] and now >= ev["start"] else 0
        q("INSERT INTO subs (endpoint, p256dh, auth, created) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth",
          (ep, p256dh, auth, int(now)))
        q("INSERT OR IGNORE INTO reminders (endpoint, event, created, sent_dates, sent_start) VALUES (?,?,?,?,?)",
          (ep, evid, int(now), 1 if ev["start"] else 0, started), commit=True)
        return self.reply(200, {"ok": True, "events": events_of(ep)})

def main():
    refresh_events(force=True)
    log(f"Remind me server on 127.0.0.1:{PORT}, {len(EVENTS)} events loaded, origins: {', '.join(sorted(ORIGINS))}")
    threading.Thread(target=loop, daemon=True).start()
    host = os.environ.get("PUSH_HOST", "127.0.0.1")
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "key":                # python server.py key -> print the public key
        print(PUBLIC_KEY)
    else:
        main()
