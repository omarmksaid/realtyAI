# Railway deployment

Two services from one repo: the API+worker, and the Next.js dashboard.
Supabase stays external — Railway runs no database.

## Service 1 — API + worker

1. Railway → New Project → Deploy from GitHub repo (push the repo to GitHub first).
2. Settings for the service:
   - **Root directory**: `/` (repo root)
   - **Build command**: `npm install && npm run build`
   - **Start command**: `npm start`   (runs `node dist/index.js` — API and pg-boss worker in one process)
3. Variables: paste everything from `.env` (see docs/SETUP.md table). Two that change in prod:
   - `APP_URL` = this service's public URL — set it **after** step 4, then redeploy
     (webhook signature validation and unsubscribe links are built from it).
   - `DATABASE_URL` = the Supabase **pooler** string (port 6543 "transaction" mode works;
     if pg-boss complains about prepared statements, switch to the session pooler on 5432).
4. Settings → Networking → **Generate Domain**. This URL is what you give Meta, Twilio,
   Vapi, and Google as the webhook base. A custom domain (api.yourdomain.com) is better
   long-term — provider webhook configs are annoying to update later.
5. Health check path: `/health`.

### Scaling notes
One process is right until real volume. The seam is already in the code: split by
starting the same image twice, one with the HTTP server, one running only
`startWorker()` (add a `WORKER_ONLY` env check in `src/index.ts` — 5 lines).
pg-boss coordinates safely across multiple workers via Postgres.

### Deploy checklist for webhooks (after both this and INTEGRATIONS.md)
- Meta app → Webhooks → callback `https://<domain>/webhooks/meta` + your META_VERIFY_TOKEN
- Twilio WhatsApp sender → inbound URL `https://<domain>/webhooks/twilio/whatsapp`
- Vapi assistant/server URL → `https://<domain>/webhooks/vapi` (+ secret)
- Google lead forms → per-form URLs from the Sources page

## Service 2 — dashboard (Next.js)

Same repo, second service:
- **Root directory**: `web`
- **Build command**: `npm install && npm run build`
- **Start command**: `npm start`
- Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
  `NEXT_PUBLIC_API_URL` = service 1's domain.
- Generate its own domain (app.yourdomain.com). The anon key is safe to expose —
  RLS is the enforcement layer.

## Operations
- **Logs**: Railway's log view shows worker job output; failed jobs log and retry
  with backoff (pg-boss), then land visible in the `pgboss.job` table.
- **Migrations**: run against Supabase directly (SQL editor or CI step) — Railway
  deploys don't touch the schema.
- **Secrets rotation**: everything is env-var based; rotate in Railway → redeploy.
- **Cost expectation**: both services fit comfortably in Railway's smallest tier;
  the spend that matters is per-conversation (Twilio/Vapi/LLM), not hosting.
