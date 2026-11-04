# BotForge

Multi-tenant SaaS for building AI chatbots from your own documents (RAG).
A business signs up, creates a bot, uploads PDFs / Word / text files, and pastes one `<script>` tag
on its website. Visitors chat with a widget that answers **only** from those documents.

```
 Dashboard (Next.js :3000) ─┐                       ┌─> identity  (.NET :5120)  sign-up, login, JWT
                            ├─> Gateway (YARP :5000)┼─> bots      (.NET :5215)  bots, documents ──┐
 Widget on customer sites ──┘    /api/*, /widget.js └─> chat      (FastAPI :8000) RAG + Gemini   │
                                                              ▲                        RabbitMQ  │
                                                     pgvector │       ingestion worker <─────────┘
                                                              └──────  (Python) parse → chunk → embed
```

See [docs/architecture.md](docs/architecture.md) for the design, data flow and security model.

| Path | What it is |
|---|---|
| `infra/` | Docker Compose: Postgres 16 + pgvector, RabbitMQ, Redis |
| `services/identity-service` | Tenants, users, JWT issuing |
| `services/bot-service` | Bots, document upload/storage, status events (tenant-isolated with EF query filters) |
| `services/ingestion-service` | RabbitMQ worker: text extraction, chunking, local embeddings (`bge-small-en-v1.5`) into pgvector |
| `services/chat-service` | Public chat API: retrieval + streamed Gemini answers (SSE) |
| `services/gateway` | Single public entry point: routing, CORS, rate limits, serves `widget.js` |
| `apps/dashboard` | Tenant dashboard (Next.js) |
| `apps/widget` | Embeddable widget (TypeScript, ~4 kB gzipped, Shadow DOM) |
| `tests/e2e`, `tests/e2e-ui` | End-to-end tests (API journeys, Playwright browser tests) |
| `scripts/dev.ps1`, `scripts/test.ps1` | Run the whole stack / the whole test suite |
| `deploy/huggingface` | Single-container image for free hosting |

## Prerequisites

Docker Desktop, .NET SDK 9+, Python 3.12, Node.js 20+, a [Gemini API key](https://aistudio.google.com/apikey).

## First-time setup

```powershell
# 1. infrastructure secrets
Copy-Item infra/.env.example infra/.env          # then set POSTGRES_PASSWORD, RABBITMQ_PASSWORD

# 2. .NET secrets (same Jwt:Key in both services; Internal:ApiKey shared with the chat service)
$jwt = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$internal = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$db = "Host=localhost;Port=5432;Database=botforge;Username=botforge;Password=<POSTGRES_PASSWORD>"
cd services/identity-service/Identity.Api
dotnet user-secrets set Jwt:Key $jwt; dotnet user-secrets set ConnectionStrings:Default $db
cd ../../bot-service/Bots.Api
dotnet user-secrets set Jwt:Key $jwt; dotnet user-secrets set ConnectionStrings:Default $db
dotnet user-secrets set RabbitMq:Password "<RABBITMQ_PASSWORD>"; dotnet user-secrets set Internal:ApiKey $internal
cd ../../..

# 3. Python services
foreach ($s in "ingestion-service", "chat-service") {
  py -3.12 -m venv services/$s/.venv
  services/$s/.venv/Scripts/python -m pip install -r services/$s/requirements-dev.txt
  Copy-Item services/$s/.env.example services/$s/.env   # then fill in the values
}
```

`services/chat-service/.env` needs `GEMINI_API_KEY` and the same `INTERNAL_API_KEY` as the bot service.
Database migrations run automatically on start-up.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 start    # infra + build + all services
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 status
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 stop     # add -All to stop docker too
```

Open http://localhost:3000, create an account and a bot, upload a document, wait for **Ready**,
then click **Test your bot**. Logs are in `.logs/`. RabbitMQ UI: http://localhost:15672.

To put the bot on a website, paste the snippet from the bot page:

```html
<script src="http://localhost:5000/widget.js" data-bot-key="bk_..." async></script>
```

Optional attributes: `data-color="#0f766e"` (accent colour), `data-api="https://.../api"` (API base;
defaults to the script's origin + `/api`). See `apps/widget/demo.html`.

## Test

Three levels; `scripts/test.ps1` runs them all and prints a summary table.

| Level | What it covers | Needs |
|---|---|---|
| **1 · unit** | validation rules, slugs, JWT claims, storage path safety, chunking, parsing (txt/md/docx/pdf), message routing, prompt building, SSE parser, widget UI | nothing |
| **2 · integration** | each service against real Postgres + pgvector and RabbitMQ in throw-away `botforge_test_*` databases: auth flows, tenant isolation, uploads, events, status consumer round trip, gateway routing/CORS/rate limits, embeddings + semantic search | docker infra |
| **3 · e2e** | the running stack via the gateway: sign-up → upload → ingestion → grounded answers → follow-ups → deletion; cross-tenant leakage; failure handling; plus Playwright driving the dashboard and the widget on a foreign origin | `dev.ps1 start` |

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test.ps1            # everything
powershell -ExecutionPolicy Bypass -File scripts/test.ps1 unit       # or: integration, e2e
```

Integration tests never touch the `botforge` database; they recreate `botforge_test_identity`,
`botforge_test_bots`, `botforge_test_ingestion` and `botforge_test_chat`.

## API (through the gateway, `http://localhost:5000/api`)

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/auth/register-tenant` | – | `{tenantName, email, password}` → `{token, tenantId, tenantSlug, email, role}` |
| POST | `/auth/login` | – | `{email, password}` |
| GET | `/auth/me` | JWT | current user claims |
| GET/POST | `/bots` | JWT | list / create `{name, welcomeMessage?}` |
| GET/PUT/DELETE | `/bots/{id}` | JWT | read / update / delete (also removes documents and vectors) |
| GET/POST | `/bots/{id}/documents` | JWT | list / upload (`multipart` field `file`; pdf, docx, txt, md; ≤ 10 MB) |
| GET/DELETE | `/bots/{id}/documents/{docId}` | JWT | status (`Uploaded`, `Ready`, `Failed`, `UploadedUnqueued`) / delete |
| POST | `/bots/{id}/documents/{docId}/reprocess` | JWT | queue again |
| GET | `/chat/{publicKey}/info` | public | `{name, welcomeMessage}` |
| POST | `/chat/{publicKey}` | public | `{message, history?: [{role, text}]}` → SSE `meta`, `token`…, `done` \| `error` |

## Deploy (free)

The whole app runs in one container on a free Hugging Face Space with a free Neon database
(no credit card needed). Step-by-step: [docs/deploy.md](docs/deploy.md).

## Production notes

- Serve the gateway over **HTTPS**; browsers block an `http` widget on an `https` site (mixed content).
- Set `Gateway:DashboardOrigins` to the real dashboard URL and tune `Gateway:RateLimits`.
- Never route `/internal/*` publicly (the gateway also blocks it explicitly).
- Rotate any password that was ever committed (see git history of `infra/docker-compose.yml`).
