# Badge Database

**[badgedatabase.com](https://badgedatabase.com)** — every Twitch badge, and exactly when to get it.

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
| Home | `/` | "Badges available right now" calendar, stats, 24/7 stream (loads on click), recent badges |
| Timeline | `/timeline/` | Active now · Coming up · Date not announced, with a week / 4-week calendar (finished badges are hidden) |
| Global Badges | `/badges/` | Every global badge set — filters: Free, Paid, Active, Ends soon, Upcoming, No date yet |
| Badge page | `/badges/<set-id>/` | Images, objective, category, channels, start/end, Twitch description, chat preview with your own name, **Add to calendar** |
| Channel Badges | `/channel/` · `/channel/<image-id>/` | Campaign badges (sub / watch / top supporter) collected from live channels |
| Global Emotes | `/emotes/` | All global emotes; new ones get a date, removed ones move to "Removed" |
| Badge Popularity | `/popularity/` | Badges ranked by users seen wearing them (data: PotatBotat) |
| Statistics | `/stats/` | Badges per month / year, free vs paid, games with the most badges |
| Contact | `/contact/` | Email / Discord / X, and a form that opens a pre-filled email (badge pages link here with "Report a mistake") |
| FAQ, Privacy, Terms, Legal Notice | `/faq/` `/privacy/` `/terms/` `/legal/` | Legal Notice: operator, hosting, trademarks, content removal, credits |
| Not found | any unknown URL | Real 404 page (HTTP 404) with "Did you mean" suggestions and search |
| Event editor | `/admin/` | Owner only — dates, objectives, channels, popularity update |

Also on every page:
- **Quick search** — `Ctrl+K` / `⌘K` or `/` (or the search button): badges, events, channel badges, emotes and pages.
- **Log in with Twitch** (optional) — previews badges next to your own name and chat colour. No permissions are requested; everything stays in the visitor's browser.

Old links with `#` (`/#global`, `/#badge/<set>`) redirect to the new URLs automatically.

---

## How it works

Static site on GitHub Pages + a bot in GitHub Actions that runs **every 15 minutes**:

1. **Global badges** (official Twitch API) — new badge → `badges.json`, X post with a generated image,
   Discord post (if set up), timeline entry. Titles and descriptions are re-read every run.
2. **Descriptions → details** — from Twitch's description the bot fills in category, objective
   ("Watch 60 minutes…") and free / paid. Badges of the same campaign are grouped into one event.
   A placeholder badge entered by hand is linked to the real badge once Twitch publishes it.
3. **Dates** — Twitch's API has no badge dates. The bot takes them from Twitch *reward campaigns* in the
   same category when one exists (uses the `TWITCH_GQL_OAUTH` login). Otherwise dates are entered in `/admin/`.
4. **Link reply on X** — after a new badge post, as soon as its page is online the bot replies with the link
   (switch off with variable `X_LINK_REPLY = 0`).
5. **Global emotes** — tracked from the official API (first-seen and removed dates).
6. **Popularity** — tries PotatBotat once a day. potat.app blocks requests from GitHub's servers, so for now
   it is updated by hand (see below).
7. **Channel badges** — collected from the top live channels and from `channels.txt`.
8. **Pages** — builds a real, pre-filled page for every URL above (same design as the live site),
   plus `sitemap.xml`, `robots.txt` and `404.html`. Asset links get a version number (`?v=…`) so
   browsers never keep an old `app.js` / `app.css`.

Rules the site applies by itself:
- An event without dates whose badge has been on Twitch for **21+ days** counts as ended.
- Finished badges leave the timeline and calendars immediately; they stay in the archive as "Ended".
- Anything set by hand in `/admin/` is never overwritten by the bot.

---

## Repository layout

```
index.html                page shell (layout, sidebar, all sections) — edit by hand
assets/app.css            styles
assets/app.js             site logic (routing, calendar, search, admin, login, …)
assets/fonts/             self-hosted Manrope font (SIL Open Font License, OFL.txt)

badges.json               global badges                   ← bot
events.json               events: dates, objectives, channels ← bot + /admin/
channel-badges.json       channel campaign badges         ← bot
emotes.json               global emotes                   ← bot
popularity.json           badge user counts               ← /admin/ (bot when potat allows it)
posts.json                X posts awaiting a link reply   ← bot
status.json               last run report (popularity, emotes) — check this first when debugging
channels-state.json       crawler bookkeeping             ← bot
channels.txt              extra channels to always check (one per line)

badges/ timeline/ channel/ emotes/ popularity/ stats/ faq/ contact/ privacy/ terms/ legal/
404.html sitemap.xml robots.txt     generated by the bot — don't edit

bot/check_badges.py       the bot
bot/build_pages.py        builds the pages from index.html
bot/requirements.txt
.github/workflows/badges.yml        runs everything every 15 minutes

favicon*, icon-*, apple-touch-icon.png, site.webmanifest, logo*.png, og-image.png, CNAME
```

---

## Everyday use

### A badge has no dates
Open **[badgedatabase.com/admin/](https://badgedatabase.com/admin/)** → **Needs info** → open the event →
set **Starts / Ends** (your local time), objective, Free / Sub, optional **Channels** (comma separated;
tick "only part of the participating channels" if the list is incomplete) → **Save changes**.
A badge from any date can be added to an event with the "+ Add a badge to this event" list.

### Update badge popularity (about once a week)
`/admin/` → **Update popularity** → open the `api.potat.app/twitch/badges` link → `Ctrl+A`, `Ctrl+C` →
paste into the box → **Save popularity**.

### Run the bot now
**Actions → Check Twitch badges → Run workflow.** The log of step *Detect new badges and post*
shows new badges, `twitch campaigns: …`, `global emotes: …`, `popularity: …`, `channel badges: …`.

### Other
- Extra channels for channel badges: add them to `channels.txt`.
- X post text / image: `bot/check_badges.py` → `post_to_x()` / `make_card()`.

---

## Setup (done — for reference)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Name | What |
|---|---|
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch app (dev.twitch.tv/console). The public client ID is also written into the pages for "Log in with Twitch". |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X app keys (Read and write) for @BadgeDatabase |
| `TWITCH_GQL_OAUTH` | `auth-token` of a **separate** helper Twitch account, used for reward-campaign dates. If it expires: log in in an incognito window, copy a fresh one, don't log out. |
| `DISCORD_WEBHOOK` | optional — post new badges to a Discord channel |

**Variables** (*Variables* tab): `SITE_URL` = `https://badgedatabase.com` · optional `X_LINK_REPLY` = `0`
(no link replies) · optional `DRY_RUN` = `1` (test without posting).

**Admin token** (stored only in your browser): github.com/settings/personal-access-tokens → fine-grained →
*Only select repositories* → `badgedb` → *Repository permissions → Contents: Read and write*.

**Twitch app**: OAuth Redirect URLs `https://badgedatabase.com/` and `https://www.badgedatabase.com/`.

**Hosting**: GitHub Pages (branch `main`, root), custom domain `badgedatabase.com` (Namecheap: 4 A records
to GitHub Pages + `www` CNAME to `davidpzsny.github.io.`), Enforce HTTPS on. Google Search Console is
verified with a DNS TXT record — don't delete it. Sitemap: `https://badgedatabase.com/sitemap.xml`.

**Email**: `support@badgedatabase.com` is a Namecheap email forward (Domain → Redirect Email).

**Workflow**: `actions/checkout@v5`, `actions/setup-python@v6`, `runs-on: ubuntu-24.04`. If files are
uploaded while the bot runs, that run skips saving and the next run redoes it (no failure).

**Costs**: X API pay-per-use (link posts cost more), capped in the X developer console. Everything else is free.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site unstyled or old version | Wait for Actions → *pages build and deployment* to finish, then Ctrl+F5 (or run the workflow once so the asset version updates). |
| Popularity shows old numbers | potat.app blocks the bot — update by hand in `/admin/`. |
| `/admin/` save fails with 403 | The admin token lacks *Contents: Read and write* on `badgedb`. |
| Log: `TWITCH_GQL_OAUTH token was rejected` | Copy a fresh `auth-token` for the helper account into the secret. |
| Log: `posting failed` | Check X credit and that the X app still has *Read and write*. |
| "Log in with Twitch" missing | `TWITCH_CLIENT_ID` must be passed to the *Build SEO pages* step; run the workflow once. |
| Something else | Open `status.json` in the repo — the bot writes its last results there. |

---

Not affiliated with Twitch Interactive, Inc. Badge images © their respective owners.
Badge popularity data: [PotatBotat](https://potat.app). Font: Manrope (SIL Open Font License).
