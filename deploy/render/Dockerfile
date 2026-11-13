# syntax=docker/dockerfile:1
# BotForge backend for Render's FREE plan (512 MB RAM): gateway, identity, bots, chat and ingestion
# in one container. Everything heavy lives in free external services instead:
#   dashboard -> Vercel, Postgres + pgvector -> Neon, RabbitMQ -> CloudAMQP, embeddings -> Gemini API.
# Build context = repo root (Render: "Dockerfile Path" = deploy/render/Dockerfile). Guide: docs/deploy-free.md

FROM node:20-bookworm-slim AS widget
COPY apps/widget /widget
WORKDIR /widget
RUN npm ci --no-audit --no-fund && npm run build

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet
COPY services /services
RUN dotnet publish /services/identity-service/Identity.Api -c Release -o /out/identity -p:UseAppHost=false \
 && dotnet publish /services/bot-service/Bots.Api -c Release -o /out/bots -p:UseAppHost=false \
 && dotnet publish /services/gateway/Gateway.Api -c Release -o /out/gateway -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS aspnet

FROM python:3.12-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends supervisor ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=aspnet /usr/share/dotnet /usr/share/dotnet
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet

# small-memory settings: workstation GC that returns memory eagerly, fewer malloc arenas
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_gcServer=0 \
    DOTNET_GCConserveMemory=7 \
    MALLOC_ARENA_MAX=2 \
    PYTHONUNBUFFERED=1 \
    EMBEDDING_PROVIDER=gemini

# the local embedding model (fastembed/onnxruntime, ~300 MB RAM) is not installed: Gemini embeds instead
COPY services/chat-service/requirements.txt /tmp/req-chat.txt
COPY services/ingestion-service/requirements.txt /tmp/req-ingestion.txt
RUN cat /tmp/req-chat.txt /tmp/req-ingestion.txt | grep -v -i '^fastembed' > /tmp/req.txt \
 && python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/req.txt

COPY --from=dotnet /out /app
COPY --from=widget /widget/dist /app/widget
COPY services/chat-service/app /app/chat/app
COPY services/ingestion-service/app /app/ingestion/app
COPY deploy/render /app/deploy
COPY deploy/huggingface/dbenv.py /app/deploy/dbenv.py
COPY deploy/common/env.sh /app/deploy/common-env.sh

RUN useradd -m -u 1000 user \
 && mkdir -p /data \
 && sed -i 's/\r$//' /app/deploy/start.sh /app/deploy/common-env.sh \
 && chmod +x /app/deploy/start.sh \
 && chown -R user:user /data
USER user
ENV HOME=/home/user

EXPOSE 10000
CMD ["/app/deploy/start.sh"]
