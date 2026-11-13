# BotForge roadmap (future scope)

What BotForge does today, and what can be added, ordered by how much each item helps sell the product.

## Today

- Sign-up, login, multi-tenant isolation (each business sees only its own data)
- Bots built from PDF, Word, text and Markdown files (RAG with pgvector + Gemini)
- Embeddable website widget (one `<script>` tag), streamed answers
- Lead capture: name, phone, course, email, page and transcript; statuses New / Contacted / Converted / Junk; CSV export
- Plans (14-day trial, Starter, Business, Pro) with enforced limits, Razorpay subscriptions, admin page for manual payments
- Password reset, email verification, monthly report email; conversation history with unanswered questions
- "Powered by BotForge" badge (removed on Business and Pro), Privacy Policy, Terms, data export, account deletion
- Landing page with live demo, demo website
- Gateway with rate limits and CORS; free hosting guides (Render + Vercel, own server, Hugging Face)

## Phase 1: needed before charging customers (done)

| Feature | Why |
|---|---|
| **Plans and usage limits** (messages/month, bots, documents, storage per plan) | One customer must not use up the whole AI budget; the basis of pricing |
| **Billing** (Razorpay subscriptions; Lemon Squeezy / Paddle for abroad) | Customers pay monthly without manual payment links |
| **Password reset and email verification** | Basic account safety; fewer support requests |
| **Conversation history** for the owner (all chats, not only leads) | "What are my customers asking?" is a key selling point |
| **Monthly report email** (questions answered, leads, top topics) | Shows value every month, so customers keep paying |
| **"Powered by BotForge" link**, removable on paid plans | Free marketing; a reason to upgrade |
| **Privacy Policy, Terms, data deletion and export** | Required for storing customer data (India DPDP Act 2023) |
| **Landing page** with pricing, demo bot and WhatsApp contact | Trust and self-service sign-ups |

## Phase 2: better answers and easier setup

- **Website crawler**: enter the website URL and the bot learns every page, with no file uploads
- **More sources**: Google Docs/Drive, Notion, Excel/CSV price lists, YouTube transcripts
- **Auto re-sync** of website and connected sources on a schedule
- **Manual Q&A and corrections**: the owner fixes a wrong answer once and the bot uses it from then on
- **"Unanswered questions" list**, showing what the documents don't cover so the owner can add it
- **Source links** in answers ("from Fee_Structure.pdf, page 2")
- **Test playground** in the dashboard before going live
- **Widget customisation**: colours, logo, position, avatar, suggested questions, opening hours message
- **Bot personality and rules**: tone, answer length, topics to avoid, custom instructions
- **Lead form settings**: choose fields, ask at the start or after N messages
- **Better retrieval**: hybrid keyword + vector search, re-ranking, better chunking of tables

## Phase 3: more channels (most important for India)

- **WhatsApp Business API** bot from the same documents (via Meta Cloud API or Gupshup / Interakt)
- **Instagram and Facebook Messenger** auto-replies
- **Telegram** bot
- **Multilingual**: Hindi, Hinglish, Marathi, Tamil, and others; detect the visitor's language
- **Voice**: speech-to-text questions and spoken answers; later a phone call bot (IVR)

## Phase 4: from chatbot to sales assistant

- **Human handover**: live chat inbox where staff take over a conversation
- **Instant lead alerts** on WhatsApp, email or Telegram to the owner
- **CRM integration**: Google Sheets, Zoho, HubSpot, LeadSquared; webhooks and Zapier / Make
- **Appointment booking**: Google Calendar, Calendly; reminders
- **Payments in chat**: Razorpay or UPI link for fees, deposits, orders
- **Follow-ups**: automatic WhatsApp or email message to leads that did not convert
- **Order and booking status** lookups for shops (Shopify, WooCommerce)

## Phase 5: analytics and growth

- Dashboard charts: conversations, leads, conversion rate, busiest hours, top questions
- Answer quality: thumbs up/down from visitors; owner review queue
- A/B testing of welcome messages and lead form timing
- Cost tracking per tenant (AI tokens, storage) to keep plans profitable

## Phase 6: scale and bigger customers

- **Agency / reseller (white-label) plan**: agencies manage many client bots under their own brand and domain
- **Team accounts**: several users per business with roles (owner, editor, viewer)
- **Public API and SDKs** so developers can use BotForge bots in their own apps
- **Custom domains** for the widget and a hosted chat page (`chat.business.com`)
- **Industry templates**: coaching, clinic, real estate, salon, restaurant, with ready questions and lead fields
- **Enterprise**: SSO, audit logs, data stored in India, uptime SLA, on-premise option
- **Choice of AI model** per plan (Gemini, Claude, OpenAI, open-source) and bring-your-own API key

## Phase 7: platform and operations

- Paid hosting that does not sleep; automated backups; monitoring and alerts (uptime, errors, queue length)
- Background job dashboard; retry and dead-letter handling for failed documents
- Caching of frequent questions to cut AI cost and speed up answers
- Abuse protection: CAPTCHA on sign-up, spam detection on lead forms, per-bot limits
- Security: penetration test, secrets manager, regular dependency updates

## Suggested order

1. Phase 1 (plans, billing, password reset, conversation history, monthly report)
2. Website crawler and unanswered-questions list (Phase 2)
3. WhatsApp bot and Hindi/Hinglish (Phase 3)
4. Lead alerts, CRM and booking (Phase 4)
5. Analytics, agency plan and the rest as customers ask for them
