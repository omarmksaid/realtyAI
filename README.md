# realtyAI — AI lead platform for real estate brokerages

**Flagship feature: After Hours** — leads from Meta and Google ads arriving outside staffed
hours get an instant AI response on WhatsApp, an AI voice call, and email; the team walks in
to a written morning briefing, full transcripts, and the hot list.

Multi-tenant by design: every table carries `company_id`, Supabase RLS enforces isolation,
and onboarding another brokerage is a signup + provider credentials — no code changes.

## What it does

**Ingestion & routing.** Real-time webhooks from Meta Lead Ads (HMAC-verified, Graph API
fetch-back) and Google Ads lead forms (direct POST, per-form keys, test-data handling).
Each ad form maps to a project on the **Sources** page (Meta forms auto-discovered via the
Graph API; unmapped-form alerts with retroactive re-mapping). During staffed hours — painted
on the **Coverage calendar**, with holiday support — leads go straight to the human team.
After hours, configurable **routing rules** decide channels and escalation order
(e.g. WhatsApp → AI call after 15 min of silence → email), with pending steps cancelled the
moment the lead replies.

**Conversations.** Claude runs every channel with hardcoded guardrails (no invented pricing,
`[HANDOFF]`/`[OPTOUT]` flags) wrapping per-project **versioned prompts** editable in
Playbooks. Replies come in the lead's language, grounded by **RAG** over each project's
knowledge base — Google Drive folders, pasted text, or uploaded floor plans and price sheets
(images are read by Claude vision). WhatsApp is production-grade: template-first compliance,
24-hour session-window guard with re-engagement templates, delivery/read receipts, STOP
handling, and inbound photo understanding. Voice calls run on Vapi with per-company
**ElevenLabs voices** (chosen in Settings), multilingual transcription, voicemail detection,
recordings, and full transcripts stored as messages.

**The human side.** A memo-style **morning briefing** written at 8:30 with Hot/Warm/Cold
scored leads and reasons. One-tap **human takeover** — the agent types in the dashboard and
sends from the same WhatsApp number; system lines mark every handoff. **On-call SMS**: team
members join via email invite links, add a mobile number, and get texted (once per lead)
when a lead asks for a person. **Transcript search** (full-text, multilingual-safe, phrase
and exclusion syntax) across every channel, and a natural-language **Assistant** ("give me
all the leads from June 21st") powered by a fixed, company-scoped, read-only tool menu —
never text-to-SQL — with a visible per-answer audit trail.

**Operations.** Per-event **cost tracking** at every send site (actual Vapi call costs when
reported, real token counts for LLM spend), a spend tile and per-conversation price tag, and
`GET /agent/costs` for per-lead economics. A **platform admin portal** (`/admin`, gated by
`platform_admins`) shows every company's usage, spend, margin, and plan. **Two-week trials**
start on the company's first lead (setup time is free), degrade gracefully at expiry (leads
still ingest and data stays readable; outreach, AI replies, and the digest pause), and send
3-day and expiry-day emails automatically. Everything sensitive is audit-logged.

**Surfaces.** A public landing page with login/signup, the dashboard (Today, Leads,
Conversations, Projects, Sources, Playbooks, Assistant, Settings), invite-join and signup
flows, and the operator portal. The frontend runs on realistic demo data with zero
configuration (`cd web && npm install && npm run dev`).

## Architecture

```
 Meta leadgen webhook ──┐                        ┌── Twilio ──► WhatsApp / SMS ──► lead
 Google form webhook ───┤                        ├── Vapi + ElevenLabs ──► voice call
                        ▼                        ├── Resend ──► email
              ┌── RAILWAY (Node/Hono) ───────────┤
 dashboard ──►│  API: webhooks · /agent · /assistant · /sources · /team · /admin
 (JWT auth)   │  Worker (pg-boss): outreach · ingest · digest · trial-check
              │  Claude: conversations · digest · assistant · vision
              └────────────┬─────────────────────┘◄── inbound: WA replies, call
                           ▼                          transcripts, delivery receipts
              ┌── SUPABASE (Postgres + Auth + Storage) ──────────┐
              │ Tenancy: companies · memberships (RLS root)      │
              │ Config: routing_rules · prompt_templates ·       │
              │   lead_sources · business hours · voice · plan   │
              │ Pipeline: leads → conversations → messages/calls │
              │ Knowledge: projects → documents → doc_chunks 🔍  │
              │ Ops: daily_summaries · cost_events · invites ·   │
              │   assistant threads · audit_log · pg-boss queue  │
              └──────────────────────────────────────────────────┘
```

Escalation logic: channel[0] fires immediately; later channels are scheduled
`followup_delay_min` apart with singleton keys, and inbound replies cancel pending jobs.
Extensibility: channels implement one `ChannelAdapter` interface — SMS, Instagram DM, or a
CRM sync are each one new file plus a registry entry.

## Repository

```
src/            API + worker (Hono, pg-boss)
  routes/       webhooks · agent · assistant · sources · team · admin
  channels/     whatsapp · voice · email (+ types.ts — the adapter seam)
  core/         router · hours (coverage schedule)
  ai/           conversation (RAG) · assistant · embeddings · scoring prompts
  jobs/         worker · ingest · queue
  lib/          auth (user + platform-admin gates) · billing (trial) · costs · supabase · env
web/            Next.js dashboard — landing page + (app) route group; demo mode built in
supabase/       migrations 0001–0009 + seed.example.sql
docs/           SETUP.md · RAILWAY.md · INTEGRATIONS.md
CLAUDE.md       Claude Code handoff: conventions, security invariants, wired-vs-TODO
```

## Migrations (run in order, then seed)

| # | Adds |
|---|---|
| 0001 | Core multi-tenant schema + RLS: tenancy, projects, prompts, leads, rules, conversations, messages, calls, digests, audit |
| 0002 | pgvector RAG (documents, chunks, HNSW), lead scoring columns, takeover constraints |
| 0003 | Assistant chat threads/messages |
| 0004 | Embedding dims → Voyage (1024) + `match_chunks` |
| 0005 | `leads.form_id` for Sources mapping + Google test verification |
| 0006 | Team invites, on-call phone/toggle, configurable business hours |
| 0007 | Full-text transcript search (`search_transcripts`) |
| 0008 | Per-event cost tracking (`cost_events`) |
| 0009 | Platform admins + billing/plan/trial fields on companies |

`seed.example.sql` creates the `knowledge` storage bucket and per-company defaults
(routing rules, base prompt, business hours).

## Getting started

- **Install & run locally, fire a fake lead**: `docs/SETUP.md`
- **Deploy (two Railway services)**: `docs/RAILWAY.md`
- **Connect Meta & Google, sandbox demo without ad spend**: `docs/INTEGRATIONS.md`
- **Continue development with Claude Code**: `CLAUDE.md` — includes the prioritized TODO
  list (frontend↔Supabase wiring is #1; the dashboard is demo-mode until then)
- **Client kickoff**: the onboarding questionnaire (delivered alongside this repo) maps
  seven decisions — hours, calling, voice, templates, on-call, unmapped leads,
  retention — directly onto configuration.

## Operating cost (measure, don't guess)

Ballpark at 30 leads/day with 20% five-minute calls: **~$300–550/mo** all-in
(voice dominates at ~$0.15–0.30/min; roughly $0.35–0.60 per lead). But the platform
records real costs per event — quote customers from `/admin` and `GET /agent/costs`
after two weeks of live data, not from this paragraph.
