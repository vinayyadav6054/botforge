# Deploy for free (Hugging Face Spaces + Neon)

The whole backend and the dashboard run in **one container** on a free Hugging Face Space
(2 vCPU, 16 GB RAM, HTTPS included). The database is a free **Neon** Postgres with pgvector.
Neither needs a credit card. You end up with one public URL such as
`https://<your-hf-username>-botforge.hf.space` that serves the dashboard, the API and `widget.js`.

```
browser / customer site ──https──> Hugging Face Space (port 7860)
                                     gateway ─┬─ /api/auth  -> identity
                                              ├─ /api/bots  -> bots ──┐ RabbitMQ (inside) ─> ingestion
                                              ├─ /api/chat  -> chat ──┼──────────────> Gemini
                                              ├─ /widget.js            │
                                              └─ everything else -> dashboard
                                                                       └────────> Neon Postgres (pgvector)
```

The image is defined in [`deploy/huggingface/Dockerfile`](../deploy/huggingface/Dockerfile). On Hugging Face it
downloads the code from this GitHub repository, so the Space contains only that one file plus its README.

## 1. Database: Neon (5 minutes)

1. Sign up at https://neon.tech (you can log in with GitHub).
2. Create a project: any name, Postgres 16 or newer, the region closest to you.
3. Open **Connect** on the project dashboard and copy the connection string. It looks like
   `postgresql://neondb_owner:npg_xxx@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   Pooled or direct both work; the container switches to the direct host by itself.

You don't need to create any tables. The services create schemas, tables and the `vector` extension on start-up.

## 2. A login-signing key

Generate a random value and keep it. Without it, everybody is logged out whenever the Space restarts:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

## 3. The Space: Hugging Face (10 minutes + build)

1. Sign up at https://huggingface.co.
2. **New → Space**: name `botforge`, SDK **Docker**, template **Blank**, hardware **CPU basic (free)**,
   visibility **Public**. The widget is loaded by other websites, so the Space must be public.
3. Go to **Files → README.md → Edit**. Add `app_port: 7860` to the header at the top, so it reads like this:
   ```yaml
   ---
   title: BotForge
   emoji: 🤖
   colorFrom: green
   colorTo: blue
   sdk: docker
   app_port: 7860
   pinned: false
   ---
   ```
4. **Files → Add file → Create a new file**: name it `Dockerfile` and paste the contents of
   [`deploy/huggingface/Dockerfile`](../deploy/huggingface/Dockerfile). Commit it.
5. **Settings → Variables and secrets → New secret**. Add each of these:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `GEMINI_API_KEY` | your key from https://aistudio.google.com/apikey |
   | `JWT_KEY` | the value from step 2 |

   Optional variables: `GEMINI_MODEL` (default `gemini-flash-lite-latest`) and `GEMINI_FALLBACK_MODELS`
   (default `gemini-flash-latest`, comma-separated).
6. The Space builds automatically. The first build takes about 10–15 minutes; watch progress in the **Logs** tab.
   When it shows **Running**, open the app at its direct URL **`https://<username>-botforge.hf.space`**. Don't use
   the huggingface.co/spaces page, which wraps the app in a frame.

Then register, create a bot, upload a document, wait for **Ready** and click **Test your bot**.
The embed snippet on the bot page already points at your Space, so any website can paste it.

## Updating

Push to `main` on GitHub. Then go to the Space's **Settings** and click **Factory rebuild**. A plain restart reuses
the cached copy of the code.

## Limits of the free tier

- **Sleeps after 48 h without visitors.** The first visit after that wakes it up, which takes about 1–2 minutes.
- **Uploaded files are temporary.** The container disk resets when the Space restarts. Bots, accounts and
  the processed knowledge are kept in Neon, so answers keep working, but **Retry** on an old document fails
  (just upload it again).
- **Gemini free quota.** Busy periods show "The assistant is busy" to visitors. A paid key removes this.
- **Neon free plan:** 0.5 GB of storage, which is plenty for thousands of document pages.

## Test the image on your own PC

From the repo root, with the local infrastructure running (`infra/docker-compose.yml`):

```powershell
docker build -f deploy/huggingface/Dockerfile --build-arg SOURCE=local -t botforge-hf .
docker run --rm -p 7860:7860 `
  -e DATABASE_URL="postgresql://botforge:<POSTGRES_PASSWORD>@host.docker.internal:5432/botforge_deploy" `
  -e GEMINI_API_KEY="<key>" -e JWT_KEY="<random>" botforge-hf
# open http://localhost:7860
```
