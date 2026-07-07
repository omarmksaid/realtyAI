# CLAUDE.md — realtyAI

AI lead-response platform for real estate brokerages. Flagship feature: **After Hours** —
leads from Meta/Google ads arriving outside staffed hours get an AI WhatsApp conversation,
AI voice call, and email; humans get a morning digest, full transcripts, and takeover.

## Architecture (one paragraph)
Two deployables: `/` is a Node/Hono API + pg-boss worker (Railway), `web/` is a Next.js 14
dashboard. Postgres is Supabase — it also provides Auth (JWTs), Storage (bucket `knowledge`),
and hosts the pg-boss job queue (no Redis). Providers: Twilio (WhatsApp + SMS), Vapi +
ElevenLabs (AI voice calls), Resend (email), Voyage (embeddings), Anthropic (all reasoning).
Leads arrive via webhooks (`src/routes/webhooks/leads.ts`), route through
`src/core/router.ts` (staffed hours → humans; otherwise match a `routing_rules` row and
enqueue channel jobs), and every turn on every channel lands in the `messages` table.

## Security invariants — do not weaken
1. `companyId` and `userId` come ONLY from `requireAuth` context (`src/lib/auth.ts`),
   never from request bodies. Webhooks authenticate the provider instead (HMAC/signatures).
2. The data assistant (`src/ai/assistant.ts`) uses a fixed read-only tool menu; no tool
   accepts company_id. Never replace this with text-to-SQL.
3. Guardrails in `buildSystemPrompt` (no invented pricing, [HANDOFF]/[OPTOUT]) are
   hardcoded and wrap user-editable templates. Keep them out of the editable layer.
4. RLS policies key off `memberships` via `my_company_ids()`. New tables need
   `company_id` + the same policies (see any migration for the pattern).

## Conventions
- TypeScript, ESM. Backend: Hono routes in `src/routes/`, channel adapters implement
  `ChannelAdapter` (`src/channels/types.ts`) and register in `src/jobs/worker.ts`.
- Dates: leads think in company-local time; `companies.timezone` + luxon. Any user-facing
  date query converts local day-bounds → UTC (see `dayRangeUtc` in assistant.ts).
- Frontend: no Tailwind; design tokens live in `web/app/globals.css` (sage/off-white,
  serif for the digest). Keep bullets/formatting minimal, memo-style Today page.
- Frontend data: every page currently renders demo data from `web/lib/data.ts` when
  `NEXT_PUBLIC_SUPABASE_URL` is unset. Each fetcher documents its real Supabase query
  in comments — implement those, keep demo mode working as the fallback.

## State: wired vs stubbed
WIRED (backend): ingestion (Meta fetch-back, Google direct, is_test handling, form_id),
routing + escalation with reply-cancellation, WhatsApp (template-first, 24h-window guard,
status callbacks, inbound media via Claude vision), voice (Vapi full config, per-company
ElevenLabs voice), email (CASL footer), conversation loop with RAG retrieval, ingest
worker (pdf/docx/image → chunks → Voyage embeddings), morning digest cron, data assistant,
sources form→project mapping (Meta form auto-discovery), team invites + on-call SMS
(paged once per lead), transcript FTS (`search_transcripts`), auth middleware (user +
platform-admin), per-event cost tracking with /agent/costs, /admin operator portal
(companies, usage, spend, margin, billing PATCH), 14-day trials (clock starts on first
lead; expiry pauses outreach/AI/digest but keeps ingestion + read access; 3-day and
expiry emails via daily trial-check job), landing page + signup/join flows, audit log.

STUBBED / TODO (priority order):
1. Frontend ↔ Supabase: replace demo fetchers with real queries + `@supabase/ssr` auth,
   route guard on the (app) group + /admin page gate (redirect to /login when no session)
   on `web/app/login`; send `Authorization: Bearer <session JWT>` (+ `X-Company-Id`)
   to the API for /agent /assistant /sources /team calls.
2. Coverage calendar save: serialize painted grid → `PUT /agent/company/hours`
   (collapse contiguous cells into [["09:00","17:00"]] intervals).
3. Drive sync worker (`drive-sync` job is enqueued but has no handler): Google service
   account the customer shares a folder with → list/download → reuse ingest pipeline.
4. Per-lead scoring job (columns exist: leads.score/score_reason/detected_language) —
   small Claude call after each conversation lull; also set detected_language on first reply.
5. Digest email delivery (reuse emailAdapter; recipients = memberships role owner/admin).
6. bookCallback in-call tool: Vapi tool → POST endpoint → write preferred time to lead.
7. Scanned-PDF OCR path in ingest (pdftoppm pages → Claude vision, marked in ingest.ts).

## Commands
Backend: `npm install && npm run dev` (tsx watch) · build: `npm run build && npm start`
Web: `cd web && npm install && npm run dev` — runs on demo data with zero config.
Migrations: run `supabase/migrations/0001..0009` in order, then `supabase/seed.example.sql`.

## Gotchas
- pg-boss lives in the same Postgres — DATABASE_URL must be the Supabase pooler string.
- WhatsApp: business-initiated messages MUST use approved templates (contentSid); the
  adapter enforces the 24h session rule — don't "simplify" it to always free-form.
- Vapi metadata carries conversationId — the end-of-call webhook depends on it.
- `messages.search` is a generated column: inserts just work, never write to it.
- Next build warns about Google Fonts minification offline — harmless, exit 0.
