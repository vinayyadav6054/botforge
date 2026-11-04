#!/usr/bin/env bash
# One-time setup (and later updates) on a fresh Ubuntu server, e.g. Oracle Cloud Always Free.
#   curl -fsSL https://raw.githubusercontent.com/vinayyadav6054/botforge/main/deploy/oracle/setup.sh | bash
# Re-running it pulls the latest code and rebuilds; existing secrets and data are kept.
# GEMINI_API_KEY and SITE_ADDRESS may be passed as environment variables; otherwise you are asked.
set -euo pipefail

REPO=https://github.com/vinayyadav6054/botforge.git
DIR="$HOME/botforge"

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "==> Firewall: allow HTTP and HTTPS"
# Oracle's Ubuntu images block everything except SSH in iptables (on top of the cloud security list)
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

echo "==> Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR/deploy/oracle"

if [ ! -f .env ]; then
  echo "==> Secrets"
  key=${GEMINI_API_KEY:-}
  if [ -z "$key" ]; then read -r -p "Gemini API key: " key </dev/tty; fi
  site=${SITE_ADDRESS:-}
  if [ -z "$site" ]; then
    ip=$(curl -fsS https://api.ipify.org)
    site="${ip//./-}.sslip.io"     # free host name that points at this IP, so HTTPS works without a domain
  fi
  umask 077
  cat > .env <<EOF
SITE_ADDRESS=$site
GEMINI_API_KEY=$key
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_KEY=$(openssl rand -base64 48 | tr -d '\n')
EOF
fi

echo "==> Build and start (the first build takes 10-20 minutes)"
$DOCKER compose up -d --build
$DOCKER image prune -f >/dev/null

site=$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)
echo
echo "Done. In a minute or two BotForge is live at: https://$site"
echo "Logs:   cd $DIR/deploy/oracle && $DOCKER compose logs -f app"
