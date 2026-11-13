# Deploy for free: Vercel + Render + Neon + CloudAMQP (no credit card)

```
browser ──> Vercel (dashboard, Next.js) ──https──> Render (free web service, 512 MB)
customer site ──<script src=".../widget.js">──────>   gateway ─┬─ identity ─┐
                                                               ├─ bots ─────┼──> Neon (Postgres + pgvector)
                                                               ├─ chat ─────┤     CloudAMQP (RabbitMQ)
                                                               └─ ingestion ┘     Gemini (answers + embeddings)
```

| Piece | Service | Free plan |
|---|---|---|
| Dashboard | Vercel | Hobby |
| Backend (gateway, identity, bots, chat, ingestion) | Render | Free web service: 512 MB RAM, sleeps after 15 min idle |
| Database | Neon | Free: 0.5 GB |
| Message queue | CloudAMQP | Little Lemur |
| AI answers + embeddings | Google Gemini | Free API key |

The backend uses **Gemini embeddings** (`EMBEDDING_PROVIDER=gemini`, set in `deploy/render/Dockerfile`) instead of
the local model, which would not fit in 512 MB. Tested locally at 512 MB / 0.1 CPU: about 350 MB peak.

## 1. Neon (database)

Sign up at https://neon.tech, create a project and copy the connection string from **Connect**:
`postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require`.

## 2. CloudAMQP (message queue)

1. Sign up at https://customer.cloudamqp.com/signup.
2. **Create New Instance**: any name, plan **Little Lemur (Free)**, any region (pick one close to your Render region).
3. Open the instance and copy the **AMQP URL** (`amqps://user:password@xxx.rmq.cloudamqp.com/user`).

## 3. Render (backend)

1. Sign up at https://render.com with GitHub.
2. **New → Web Service** → connect the `botforge` repository.
3. Settings:

   | Field | Value |
   |---|---|
   | Language | **Docker** |
   | Branch | `main` |
   | Root Directory | leave empty |
   | Dockerfile Path | `./deploy/render/Dockerfile` |
   | Instance Type | **Free** |

4. **Environment Variables**:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon connection string |
   | `RABBITMQ_URL` | CloudAMQP AMQP URL |
   | `GEMINI_API_KEY` | your Gemini key |
   | `JWT_KEY` | a long random value (see below) |
   | `DASHBOARD_URL` | set after step 4, e.g. `https://botforge.vercel.app` |

   Random value (Windows PowerShell):
   ```powershell
   $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
5. **Advanced → Health Check Path**: `/health`. Then **Deploy Web Service** (the first build takes about 10 minutes).
6. Note the URL, e.g. `https://botforge-xxxx.onrender.com`. Opening `/health` must show `{"status":"ok",...}`.

## 4. Vercel (dashboard)

1. Sign up at https://vercel.com with GitHub. **Add New → Project** → import `botforge`.
2. **Root Directory**: `apps/dashboard` (Framework: Next.js is detected).
3. **Environment Variables**: `NEXT_PUBLIC_API_URL` = `https://botforge-xxxx.onrender.com/api` (your Render URL + `/api`).
4. **Deploy**. Note the URL, e.g. `https://botforge-abc.vercel.app`.
5. Optional, for the public website (prices are in `apps/dashboard/lib/site.ts`):
   - `NEXT_PUBLIC_CONTACT_WHATSAPP`: your number with country code, e.g. `919876543210` (shows "Talk on WhatsApp")
   - `NEXT_PUBLIC_CONTACT_EMAIL`
   - `NEXT_PUBLIC_DEMO_BOT_KEY`: makes `/demo` use a real bot. Create a bot, upload
     `apps/dashboard/public/samples/sunrise-academy.txt`, copy its `bk_...` key from the snippet, then redeploy.

## 5. Connect the two

In Render → your service → **Environment**, set `DASHBOARD_URL` to the Vercel URL (no trailing slash; several
addresses may be given comma-separated) and save. Render redeploys. Then open the Vercel URL and register.

## 6. Selling: admin, email and payments (optional, add any time)

Add these in Render → **Environment**. Each one switches on a feature; everything works without them.

| Key | What it does |
|---|---|
| `ADMIN_API_KEY` | A long random value. Opens **/admin** on your dashboard: every business, its plan and usage, and a button to activate a plan after a UPI/bank payment. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Sends real emails: confirm email, password reset, monthly report. Free options: Brevo (300/day) or a Gmail account with an app password (`smtp.gmail.com`, 587). Without them the emails are only written to the Render log. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Online payments (Razorpay → Account & Settings → API keys). |
| `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_BUSINESS`, `RAZORPAY_PLAN_PRO` | The `plan_...` ids. Create three monthly plans in Razorpay → Subscriptions → Plans (₹499, ₹1,499, ₹3,999). |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks → add `https://<render-url>/api/billing/razorpay/webhook` with the events `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, and the same secret here. |
| `PUBLIC_URL` | Only if email links should use another address than the first `DASHBOARD_URL`. |

Plans and limits (`services/bot-service/Bots.Api/Billing/Plans.cs`; prices also in `apps/dashboard/lib/site.ts`):

| Plan | Price | Bots | Documents | Answers / month | Badge |
|---|---|---|---|---|---|
| Free trial (14 days) | – | 3 | 20 | 300 | shown |
| Starter | ₹499 | 1 | 10 | 500 | shown |
| Business | ₹1,499 | 3 | 50 | 3,000 | removed |
| Pro | ₹3,999 | 10 | 200 | 15,000 | removed |

After the trial or a plan ends, the bots stop answering (visitors are asked to contact the business) and no new bots or
documents can be added; all data stays available.

## Updating

Push to `main`: Vercel and Render both redeploy automatically.

## Limits of the free plans

- **Render sleeps after 15 minutes without requests**; the next request takes about 1 minute to wake it.
  A free uptime monitor (e.g. UptimeRobot, every 10 min, on `https://<render-url>/health`) keeps it awake;
  the free 750 instance hours per month cover one service running all the time.
- **Uploaded files are temporary** on Render (no free disk): answers keep working because the processed
  knowledge is in Neon, but **Retry** on an old document fails (upload it again).
- **Gemini free quota** is shared by answers and embeddings; very large documents may take a while.
- Don't switch `EMBEDDING_PROVIDER` on a database that already has documents: vectors from different models
  can't be compared. Re-upload the documents after a switch.
