# Badge Database

**[badgedatabase.com](https://badgedatabase.com)** — every Twitch badge, and exactly when to get it.

Live countdowns for active badge drops, upcoming events, the full global badge archive and
campaign badges from Twitch channels. New badges are announced on
[X @BadgeDatabase](https://x.com/BadgeDatabase) the moment they appear.

- 24/7 stream: [twitch.tv/badge_db](https://twitch.tv/badge_db)
- Discord: [discord.gg/QkuRDXcZH5](https://discord.gg/QkuRDXcZH5)

---

## How it works

The site is static (GitHub Pages). A bot in GitHub Actions runs **every 15 minutes** and:

1. **Checks Twitch's global badge list** (official Helix API). New badge → added to `badges.json`,
   posted on X with a generated image, and put on the timeline.
2. **Re-reads badge descriptions** every run. When Twitch adds or changes a description, the bot
   fills in the category, the objective (e.g. "Watch 60 minutes") and whether it's free or paid.
3. **Checks Twitch reward campaigns.** If a campaign runs in the same category as an event without
   dates, the bot takes over its start and end date.
4. **Tracks global emotes** (official Helix API) — new emotes get a "first seen" date.
5. **Refreshes badge popularity** once a day from the public [PotatBotat](https://potat.app) API
   (users seen wearing each badge in chats the bot is in).
6. **Collects channel campaign badges** (sub / watch / top-supporter) from the top live channels
   and from `channels.txt`.
7. **Builds the pages**: one real URL per badge, plus the list, timeline, channel, FAQ pages,
   `sitemap.xml` and `robots.txt`.

Anything you set by hand in the admin page is never overwritten by the bot.

---

## URLs

| Page | URL |
|---|---|
| Home (calendar, stream, recent badges) | `/` |
| Timeline | `/timeline/` |
| All global badges | `/badges/` |
| One badge | `/badges/<set-id>/` — e.g. `/badges/wolf-medallion/` |
| Channel badges | `/channel/` |
| One channel badge | `/channel/<image-id>/` |
| Global emotes | `/emotes/` |
| Badge popularity ranking | `/popularity/` |
| FAQ | `/faq/` |
| Event editor (admin) | `/admin/` |

Old links with `#` (e.g. `/#global`, `/#badge/marvels-wolverine`) redirect to the new URLs automatically.

---

## Repository layout

```
index.html              page shell (layout, sidebar, all sections) — edit by hand
assets/app.css          all styles
assets/app.js           all site logic (routing, calendar, admin, …)

badges.json             global badges            ← written by the bot
events.json             timeline events + dates  ← written by the bot and the admin page
channel-badges.json     channel campaign badges  ← written by the bot
emotes.json             global emotes            ← written by the bot
popularity.json         badge user counts        ← written by the bot (daily)
channels-state.json     bot bookkeeping          ← written by the bot
channels.txt            extra channels the bot should always check (one per line)

badges/ timeline/ channel/ emotes/ popularity/ faq/ privacy/ terms/ 404.html sitemap.xml robots.txt
                        generated pages          ← written by the bot, don't edit

bot/check_badges.py     the bot: Twitch checks, X posts, events, channel badges
bot/build_pages.py      builds the static pages from index.html
bot/requirements.txt
.github/workflows/badges.yml   runs the bot every 15 minutes

favicon*, icon-*, apple-touch-icon.png, site.webmanifest, logo*.png, og-image.png
CNAME                   custom domain (badgedatabase.com)
```

---

## Everyday use

### A new badge has no dates yet
Normal — Twitch doesn't publish dates in its API. The badge shows up under **Date not announced**.
The bot fills the dates in by itself if Twitch runs a matching reward campaign; otherwise:

1. Open **[badgedatabase.com/admin/](https://badgedatabase.com/admin/)**
2. **Needs info** tab → open the event → set **Starts / Ends** (your local time), objective, Free / Sub
3. **Save changes** → live on the site in about a minute

The admin page needs a GitHub fine-grained token (one time, stored in your browser only):
github.com/settings/personal-access-tokens/new → *Only select repositories* → `badgedb` →
*Repository permissions → Contents: Read and write*.

### Run the bot right now
**Actions → Check Twitch badges → Run workflow.** The log (step *Detect new badges and post*)
shows what happened: new badges, `twitch campaigns: …`, `channel badges: …`.

### Watch extra channels for channel badges
Add the channel name to `channels.txt` (one per line).

### Change the X post text or image
`bot/check_badges.py` → `post_to_x()` (text) and `make_card()` (image).

---

## Setup (already done — for reference)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Name | What |
|---|---|
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch app from dev.twitch.tv/console |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X app keys (Read and write) for @BadgeDatabase |
| `TWITCH_GQL_OAUTH` | `auth-token` cookie of the **separate** helper Twitch account, used for reward campaign dates. If it expires, log in again in an incognito window and copy a fresh one — don't log out. |
| `DISCORD_WEBHOOK` | optional — also post new badges to a Discord channel |

**Variables** (same page, *Variables* tab): `SITE_URL` = `https://badgedatabase.com`.
Add `DRY_RUN` = `1` to test without posting to X.

**Hosting**: GitHub Pages (Settings → Pages → branch `main`, root) with custom domain
`badgedatabase.com` (Namecheap: 4 A records to GitHub Pages + `www` CNAME to `davidpzsny.github.io.`),
**Enforce HTTPS** on. Google Search Console is verified by a DNS TXT record — don't delete it.

**Costs**: X API is pay-per-use (a few cents per post, capped at $5/month in the X developer
console). Everything else is free.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site looks unstyled | GitHub Pages is still deploying (Actions → *pages build and deployment*). Wait for the green check, then Ctrl+F5. |
| Changes don't show | Same as above; browsers also cache — try an incognito window. |
| Log says `TWITCH_GQL_OAUTH token was rejected` | Copy a fresh `auth-token` for the helper account into the secret. |
| Log says `posting failed` | Check the X credit balance and that the X app still has *Read and write*. |
| Admin: "bot changed events.json meanwhile" | Click **Reload**, redo the edit, save again. |

---

Not affiliated with Twitch Interactive, Inc. Badge images © their respective owners.
