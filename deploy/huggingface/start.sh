#!/usr/bin/env bash
# Container entrypoint: turns a few secrets into the settings every service expects, then starts them all.
set -euo pipefail

: "${DATABASE_URL:?Add a DATABASE_URL secret (your Neon connection string)}"
: "${GEMINI_API_KEY:?Add a GEMINI_API_KEY secret}"

py=/opt/venv/bin/python
random_key() { "$py" -c 'import secrets; print(secrets.token_urlsafe(48))'; }

# DATABASE_URL (postgresql://...) -> normalised URL for Python + an Npgsql connection string for .NET
eval "$("$py" /app/deploy/dbenv.py)"

if [ -z "${JWT_KEY:-}" ]; then
  echo "WARNING: no JWT_KEY secret set; using a random one, so everybody is logged out on every restart." >&2
  JWT_KEY="$(random_key)"
fi
INTERNAL_API_KEY="$(random_key)"   # only used inside this container

export \
  ASPNETCORE_ENVIRONMENT=Production \
  Jwt__Key="$JWT_KEY" \
  Internal__ApiKey="$INTERNAL_API_KEY" INTERNAL_API_KEY \
  RabbitMq__Host=127.0.0.1 RabbitMq__User=guest RabbitMq__Password=guest \
  RABBITMQ_HOST=127.0.0.1 RABBITMQ_USER=guest RABBITMQ_PASSWORD=guest \
  Storage__RootPath=/data/storage STORAGE_ROOT=/data/storage \
  BOTS_SERVICE_URL=http://127.0.0.1:5215 \
  GEMINI_MODEL="${GEMINI_MODEL:-gemini-flash-lite-latest}" \
  GEMINI_FALLBACK_MODELS="${GEMINI_FALLBACK_MODELS:-gemini-flash-latest}" \
  Gateway__TrustForwardedHeaders=true \
  Gateway__WidgetPath=/app/widget \
  Gateway__RateLimits__AuthPerMinute="${AUTH_PER_MINUTE:-20}" \
  Gateway__RateLimits__ChatPerMinute="${CHAT_PER_MINUTE:-30}" \
  ReverseProxy__Clusters__identity__Destinations__d1__Address=http://127.0.0.1:5120/ \
  ReverseProxy__Clusters__bots__Destinations__d1__Address=http://127.0.0.1:5215/ \
  ReverseProxy__Clusters__chat__Destinations__d1__Address=http://127.0.0.1:8000/ \
  ReverseProxy__Clusters__dashboard__Destinations__d1__Address=http://127.0.0.1:3000/ \
  ReverseProxy__Routes__dashboard__ClusterId=dashboard \
  ReverseProxy__Routes__dashboard__Order=1000 \
  'ReverseProxy__Routes__dashboard__Match__Path={**catch-all}' \
  PUBLIC_PORT="${PORT:-7860}" \
  RABBITMQ_NODENAME=rabbit@localhost \
  RABBITMQ_NODE_IP_ADDRESS=127.0.0.1 \
  RABBITMQ_MNESIA_BASE=/data/rabbitmq/mnesia \
  RABBITMQ_LOG_BASE=/data/rabbitmq/log \
  RABBITMQ_LOGS=- \
  RABBITMQ_ENABLED_PLUGINS_FILE=/data/rabbitmq/enabled_plugins

mkdir -p /data/storage /data/rabbitmq/mnesia /data/rabbitmq/log
echo "[]." > /data/rabbitmq/enabled_plugins

exec supervisord -c /app/deploy/supervisord.conf
