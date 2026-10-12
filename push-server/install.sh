#!/usr/bin/env bash
# Installs / updates the BadgeDatabase "Remind me" push server (Ubuntu / Debian, e.g. the Oracle Cloud VM of the Discord bot).
#   curl -fsSL https://raw.githubusercontent.com/davidpzsny/badgedb/main/push-server/install.sh | sudo bash
# Run it again any time to update the server to the latest version from GitHub (reminders and the key are kept).
# Needs: a DNS A record  api.badgedatabase.com -> this server's public IP, and ports 80 + 443 open in the cloud firewall.
# Another domain: curl ... | sudo PUSH_DOMAIN=push.example.com bash
set -euo pipefail
DOMAIN="${PUSH_DOMAIN:-api.badgedatabase.com}"
DIR=/opt/badgedb-push
RAW=https://raw.githubusercontent.com/davidpzsny/badgedb/main/push-server

echo "== Packages"
apt-get update -qq
apt-get install -y -qq python3 python3-venv curl gnupg >/dev/null
if ! command -v caddy >/dev/null; then
  echo "== Caddy (HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

echo "== Server files"
id badgedb >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin badgedb
mkdir -p "$DIR"
curl -fsSL "$RAW/server.py" -o "$DIR/server.py"
curl -fsSL "$RAW/requirements.txt" -o "$DIR/requirements.txt"
[ -d "$DIR/venv" ] || python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q --upgrade pip
"$DIR/venv/bin/pip" install -q -r "$DIR/requirements.txt"
if [ ! -s "$DIR/.env" ]; then
  cat > "$DIR/.env" <<EOF
SITE_URL=https://badgedatabase.com
ALLOW_ORIGINS=https://badgedatabase.com,https://www.badgedatabase.com
VAPID_CONTACT=mailto:support@badgedatabase.com
PUSH_PORT=8787
EOF
fi
chmod 600 "$DIR/.env"
chown -R badgedb:badgedb "$DIR"

cat > /etc/systemd/system/badgedb-push.service <<'EOF'
[Unit]
Description=BadgeDatabase Remind me push server
After=network-online.target
Wants=network-online.target

[Service]
User=badgedb
WorkingDirectory=/opt/badgedb-push
EnvironmentFile=/opt/badgedb-push/.env
ExecStart=/opt/badgedb-push/venv/bin/python server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q --now badgedb-push
systemctl restart badgedb-push

echo "== HTTPS for $DOMAIN"
CF=/etc/caddy/Caddyfile
BLOCK="$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}"
if [ ! -s "$CF" ] || grep -q "root \* /usr/share/caddy" "$CF"; then
  printf '%s\n' "$BLOCK" > "$CF"                       # replace Caddy's default welcome page
elif ! grep -q "^$DOMAIN" "$CF"; then
  printf '\n%s\n' "$BLOCK" >> "$CF"                    # keep whatever else is already configured
fi
systemctl enable -q --now caddy
systemctl reload caddy || systemctl restart caddy

echo "== Firewall on this machine (ports 80, 443)"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
REJ=$(iptables -L INPUT --line-numbers -n 2>/dev/null | awk '$2=="REJECT"{print $1; exit}')
if [ -n "$REJ" ]; then                                 # Oracle's Ubuntu images block everything except SSH
  for p in 443 80; do
    iptables -C INPUT -p tcp -m state --state NEW --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT "$REJ" -p tcp -m state --state NEW --dport $p -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

sleep 4
echo
if curl -fsS http://127.0.0.1:8787/push/health >/dev/null; then echo "Server: running."; else echo "Server: NOT running. Check: journalctl -u badgedb-push -n 30"; fi
if curl -fsS --max-time 20 "https://$DOMAIN/push/health" >/dev/null 2>&1; then
  echo "HTTPS:  https://$DOMAIN works. Done, the Remind me buttons appear on the site."
else
  echo "HTTPS:  https://$DOMAIN does not answer yet."
  echo "        Check the DNS A record ($DOMAIN -> this server's public IP) and that ports 80 and 443 are open"
  echo "        in the Oracle Cloud security list. Caddy keeps retrying the certificate by itself; test again later with:"
  echo "        curl https://$DOMAIN/push/health"
fi
