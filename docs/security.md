# Security design

What Kahiye protects, how, and what still depends on the hosting. Nothing on the internet is "unhackable"; the goal
is that common attacks fail, that a single bug or leak exposes as little as possible, and that abuse is noticed.

## Layers

```
Visitor / owner ──HTTPS──▶ Gateway (YARP) ──▶ identity · bots · chat ──▶ Postgres (Neon) · RabbitMQ · Gemini
                           │ rate limits, size limits, CORS, security headers, /internal blocked
Dashboard (Vercel) ── CSP, frame-ancestors none, HSTS
```

| Layer | Control |
|---|---|
| Transport | HTTPS everywhere (Render, Vercel, Neon, CloudAMQP, Brevo, Gemini). HSTS on the dashboard and on the gateway over HTTPS. |
| Gateway | Per-IP limits: **all routes** (token bucket, default 600/min with bursts), login and sign-up 20/min, chat 30/min, widget reply checks 60/min. `429` with `Retry-After`. Body ≤ 12 MB, headers ≤ 32 KB, 15 s to send headers (slow-loris), connection cap. No `Server` banner. `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. Any path containing `/internal` is refused, whatever the route table says. |
| CORS | Dashboard routes accept only the dashboard origin(s) in `DASHBOARD_URL`. Public chat routes accept any origin but carry no cookies or credentials. |
| Service to service | `/internal/*` endpoints need `X-Internal-Key` (random per deployment, generated at start, compared in constant time) and are only reachable inside the container. |
| Accounts | Passwords hashed with ASP.NET Core Identity's PBKDF2 (salted, many iterations), 8–128 characters. 5 wrong passwords lock the account for 15 minutes (a password reset clears it). Unknown emails take as long as wrong passwords (no account discovery by timing) and get the same answer. Email verification and reset links are single-use, expire (24 h / 1 h), and only their SHA-256 hash is stored. JWTs are signed (HS256, key ≥ 32 chars) and expire. "Continue with Google" accepts only ID tokens signed by Google's published keys, for our client id, unexpired, with a verified email. |
| Tenancy | Every bot-service query is filtered by the tenant in the signed token (EF global query filters); another business's bot simply does not exist. Public widget calls only know a random public key (`bk_` + 128 bits). |
| Input | Every endpoint validates lengths and formats (names, URLs, UPI ids, colours, phone numbers, emails). Uploads: allowed extensions only, ≤ 10 MB, and the **content must match** (PDF magic, ZIP for Word/Excel, no binary in text). Online sources and webhooks refuse private, loopback, link-local and cloud-metadata addresses (checked at connect time, so DNS tricks do not help). Bot text is shown as text, never as HTML (widget and dashboard). |
| Browser | Dashboard Content-Security-Policy: scripts only from the site, the API and Google sign-in; no plugins; no framing (`frame-ancestors 'none'`); forms post only to the site. The widget lives in a Shadow DOM and stores only a session id and the chat in `sessionStorage`. |
| AI | The model only gets the business's own documents and the question; the system prompt keeps answers grounded and the owner's instructions cannot switch the rules off. Each answer is counted against the plan, so a flood costs the attacker, not the owner. |

## Personal data

| Data | Where | Protection | Kept |
|---|---|---|---|
| Owner email, password hash | identity.users | PBKDF2 hash; email needed for login | until the account is deleted |
| Visitors' lead details: name, phone, email, chat transcript | bots.leads | **AES-256-GCM field encryption** (`enc1:` values, key derived from `JWT_KEY` with HKDF, separate from the channel-secret key). Duplicate checks use an HMAC of the phone, not the number. | until the owner deletes the lead or the account |
| Conversations | bots.conversations / messages | tenant-isolated, deletable per conversation | 180 days, then deleted automatically |
| Messaging-app tokens and app secrets | bots.channels | AES-256-GCM, never returned to the browser | until disconnected |
| Uploaded documents | the service's disk | tenant-isolated paths, random names | until deleted |

Owners can export everything (`/account/export`, leads as CSV) and delete their whole account; deletion removes the
tenant's bots, documents, chats and leads.

**Keys:** `JWT_KEY` protects logins *and* the encrypted fields. Never change it once live (all saved WhatsApp/Telegram
connections and encrypted leads would become unreadable). Never commit it; set it only in Render.

## Denial of service

The app limits each client (above) and stops a single business from running up AI costs (monthly answer quota,
20 messages a minute per messaging-app customer). A large, distributed attack must be absorbed *before* it reaches the
app: on the free plan, put the site behind **Cloudflare's free plan** once you have your own domain (proxy on, "Under
Attack" mode when needed, and a rate-limit rule on `/api/*`). Render and Vercel also filter some volumetric traffic.

## Handling a problem

1. Suspected leak of `JWT_KEY` or the database URL: rotate the Neon password at once; for `JWT_KEY` see the warning
   above (rotating it means reconnecting messaging apps and losing encrypted lead details, so first export leads).
2. Abuse from one IP: the limits handle bursts; repeated abuse can be blocked in Cloudflare.
3. Tell affected businesses within 72 hours of a confirmed personal-data breach (DPDP Act), using the contact in the
   privacy policy.
