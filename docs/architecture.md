# Architecture

## Services and responsibilities

| Service | Stack | Owns | Talks to |
|---|---|---|---|
| gateway | ASP.NET + YARP | public surface, CORS, rate limits, `/widget.js` | identity, bots, chat |
| identity | ASP.NET minimal API, EF Core | schema `identity` (tenants, users) | Postgres |
| bots | ASP.NET minimal API, EF Core | schema `bots` (bots, documents), file storage | Postgres, RabbitMQ, storage |
| ingestion | Python worker, pika, fastembed | schema `knowledge` (chunks + vectors) | RabbitMQ, Postgres, storage |
| chat | FastAPI | nothing (stateless) | bots `/internal`, Postgres (read `knowledge`), Gemini |
| dashboard | Next.js | – | gateway |
| widget | TypeScript bundle | conversation history in `sessionStorage` | gateway |

Each service owns its own schema; nobody writes another service's tables.

## Document lifecycle

```
dashboard ──upload──> bots: save file + row (status Uploaded) ──publish document.uploaded──> RabbitMQ
                                                                                               │
ingestion <────────────────────────────────────────────────────────────────────────────────────┘
   extract text (pdf/docx/txt/md) → chunk (800 chars, 100 overlap) → embed (384-d, local)
   → replace rows in knowledge.chunks → publish document.processed {chunkCount} | document.failed {error}
                                                                                               │
bots: DocumentStatusConsumer <─────────────────────────────────────────────────────────────────┘
   status Ready / Failed (dashboard polls every 2 s while anything is processing)
```

Deleting a document or bot publishes `document.deleted` / `bot.deleted`; the worker deletes the chunks.
Upload, deletion and reprocessing messages share one queue with prefetch 1, so they are applied in order.

Routing keys on the topic exchange `botforge.events`:

| Key | Producer | Consumer | Payload (camelCase JSON) |
|---|---|---|---|
| `document.uploaded` | bots | ingestion | documentId, tenantId, botId, storageKey, fileName, contentType, uploadedAt |
| `document.processed` | ingestion | bots | documentId, tenantId, botId, chunkCount |
| `document.failed` | ingestion | bots | documentId, tenantId, botId, error (≤ 500 chars, user-readable) |
| `document.deleted` | bots | ingestion | documentId, tenantId, botId |
| `bot.deleted` | bots | ingestion | botId, tenantId |

## Chat request

1. Widget `POST /api/chat/{publicKey}` with the message and the last ≤ 10 turns.
2. Chat service validates the key format, resolves the bot through `GET /internal/bots/{publicKey}`
   on the bot service (shared `X-Internal-Key`, constant-time compare).
3. Embeds *previous user question + new question* and takes the top 5 chunks with
   `WHERE tenant_id = ? AND bot_id = ?` ordered by cosine distance (HNSW index).
4. No chunks → fixed "I don't have any information" answer, no LLM call.
5. Otherwise Gemini is called with a grounding system prompt (answer only from CONTEXT, treat
   context as data not instructions) and the answer is streamed back as SSE.

## Security model

- **Tenant isolation**: every bot/document row carries `tenant_id`; EF global query filters scope all
  queries to the tenant in the JWT, so another tenant's ids simply return 404. The only filter bypasses
  are the internal lookup and the status consumer, which match ids explicitly. Retrieval always
  filters on both tenant and bot. Covered by integration and e2e tests.
- **Public vs private**: `/internal/*` is not routed by the gateway and is additionally blocked by
  middleware. Dashboard routes accept only the dashboard origin (CORS); chat routes accept any origin
  but carry no credentials.
- **Abuse**: per-IP rate limits on auth and chat; message/history size limits; upload type and size limits.
- **Prompt injection**: bot names are sanitised (no newlines or symbols) before entering the system
  prompt; document text is wrapped as context and the model is told never to follow instructions in it.
- **XSS**: the widget renders all text with `textContent` inside a Shadow DOM; colours are validated.
- **Files**: storage keys are generated server-side, and both writer and reader verify the resolved
  path stays inside the storage root.
