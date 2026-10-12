"""BadgeDatabase Discord bot: always online, slash commands from badgedatabase.com data.

The scheduled events, webhooks and pings are handled by the GitHub Actions bot; this process only keeps the
bot online and answers commands. Data is read from the live site (refreshed every 10 minutes).

  /active          badge events running right now
  /soon            upcoming badge events
  /badge <name>    one badge: image, date added, how to get it, link

Env: DISCORD_BOT_TOKEN (required), SITE_URL (default https://badgedatabase.com)
"""
import asyncio, datetime, os, time
import aiohttp
import discord
from discord import app_commands

SITE = (os.environ.get("SITE_URL") or "https://badgedatabase.com").rstrip("/")
TOKEN = os.environ["DISCORD_BOT_TOKEN"].strip()
PURPLE = 0x8B5CF6
CACHE_SECONDS = 600


def img_url(img): return f"https://static-cdn.jtvnw.net/badges/v1/{img}/3"
def _dt(t): return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
def ts(t, style="R"): return f"<t:{int(_dt(t).timestamp())}:{style}>"


class Data:
    def __init__(self):
        self.events, self.badges, self.at = [], [], 0.0

    async def refresh(self, force=False):
        if not force and time.time() - self.at < CACHE_SECONDS and self.events:
            return
        async with aiohttp.ClientSession(headers={"User-Agent": "BadgeDatabaseBot"}) as s:
            async def get(p):
                async with s.get(f"{SITE}/{p}?t={int(time.time())}", timeout=aiohttp.ClientTimeout(total=20)) as r:
                    r.raise_for_status(); return await r.json(content_type=None)
            ev, b = await asyncio.gather(get("events.json"), get("badges.json"))
        self.events = ev if isinstance(ev, list) else ev.get("events", [])
        self.badges = b
        self.at = time.time()

    def set_of(self, img):
        for r in self.badges:
            if r[1] == img and len(r) > 5 and r[5]: return r[5]
        return None


data = Data()
intents = discord.Intents.none()
intents.guilds = True
client = discord.Client(intents=intents, activity=discord.Activity(type=discord.ActivityType.watching, name="badgedatabase.com"))
tree = app_commands.CommandTree(client)


def event_line(e, now):
    names = ", ".join(b.get("name") or "?" for b in e.get("badges", [])[:3])
    if _dt(e["start"]) > now:
        when = f"starts {ts(e['start'])}"
    else:
        when = f"ends {ts(e['end'])}"
    return f"**{e['name']}** · {when}\n{names}"


def event_page(e, data):
    for b in e.get("badges", []):
        s = data.set_of(b.get("img"))
        if s: return f"{SITE}/badges/{s}/"
    return f"{SITE}/timeline/"


async def events_embed(title, pick, empty):
    await data.refresh()
    now = datetime.datetime.now(datetime.timezone.utc)
    evs = [e for e in data.events if e.get("start") and e.get("end") and pick(e, now)]
    evs.sort(key=lambda e: e["end"] if _dt(e["start"]) <= now else e["start"])
    em = discord.Embed(title=title, color=PURPLE, url=f"{SITE}/timeline/")
    if not evs:
        em.description = empty
    for e in evs[:10]:
        em.add_field(name="​", value=event_line(e, now) + f"\n[Details]({event_page(e, data)})", inline=False)
    if len(evs) > 10:
        em.set_footer(text=f"+{len(evs) - 10} more on badgedatabase.com/timeline")
    return em


@tree.command(name="active", description="Twitch badge events running right now")
async def active(inter: discord.Interaction):
    await inter.response.defer()
    em = await events_embed("🟢 Active badge events",
                            lambda e, n: _dt(e["start"]) <= n < _dt(e["end"]), "No badge event is running right now.")
    await inter.followup.send(embed=em)


@tree.command(name="soon", description="Upcoming Twitch badge events")
async def soon(inter: discord.Interaction):
    await inter.response.defer()
    em = await events_embed("⏳ Upcoming badge events",
                            lambda e, n: _dt(e["start"]) > n, "No upcoming badge event is known yet.")
    await inter.followup.send(embed=em)


@tree.command(name="badge", description="Look up a Twitch global badge")
@app_commands.describe(name="Badge name")
async def badge(inter: discord.Interaction, name: str):
    await inter.response.defer()
    await data.refresh()
    q = name.strip().lower()
    rows = [r for r in data.badges if r[0].lower() == q] or [r for r in data.badges if q in r[0].lower()]
    if not rows:
        await inter.followup.send(f"No badge found for **{name}**. Browse all: {SITE}/badges/", ephemeral=True); return
    r = rows[0]
    title, img, added = r[0], r[1], r[2]
    set_id = r[5] if len(r) > 5 else ""
    desc = (r[6] if len(r) > 6 else "") or "Details not announced yet."
    how = next((b.get("how") for e in data.events for b in e.get("badges", []) if b.get("img") == img and b.get("how")), "")
    em = discord.Embed(title=title, url=f"{SITE}/badges/{set_id}/" if set_id else f"{SITE}/badges/", description=desc[:1000], color=PURPLE)
    em.set_thumbnail(url=img_url(img))
    if how: em.add_field(name="How to get it", value=how[:1000], inline=False)
    if added: em.add_field(name="Added", value=added, inline=True)
    em.set_footer(text="badgedatabase.com")
    await inter.followup.send(embed=em)


@badge.autocomplete("name")
async def badge_auto(inter: discord.Interaction, current: str):
    try: await data.refresh()
    except Exception: return []
    q = current.lower()
    seen, out = set(), []
    for r in data.badges:
        if q in r[0].lower() and r[0] not in seen:
            seen.add(r[0]); out.append(app_commands.Choice(name=r[0][:100], value=r[0][:100]))
        if len(out) >= 25: break
    return out


@tree.error
async def on_command_error(inter: discord.Interaction, error):
    print("command error:", repr(error), flush=True)
    msg = f"Something went wrong, try again in a minute. Everything is also on {SITE}"
    try:
        if inter.response.is_done(): await inter.followup.send(msg, ephemeral=True)
        else: await inter.response.send_message(msg, ephemeral=True)
    except Exception: pass


@client.event
async def on_ready():
    await tree.sync()
    print(f"online as {client.user} in {len(client.guilds)} server(s)", flush=True)


client.run(TOKEN)
