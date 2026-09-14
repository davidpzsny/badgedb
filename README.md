# BadgeDB bot

Watches Twitch's global badge list every 15 minutes. When a new badge shows up it
posts to X (@BadgeDatabase) with the badge image, optionally to Discord, and adds the
badge to `badges.json` — which the website reads, so the site updates by itself.

## Setup (once)

1. Put these files in the SAME GitHub repo as the website (index.html, logo files):
   `badges.json`, `bot/`, `.github/workflows/badges.yml`.
2. Twitch: dev.twitch.tv/console → your app → **New Secret**. Copy Client ID + Client Secret.
3. X: developer.x.com → create a Project + App → "User authentication settings":
   App permissions **Read and write**, type "Web App", any callback URL.
   Then Keys and tokens → generate **API Key/Secret** and **Access Token/Secret**
   (the access token must be generated AFTER setting Read and write).
   Buy a small amount of API credits — posting is pay-per-use.
4. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:
   `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `X_API_KEY`, `X_API_SECRET`,
   `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`, and optionally `DISCORD_WEBHOOK`.
   Under **Variables** add `SITE_URL` (e.g. https://badgedb.hu) and `DRY_RUN` = `1` for a first test.
5. Actions tab → "Check Twitch badges" → **Run workflow**. Check the log.
   If it says "0 new" and no errors, remove the `DRY_RUN` variable (or set it to `0`).

## Notes
- One post per badge set, max 5 posts per run — a bad run can't burn through credits.
- X posts contain no links on purpose (posts with URLs are priced much higher).
- Edit the post text in `bot/check_badges.py` → `post_to_x()`.
