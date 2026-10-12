#!/usr/bin/env bash
# Installs / updates the BadgeDatabase Discord bot as an always-running service (Ubuntu / Debian).
#   curl -fsSL https://raw.githubusercontent.com/davidpzsny/badgedb/main/discord-bot/install.sh | sudo bash
# Run it again any time to update the bot to the latest version from GitHub.
set -euo pipefail
DIR=/opt/badgedb-bot
RAW=https://raw.githubusercontent.com/davidpzsny/badgedb/main/discord-bot

apt-get update -qq
apt-get install -y -qq python3 python3-venv curl >/dev/null

id badgedb >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin badgedb
mkdir -p "$DIR"
curl -fsSL "$RAW/bot.py" -o "$DIR/bot.py"
curl -fsSL "$RAW/requirements.txt" -o "$DIR/requirements.txt"
[ -d "$DIR/venv" ] || python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q --upgrade pip
"$DIR/venv/bin/pip" install -q -r "$DIR/requirements.txt"

if [ ! -s "$DIR/.env" ]; then
  echo
  read -rsp "Paste the Discord bot token, then press Enter (it will not be shown): " TOKEN </dev/tty
  echo
  printf 'DISCORD_BOT_TOKEN=%s\n' "$TOKEN" > "$DIR/.env"
fi
chmod 600 "$DIR/.env"
chown -R badgedb:badgedb "$DIR"

cat > /etc/systemd/system/badgedb-bot.service <<'EOF'
[Unit]
Description=BadgeDatabase Discord bot
After=network-online.target
Wants=network-online.target

[Service]
User=badgedb
WorkingDirectory=/opt/badgedb-bot
EnvironmentFile=/opt/badgedb-bot/.env
ExecStart=/opt/badgedb-bot/venv/bin/python bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now badgedb-bot
systemctl restart badgedb-bot
sleep 8
systemctl --no-pager --lines=5 status badgedb-bot || true
echo
echo "Done. If the last lines say 'online as BadgeDatabase', the bot is online."
