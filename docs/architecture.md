# Architecture

## Services and responsibilities

| Service | Stack | Owns | Talks to |
|---|---|---|---|
| gateway | ASP.NET + YARP | public surface, CORS, rate limits, `/widget.js` | identity, bots, chat |
| identity | ASP.NET minimal API, EF Core | schema `identity` (tenants, users, email tokens, report log) | Postgres, SMTP, bots `/internal` (account deletion, report numbers) |
| bots | ASP.NET minimal API, EF Core | schema `bots` (bots, documents, leads, conversations, subscriptions, usage), file storage | Postgres, RabbitMQ, storage, Razorpay |
| ingestion | Python worker, pika, fastembed | schema `knowledge` (chunks + vectors) | RabbitMQ, Postgres, storage |
| chat | FastAPI | nothing (stateless) | bots `/internal` (bot lookup, answer quota, conversation log), Postgres (read `knowledge`), Gemini |
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

## Lead capture

```
widget ──POST /api/chat/{key}/lead──> gateway (public route) ──> chat: honeypot check, size limits
                                                                    │ X-Internal-Key
                                                                    ▼
                                    bots: POST /internal/bots/{key}/leads
                                          validate + normalise phone, drop query string from page URL,
                                          keep last ≤10 transcript turns, skip same phone+bot within 24 h
                                          → bots.leads (tenant_id, bot_id; cascade on bot delete)
dashboard ──GET/PATCH/DELETE /api/bots/{id}/leads[...]──> bots (JWT, tenant query filter)
```

Settings live on the bot (`lead_capture_enabled`, `lead_prompt`, `lead_after_messages`) and reach the
widget through `/chat/{key}/info`. `lead_after_messages = 0` means the form only opens from the widget's
"Talk to us" button. The widget remembers "done"/"dismissed" per bot in `sessionStorage`.
Leads are personal data: the form shows a consent line, the owner can delete single leads, and
CSV cells that start with `= + - @` are prefixed with `'` so spreadsheets do not run them as formulas.

## Plans, usage and billing

- `bots.subscriptions` has one row per tenant, created on first use with a 14-day trial. `Plans.Effective` turns it
  into the limits that apply now (trial; paid plan until `current_period_end`, +3 days grace while active; or expired).
- Bot and document creation return **402** with `code: plan_limit` when the plan is full or has ended.
- Before every AI answer the chat service calls `POST /internal/bots/{key}/answers`, which counts it in
  `bots.usage_counters` with one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE answers < limit`. Over the limit
  the visitor gets a polite fixed message and Gemini is not called. Questions without matching documents are not
  counted. If the bot service cannot be reached the answer is given anyway (fail open).
- Razorpay: `POST /account/checkout` creates a subscription (notes carry the tenant id and plan) and returns its hosted
  payment page. The webhook (HMAC-SHA256 of the raw body) sets the plan; a newly activated subscription replaces and
  cancels the previous one, and late events about older subscriptions are ignored.
- Without Razorpay, the platform owner activates plans on `/admin` (`X-Admin-Key`, `PUT /admin/subscriptions/{tenant}`).

## Conversations

The widget keeps a conversation id per bot in `sessionStorage` and sends it (and the page address without query
string) with every message. After answering, the chat service stores the question and answer through
`POST /internal/bots/{key}/conversations` (best effort; failures never reach the visitor). Questions with no matching
document chunks are stored with `answered = false`, so the owner sees what the documents are missing.
Conversations are deleted after `Retention:ConversationDays` (180) by a background job and cascade with their bot.

## Accounts and email

Identity stores one-time tokens (`user_tokens`, SHA-256 hash only) for email verification (24 h) and password reset
(1 h; using one invalidates the other open reset links). At most one email of each kind per user per minute;
`forgot-password` always answers 200, so it does not reveal which emails have an account. Emails go through SMTP when
`Email:Smtp:Host` is set, otherwise to the log. A background job sends the previous month's report to verified owners,
once per tenant and month (`report_logs`). `POST /auth/delete-account` checks the password, asks the bot service to
delete everything of the tenant (including cancelling a Razorpay subscription), then deletes the tenant and its users.

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
