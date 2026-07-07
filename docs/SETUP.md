# Setup & install

Local dev to first fake lead in ~30 minutes. Provider registrations (Meta review,
WhatsApp template approval) run in parallel and are covered in `docs/INTEGRATIONS.md`.

## Prerequisites
Node 20+, a Supabase project (free tier fine), and accounts for: Twilio, Vapi,
ElevenLabs, Resend, Anthropic, Voyage AI. None are needed for the frontend demo.

## 1. Database (Supabase)

Run the migrations **in order** in the SQL editor (or `supabase db push` with the CLI):

```
supabase/migrations/0001_init.sql               -- schema + RLS
supabase/migrations/0002_rag_scoring_takeover.sql
supabase/migrations/0003_assistant_chat.sql
supabase/migrations/0004_embedding_dims.sql     -- must run before any knowledge ingest
supabase/migrations/0005_form_mapping.sql
supabase/migrations/0006_team_oncall_hours.sql
supabase/migrations/0007_transcript_search.sql
```

Then `supabase/seed.example.sql` — it creates the private `knowledge` storage bucket
(one-time) and, per company, the default routing rules, default prompt, and business
hours. Replace `:COMPANY_ID` after your first signup, or use the commented manual insert.

Collect three values from Project Settings → API: the URL, the `service_role` key,
and the **JWT secret** (auth middleware verifies session tokens locally with it).

## 2. Backend

```bash
npm install
cp .env.example .env    # fill it — see the reference below
npm run dev             # API on :3000, worker starts in-process
curl localhost:3000/health
```

Env reference (also in `.env.example`):

| Var | What / where |
|---|---|
| APP_URL | Public URL of this API (Railway URL in prod; ngrok for local webhook testing) |
| DATABASE_URL | Supabase **pooler** connection string (pg-boss uses it) |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET | Project Settings → API |
| ANTHROPIC_API_KEY | console.anthropic.com |
| VOYAGE_API_KEY | Embeddings for RAG + search (dash.voyageai.com) |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN | Twilio console |
| TWILIO_WHATSAPP_NUMBER | Your business number, E.164 |
| TWILIO_FIRST_TOUCH_TEMPLATE_SID / TWILIO_REENGAGE_TEMPLATE_SID | Content SIDs after template approval |
| VAPI_API_KEY / VAPI_PHONE_NUMBER_ID / VAPI_WEBHOOK_SECRET | Vapi dashboard |
| ELEVENLABS_API_KEY / DEFAULT_VOICE_ID | ElevenLabs; default voice until a company picks one |
| RESEND_API_KEY / EMAIL_FROM | Resend, after domain verification |
| META_APP_SECRET / META_VERIFY_TOKEN | Meta app; verify token is any random string you choose |
| BROKERAGE_NAME / BROKERAGE_ADDRESS | CASL email footer identity |

## 3. Frontend

```bash
cd web && npm install && npm run dev   # localhost:3000 conflicts — Next picks 3001
```

With no env vars it runs in **demo mode** (realistic fake data) — evaluate every page
without any setup. To go live, set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and implement the queries documented in `web/lib/data.ts`
(see CLAUDE.md, TODO #1).

## 4. Fire a fake lead end-to-end

Expose your local API (`ngrok http 3000`), insert a `lead_sources` row for Google:

```sql
insert into lead_sources (company_id, provider, label, config)
values ('<company>', 'google', 'Local test', '{"google_key":"testkey","form_project_map":{"form_1":"<project id>"}}');
```

Then simulate Google's webhook (this is byte-for-byte the real payload shape):

```bash
curl -X POST "http://localhost:3000/webhooks/google?src=<lead_source_id>" \
  -H 'Content-Type: application/json' -d '{
  "lead_id": "test-001", "form_id": "form_1", "campaign_id": 123,
  "google_key": "testkey", "is_test": false,
  "user_column_data": [
    {"column_id": "FULL_NAME", "string_value": "Test Lead"},
    {"column_id": "PHONE_NUMBER", "string_value": "+1647555xxxx"},
    {"column_id": "EMAIL", "string_value": "you@example.com"}
  ]}'
```

If it's currently outside your staffed hours, watch the worker log fire the WhatsApp
first touch (or email, if templates aren't approved yet). Reply on WhatsApp from that
phone and watch the AI answer. Set `is_test: true` to verify the pipe without messaging.

## Deploy
Railway: `docs/RAILWAY.md`. Meta/Google connections: `docs/INTEGRATIONS.md`.
