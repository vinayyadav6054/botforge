# syntax=docker/dockerfile:1
# BotForge as ONE container, for free hosting on Hugging Face Spaces (Docker SDK).
# Everything runs inside: gateway (public port 7860), dashboard, identity, bots, chat, ingestion, RabbitMQ.
# The only outside dependency is Postgres + pgvector (free Neon database) - see docs/deploy.md.
#
#   On Hugging Face: this file is the whole Space; it downloads the code from GitHub (SOURCE=git).
#   Locally, from the repo root:
#     docker build -f deploy/huggingface/Dockerfile --build-arg SOURCE=local -t botforge .
ARG SOURCE=git

FROM alpine/git:2.47.2 AS src-git
ARG REPO=https://github.com/vinayyadav6054/botforge.git
ARG REF=main
RUN git clone --depth 1 --branch "$REF" "$REPO" /src

FROM busybox:1.37 AS src-local
COPY . /src

FROM src-${SOURCE} AS src

# ---------- widget + dashboard ----------
FROM node:20-bookworm-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=src /src/apps /apps
WORKDIR /apps/widget
RUN npm ci --no-audit --no-fund && npm run build
WORKDIR /apps/dashboard
# the dashboard is served by the gateway itself, so the API is on the same site
ENV NEXT_PUBLIC_API_URL=/api NEXT_OUTPUT=standalone
RUN npm ci --no-audit --no-fund && npm run build \
 && cp -r .next/static .next/standalone/.next/static

# ---------- .NET services ----------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet
COPY --from=src /src/services /services
RUN dotnet publish /services/identity-service/Identity.Api -c Release -o /out/identity -p:UseAppHost=false \
 && dotnet publish /services/bot-service/Bots.Api -c Release -o /out/bots -p:UseAppHost=false \
 && dotnet publish /services/gateway/Gateway.Api -c Release -o /out/gateway -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS aspnet

# ---------- runtime ----------
FROM python:3.12-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends rabbitmq-server supervisor ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=aspnet /usr/share/dotnet /usr/share/dotnet
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet

ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/opt/models \
    HOME=/home/user

COPY --from=src /src/services/chat-service/requirements.txt /tmp/req-chat.txt
COPY --from=src /src/services/ingestion-service/requirements.txt /tmp/req-ingestion.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/req-chat.txt -r /tmp/req-ingestion.txt \
 && /opt/venv/bin/python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

COPY --from=dotnet /out /app
COPY --from=web /apps/widget/dist /app/widget
COPY --from=web /apps/dashboard/.next/standalone /app/dashboard
COPY --from=src /src/services/chat-service/app /app/chat/app
COPY --from=src /src/services/ingestion-service/app /app/ingestion/app
COPY --from=src /src/deploy/huggingface /app/deploy

# Hugging Face runs the container as uid 1000
RUN useradd -m -u 1000 user \
 && mkdir -p /data \
 && sed -i 's/\r$//' /app/deploy/start.sh \
 && chmod +x /app/deploy/start.sh \
 && chown -R user:user /data /opt/models /home/user
USER user

EXPOSE 7860
CMD ["/app/deploy/start.sh"]
