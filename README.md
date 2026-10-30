# Badge Database

**[badgedatabase.com](https://badgedatabase.com)**: every Twitch badge, and exactly when to get it.

Live countdowns for badges you can earn right now, upcoming drops, the full global badge archive,
channel campaign badges, global emotes, badge popularity and statistics. New badges are announced on
[X @BadgeDatabase](https://x.com/BadgeDatabase) the moment they appear.

- 24/7 stream: [twitch.tv/badge_db](https://twitch.tv/badge_db)
- Discord: [discord.gg/QkuRDXcZH5](https://discord.gg/QkuRDXcZH5)
- Contact: support@badgedatabase.com

---

## Features

| Page | URL | What it shows |
|---|---|---|
| Home | `/` | **Last chance** strip (badges ending within 48 h), stat tiles (Active now · Upcoming · Date TBA · Free today; click one to jump to that part of the timeline), "Badges available right now" calendar, 24/7 stream (loads on click), top categories, most popular badges, recently added |
| Timeline | `/timeline/` | Active now · Coming up · Date not announced, with a week / 4-week calendar (finished badges are hidden) |
| Global Badges | `/badges/` | Every global badge set. Filters: Free, Paid, Active, Ends soon, Upcoming, No date yet |
| Badge page | `/badges/<set-id>/` | **Watch now** (live streams where a running badge can be earned, our channel first when live in that category), images, objective, category, channels, start/end, Twitch description, chat preview with your own name, **Remind me**, **Add to calendar**, **Share** |
| Channel Badges | `/channel/` · `/channel/<image-id>/` | Campaign badges (sub / watch / top supporter) collected from live channels |
| Global Emotes | `/emotes/` | All global emotes; new ones get a date, removed ones move to "Removed" |
| Top Categories | `/categories/` | Top 150 Twitch categories right now: viewers, live channels, biggest stream, badges you can earn there |
| Badge Popularity | `/popularity/` | Badges ranked by users seen wearing them (data: PotatBotat) |
| Statistics | `/stats/` | Badges per month / year, free vs paid, games with the most badges |
| Contact | `/contact/` | Email / Discord / X, and a form that opens a pre-filled email (badge pages link here with "Report a mistake") |
| Leaderboard | `/leaderboard/` | **Coming soon** page. Twitch only shares a badge collection with twitch.tv itself (other sites get 401 / forbidden, tested 2026-10-12), so the ranking needs another data source first |
| Changelog | `/changelog/` | Every update to the site, newest first, filter: New / Improved / Fixed (from `changelog.json`) |
| FAQ, Privacy, Terms, Legal Notice | `/faq/` `/privacy/` `/terms/` `/legal/` | Legal Notice: operator, hosting, trademarks, content removal, credits |
| Not found | any unknown URL | Real 404 page (HTTP 404) with "Did you mean" suggestions and search |
| Event editor | `/admin/` | Owner only: dates, objectives, channels, popularity update |

Also on every page:
- **Phones:** bottom bar with Home / Timeline / Badges / Search / Live (red dot while our channel is live).
- **Changelog dot:** appears next to Changelog (and on the phone menu button) when `changelog.json` has something new since the visitor's last visit (the build writes the newest date + the number of items into `<meta name="changelog-latest">`, e.g. `2026-10-12.0066`, so items added on the same day count too).
- **Theme**: Light / Dark / System switch top right (phones: bottom of the menu). Saved in the browser (`badgedb_theme`); default Dark. Colours are CSS variables in `app.css` (`:root` = dark, `:root[data-theme="light"]` = light).
- **Remind me** (badge pages and event details, for upcoming, undated and running events): browser notification when the
  dates get announced, when it starts and a day before it ends (2 hours before for short events). Runs on our own
  push server (`push-server/`, see below). The buttons only appear when that server answers.
- **Quick search**: `Ctrl+K` / `⌘K` or `/` (or the search button): badges, events, channel badges, emotes and pages.
- **Log in with Twitch** (optional, top right; on phones the icon next to search): previews badges next to your own name and chat colour. No permissions are requested; everything stays in the visitor's browser.

Old links with `#` (`/#global`, `/#badge/<set>`) redirect to the new URLs automatically.

---

## How it works

Static site on GitHub Pages + a bot in GitHub Actions that runs **every 5 minutes** (started by cron-job.org, see
"Bot schedule" below; GitHub's own every-15-minutes schedule is the backup):

1. **Global badges** (official Twitch API): new badge → `badges.json`, X post with a generated image,
   Discord post (if set up), timeline entry. Titles and descriptions are re-read every run.
2. **Descriptions → details**: from Twitch's description the bot fills in category, objective
   ("Watch 60 minutes…") and free / paid. Badges of the same campaign are grouped into one event.
   A placeholder badge entered by hand is linked to the real badge once Twitch publishes it.
3. **Dates**: Twitch's API has no badge dates. The bot takes them from Twitch *reward campaigns* in the
   same category when one exists (uses the `TWITCH_GQL_OAUTH` login). It also tries Twitch *Drops campaigns*,
   but Twitch currently blocks automated access to them ("failed integrity check"). The bot does not try to get
   around that: after a failed attempt it waits until the next day. Drops dates are entered in `/admin/`
   (copy them from [twitch.tv/drops/campaigns](https://www.twitch.tv/drops/campaigns)).
4. **Link reply on X**: after a new badge post, as soon as its page is online the bot replies with the link
   (switch off with variable `X_LINK_REPLY = 0`).
   **"Now available" posts**: when an event with a known start time begins, the bot posts
   "🟢 Now available on Twitch: …" (image, objective, end date in UTC, no countdown) to X and Discord,
   then replies with the link. If the event has several badges, the image shows all of them side by side
   (more than 5: the first 4 and a "+N" tile) and the text lists each badge with its own objective.
   If an event starts within 12 minutes the bot waits and posts right on time; it never posts an event more than
   90 minutes late, never twice, and never for events without dates (switch off with variable `X_LIVE_POSTS = 0`).
   **"Last chance" posts**: when a dated event that ran at least 2 days has less than 24 hours left, the bot posts
   "⏳ Last chance on Twitch: …" with an amber image (objective, end time in UTC), then replies with the link.
   At most 2 per run, never with less than 3 hours left, never twice (switch off with variable `X_ENDING_POSTS = 0`).
5. **Global emotes**: tracked from the official API (first-seen and removed dates).
6. **Popularity**: tries PotatBotat once a day. potat.app blocks requests from GitHub's servers, so for now
   it is updated by hand (see below).
7. **Channel badges**: collected from the top live channels and from `channels.txt`.
   **Watch now**: for every running event: the live streams of its channel list, or the 8 biggest live streams of its
   category, into `live.json`. Our own channel (`badge_db`, or variable `OUR_CHANNEL`) goes first when it is live in that category.
8. **Pages**: builds a real, pre-filled page for every URL above (same design as the live site),
   plus `sitemap.xml`, `robots.txt` and `404.html`. Asset links get a version number (`?v=…`) so
   browsers never keep an old `app.js` / `app.css`.

Rules the site applies by itself:
- An event without dates whose badge has been on Twitch for **21+ days** counts as ended.
- Finished badges leave the timeline and calendars immediately; they stay in the archive as "Ended".
- **Calendars show the newest badges first** (like BadgeBase): ordered by the day Twitch added the badge,
  upcoming ones included; badges of one event stay together. "Active now" cards and "Date not announced"
  are newest first too; "Coming up" is ordered by start time.
- **All counts are badge counts, not event counts** (an event can hold several badges), so the home tiles and
  the timeline headings always show the same numbers.
- Anything set by hand in `/admin/` is never overwritten by the bot.
- Times are shown in the visitor's local time; badge pages and event details add the UTC time in brackets
  ("Oct 15, 06:00 (04:00 UTC)"), so they can be compared with Twitch directly.
- **Speed:** `channel-badges.json` (about 440 KB) is loaded only on the Channel Badges pages and when quick search opens;
  the menu count comes from the build. Data files are fetched with `no-cache`, so returning visitors get a quick
  "not modified" answer instead of downloading them again.

**Remind me server** (`push-server/server.py`, on the same Oracle VM as the Discord bot, behind Caddy for HTTPS at
`api.badgedatabase.com`): stores each reminder (the browser's push address + event id), reads `events.json` from the
site every 5 minutes, checks every minute and sends the notifications. A finished event's reminders are deleted.
No IP addresses or access logs are kept. The site finds it via `CONFIG.pushApi` in `assets/app.js`; `sw.js` shows the
notifications in the browser. Notification links open the badge page, or `/timeline/?event=<id>` for events with
several badges.

---

## Repository layout

```
index.html                page shell (layout, sidebar, all sections), edit by hand
assets/app.css            styles
assets/app.js             site logic (routing, calendar, search, admin, login, …)
assets/fonts/             self-hosted Manrope font (SIL Open Font License, OFL.txt)

badges.json               global badges                   ← bot
events.json               events: dates, objectives, channels ← bot + /admin/
channel-badges.json       channel campaign badges         ← bot
emotes.json               global emotes                   ← bot
popularity.json           badge user counts               ← /admin/ (bot when potat allows it)
posts.json                X posts awaiting a link reply   ← bot
changelog.json            site updates shown on /changelog/   ← by hand (see below)
live.json                 live streams per running event (Watch now) ← bot
status.json               last run report (popularity, emotes, drop campaigns), check this first when debugging
top-categories.json       top 150 Twitch categories        ← bot
channels-state.json       crawler bookkeeping             ← bot
channels.txt              extra channels to always check (one per line)

badges/ timeline/ channel/ emotes/ popularity/ stats/ categories/ faq/ contact/ privacy/ terms/ legal/ changelog/ leaderboard/
404.html sitemap.xml robots.txt     generated by the bot, don't edit

overlay/motorhazteto/      24/7 stream overlay for OBS (see "Stream overlay" below)
sw.js                     service worker: shows Remind me notifications (no offline cache)
push-server/              Remind me server for the VM: server.py, requirements.txt, install.sh
discord-bot/              Discord bot for the VM (/active, /soon, /badge)

bot/check_badges.py       the bot
bot/build_pages.py        builds the pages from index.html
bot/requirements.txt
.github/workflows/badges.yml        runs everything (every 5 min via cron-job.org, every 15 min by GitHub as backup)

logo.svg                  logo source (hexagon, transparent)
logo.png, logo-192.png, logo-320.png, favicon*  transparent PNGs rendered from logo.svg (site, browser tab, X post image)
icon-192/512.png, apple-touch-icon.png  phone home screen icons (solid background on purpose)
site.webmanifest, og-image.png, CNAME
```

---

## Everyday use

### A badge has no dates
Take the exact times (UTC) from the official announcement or the events tracker.
Open **[badgedatabase.com/admin/](https://badgedatabase.com/admin/)** → **Needs info** → open the event →
set **Starts / Ends** (your local time: Hungary is UTC+2 in summer time, UTC+1 in winter), objective, Free / Sub, optional **Channels** (comma separated;
tick "only part of the participating channels" if the list is incomplete) → **Save changes**.
A badge from any date can be added to an event with the "+ Add a badge to this event" list.

### Update badge popularity (about once a week)
`/admin/` → **Update popularity** → open the `api.potat.app/twitch/badges` link → `Ctrl+A`, `Ctrl+C` →
paste into the box → **Save popularity**.

### Run the bot now
**Actions → Check Twitch badges → Run workflow.** The log of step *Detect new badges and post*
shows new badges, `twitch campaigns: …`, `global emotes: …`, `popularity: …`, `channel badges: …`.

### Bot schedule (cron-job.org)
GitHub's own schedule (`cron` in `badges.yml`) is often delayed by an hour or more, so the bot is started every
5 minutes by a job on **cron-job.org**: `POST https://api.github.com/repos/davidpzsny/badgedb/actions/workflows/badges.yml/dispatches`
with body `{"ref":"main"}` and headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`.
The token is a fine-grained GitHub token for this repository only, with **Actions: Read and write**; it lives only in
cron-job.org (never in the repo). When it expires, make a new one and paste it into the job's header. If the job fails,
the bot still runs on GitHub's schedule, just less often. Runs never overlap (`concurrency` in the workflow).

### Add a changelog entry
Every change to the site gets a line on [badgedatabase.com/changelog/](https://badgedatabase.com/changelog/).
GitHub → `changelog.json` → **Edit this file** → add a block at the top (newest first):

```json
 {
  "date": "2026-10-20",
  "title": "Short title",
  "items": [
   {"type": "new", "text": "Something that did not exist before."},
   {"type": "improved", "text": "Something that works better now."},
   {"type": "fixed", "text": "Something that was wrong and is right now."}
  ]
 },
```

`type` is `new`, `improved` or `fixed`. Mind the comma after `}` and keep the quotes. **Commit changes**, then
**Run workflow** so the pre-built page updates too (the live page reads `changelog.json` directly).

### Discord temporarily down
`assets/app.js` → `CONFIG` → `discordDown: true` shows a notice at the top of every page ("Our Discord server is
temporarily unavailable. It will be back soon!"), dims every Discord link and shows a short message instead of
opening the invite. When Discord works again, set it to `false` and upload `app.js` (then Ctrl+F5).

### Remind me server (VM)
Status / log on the VM: `sudo systemctl status badgedb-push` · `sudo journalctl -u badgedb-push -n 50`.
Update to the newest `server.py` from GitHub: run the install command again (reminders and the key are kept):
`curl -fsSL https://raw.githubusercontent.com/davidpzsny/badgedb/main/push-server/install.sh | sudo bash`.
Check from anywhere: [api.badgedatabase.com/push/health](https://api.badgedatabase.com/push/health).
Switch the buttons off: `CONFIG.pushApi = ""` in `assets/app.js`.
Never delete `/opt/badgedb-push/vapid_private.pem`: with a new key every existing reminder stops working.

### Stream overlay (OBS)
The badge_db 24/7 stream shows **[badgedatabase.com/overlay/motorhazteto/](https://badgedatabase.com/overlay/motorhazteto/)**:
OBS → Sources → + → Browser, URL above, Width `1920`, Height `1080`. It is not linked from the site and has `noindex`
(the folder is still visible in this public repo).
- **Events column is automatic:** every running, upcoming and date-TBA event from `events.json` (same rules as the site:
  ended events and date-TBA events older than 21 days drop out), with badge images, UTC times and a description written
  from the badges' objectives. A new badge on the site shows up on the stream within about 5 minutes.
  In `overlay/motorhazteto/index.html`: `EVENT_TITLES` / `EVENT_DESC` (own title or description by event id),
  `EXTRA_EVENTS` (events not on the site yet, UTC times, `start: null` = TBA),
  `EXTRA_AVAILABLE` (header chips added by hand), `ITEMS` (left column fallback).
- **Header "Available here" is automatic:** every 30 seconds the overlay reads badge_db's current Twitch category (decapi.me,
  backup: the bot's `live.json`) and shows the badges of running events in that category from `events.json`
  ("Watch 60 min" / "Sub or Gift"; upcoming ones: countdown, only from 24 hours before an announced start time). Badges that need another channel
  (e.g. "watch twitch.tv/dnd") or a ticket are left out. Matching uses Twitch category ids: the bot writes
  `our_game_id`, `upcoming` (event → game id, next 14 days) and `game_names` (id → Twitch's own name) into `live.json`.
- `HIDE_AVAILABLE_IN` (default `Always On`): in these categories the whole "Available here" part is hidden
  (it also hides itself when there is nothing to show).
- `ANY_CATEGORY_BADGES_IN` (default `Just Chatting`): in these categories the header also shows the running badges
  that can be earned in any category (events with category `Any`, e.g. Pokémon Night Out), only once they can be earned.
  When the chips don't fit next to each other, they take turns, one every 6 seconds.
- The left column ("Added in the last 14 days") and the footer counters come from `badges.json` / `events.json` every 5 minutes.
  Every column scrolls at the same speed (`ROLL_PX_PER_S`, 30 pixels a second); a list that fits in its column stands
  still, and new data (a new badge, user counts, an event starting) never makes a column jump back.
  USERS there is the external badge list's count: `/admin/` → **Overlay user counts** writes `sdb-request.json`, the bot's next run
  (within 5 minutes) loads that badge list once and saves the counts in `popularity.json` under `sdb`
  (`bot/sdb_users.py`; result in `status.json` → `sdb_users`). Badges without a number there fall back to
  PotatBotat's count. The site itself keeps using PotatBotat's counts.
  The last good copy is kept in the browser source, so the overlay stays filled if the data can't be loaded.
- **After every change** set `OVERLAY_V` in `index.html` and `v` in `version.json` to the same new value. The overlay checks
  `version.json` every 30 seconds and reloads itself, so the stream PC needs no action (about 1 to 2 minutes after the commit).

### Visitor statistics (GoatCounter)
Dashboard: **[badgedatabase.goatcounter.com](https://badgedatabase.goatcounter.com)** (pages, where visitors come from,
countries, browsers, screen sizes). No cookies, nothing stored in the browser, no IP addresses kept; described in the
Privacy Policy. Every page counts once, in-site navigation too; `/admin/`, localhost and automated browsers are not counted.
The site code is `CONFIG.goatcounter` in `assets/app.js` (`""` switches counting off).

### Other
- Extra channels for channel badges: add them to `channels.txt`.
- X post text / image: `bot/check_badges.py` → `post_to_x()` / `make_card()`.

---

## Setup (done, for reference)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Name | What |
|---|---|
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch app (dev.twitch.tv/console). The public client ID is also written into the pages for "Log in with Twitch". |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X app keys (Read and write) for @BadgeDatabase |
| `TWITCH_GQL_OAUTH` | `auth-token` of a **separate** helper Twitch account, used for reward-campaign dates. If it expires: log in in an incognito window, copy a fresh one, don't log out. |
| `DISCORD_WEBHOOK` | optional: post new badges to a Discord channel |

**Variables** (*Variables* tab): `SITE_URL` = `https://badgedatabase.com` · optional `X_LINK_REPLY` = `0`
(no link replies) · optional `X_LIVE_POSTS` = `0` (no "Now available" posts) · optional `X_ENDING_POSTS` = `0` (no "Last chance" posts) · optional `DRY_RUN` = `1` (test without posting).

**Admin token** (stored only in your browser): github.com/settings/personal-access-tokens → fine-grained →
*Only select repositories* → `badgedb` → *Repository permissions → Contents: Read and write*.

**Twitch app**: OAuth Redirect URLs `https://badgedatabase.com/` and `https://www.badgedatabase.com/`.

**Hosting**: GitHub Pages (branch `main`, root), custom domain `badgedatabase.com` (Namecheap: 4 A records
to GitHub Pages + `www` CNAME to `davidpzsny.github.io.`), Enforce HTTPS on. Google Search Console is
verified with a DNS TXT record, don't delete it. Sitemap: `https://badgedatabase.com/sitemap.xml`.

**Remind me server** (one time): Namecheap → Domain List → Manage → Advanced DNS → Add New Record →
`A Record`, Host `api`, Value = the VM's public IP. Oracle Cloud → Networking → Virtual cloud networks → the VCN →
Subnets → the subnet → Security → the security list → Add Ingress Rules: Source CIDR `0.0.0.0/0`, TCP, Destination
Port Range `80,443`. Then on the VM: `curl -fsSL https://raw.githubusercontent.com/davidpzsny/badgedb/main/push-server/install.sh | sudo bash`
(installs Python, Caddy for the HTTPS certificate, the `badgedb-push` service, and opens ports 80/443 in the VM's own firewall).

**Email**: `support@badgedatabase.com` is a Namecheap email forward (Domain → Redirect Email).

**Workflow**: `actions/checkout@v5`, `actions/setup-python@v6`, `runs-on: ubuntu-24.04`. If files are
uploaded while the bot runs, that run skips saving and the next run redoes it (no failure).

**Costs**: X API pay-per-use (link posts cost more), capped in the X developer console. Everything else is free.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site unstyled or old version | Wait for Actions → *pages build and deployment* to finish, then Ctrl+F5 (or run the workflow once so the asset version updates). |
| Popularity shows old numbers | potat.app blocks the bot, update by hand in `/admin/`. |
| `/admin/` save fails with 403 | The admin token lacks *Contents: Read and write* on `badgedb`. |
| Log: `TWITCH_GQL_OAUTH token was rejected` | Copy a fresh `auth-token` for the helper account into the secret. |
| A new badge has no dates, but Twitch shows them | It is a Drops campaign. Twitch blocks reading those automatically. Enter the dates in `/admin/` (`status.json` → `drop_campaigns` shows the bot's last attempt). |
| Log: `posting failed` | Check X credit and that the X app still has *Read and write*. |
| "Log in with Twitch" missing | `TWITCH_CLIENT_ID` must be passed to the *Build SEO pages* step; run the workflow once. |
| No Remind me button on badge pages | [api.badgedatabase.com/push/health](https://api.badgedatabase.com/push/health) must answer `{"ok": true…}`. If not: on the VM `sudo systemctl status badgedb-push caddy`, check the `api` DNS record and the 80/443 ingress rules. The button is also hidden for ended badges, badges ending within 3 hours and in browsers without notifications. |
| Remind me says notifications are blocked | The visitor blocked them for the site: browser → site settings → Notifications → Allow. |
| Something else | Open `status.json` in the repo: the bot writes its last results there. |

---

Not affiliated with Twitch Interactive, Inc. Badge images © their respective owners.
Badge popularity data: [PotatBotat](https://potat.app). Font: Manrope (SIL Open Font License).
