#!/usr/bin/env bash
# Render entrypoint: turns the environment variables from the Render dashboard into every service's settings.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (Neon connection string)}"
: "${GEMINI_API_KEY:?Set GEMINI_API_KEY}"
: "${RABBITMQ_URL:?Set RABBITMQ_URL (CloudAMQP AMQP URL, amqps://...)}"
: "${JWT_KEY:?Set JWT_KEY (a long random value)}"

py=/opt/venv/bin/python

# DATABASE_URL (postgresql://...) -> normalised URL for Python + an Npgsql connection string for .NET
eval "$("$py" /app/deploy/dbenv.py)"

export \
  ASPNETCORE_ENVIRONMENT=Production \
  Jwt__Key="$JWT_KEY" \
  Internal__ApiKey="$("$py" -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  RabbitMq__Url="$RABBITMQ_URL" \
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
  PUBLIC_PORT="${PORT:-10000}"
export INTERNAL_API_KEY="$Internal__ApiKey"

# DASHBOARD_URL: the Vercel address(es) allowed to call the dashboard API, comma-separated
i=0
IFS=',' read -ra origins <<< "${DASHBOARD_URL:-}"
for origin in "${origins[@]}"; do
  origin="$(echo "$origin" | xargs)"; origin="${origin%/}"
  [ -n "$origin" ] || continue
  export "Gateway__DashboardOrigins__$i=$origin"
  i=$((i + 1))
done
[ "$i" -gt 0 ] || echo "WARNING: DASHBOARD_URL is not set, so the dashboard cannot log in yet." >&2

mkdir -p /data/storage
exec supervisord -c /app/deploy/supervisord.conf
