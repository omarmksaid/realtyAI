# How realtyAI Works

Three pipelines, end to end: how a document becomes knowledge, how a lead becomes a
conversation, and how a lead's message becomes an AI reply.

Written against the code as of July 2026. File and line references are the source of truth —
if this doc and the code disagree, the code is right.

---

## 1. Ingestion — a file becomes knowledge the AI can quote

**Entry points:** `POST /agent/projects/:id/knowledge/text` (pasted text) and
`POST /agent/projects/:id/knowledge/upload` (a file). Both in `src/routes/agent.ts`.

```
Upload / paste
      │
      ▼
┌─────────────────────┐
│ POST /knowledge/*   │  Writes the file to Supabase Storage (service-role key — the
│ (src/routes/        │  browser can't: RLS is on storage.objects with no policy).
│  agent.ts)          │  Inserts a `documents` row, status = 'processing'.
└──────────┬──────────┘  Enqueues an `ingest` job on pg-boss.
           │
           ▼
┌─────────────────────┐
│ ingest worker       │  src/jobs/ingest.ts
│                     │
│  1. extractText()   │  ── by file type ──────────────────────────────
│                     │  PDF   → pdf-parse reads the embedded text layer.
│                     │          If it yields <200 chars (a scan, a photographed
│                     │          page, a flattened export), hand the whole PDF to
│                     │          Claude as a `document` content block — it reads
│                     │          the text AND the visual layout. No OCR binary.
│                     │  DOCX  → mammoth extracts raw text.
│                     │  Image → Claude vision transcribes every fact.
│                     │  Text  → used as-is (pasted text arrives on the job).
│                     │
│  2. chunkText()     │  Split on blank lines, pack to ~3,200 chars (~800 tokens)
│                     │  with 300 chars of overlap carried between chunks.
│                     │
│  3. WRITE FIRST     │  Insert chunks into `doc_chunks` with embedding = NULL.
│                     │  ⚠️ Order matters. Embedding used to come first, so a Voyage
│                     │  rate limit threw away a document whose text had extracted
│                     │  perfectly — and voice reads the TEXT, never the vector.
│                     │
│  4. EMBED SECOND    │  Voyage `voyage-4` → 1024-dim vectors, batched 32 at a time,
│                     │  with backoff on 429/5xx. Fill in doc_chunks.embedding.
│                     │
│                     │  If embedding fails: the document is still marked 'ready'
│                     │  (it IS usable — calls work), and an `embed-backfill` job is
│                     │  queued. WhatsApp degrades from semantic search to none;
│                     │  the document does not vanish.
└──────────┬──────────┘
           ▼
    documents.status = 'ready'   (or 'failed' if extraction itself failed —
                                  the UI shows a Retry button)
```

**Why Claude reads PDFs directly.** The Anthropic API accepts a PDF as a base64 `document`
content block (32MB / 600-page cap). That's why a scanned brochure works with no poppler, no
rasterizing, and no system binary on Railway. The 20MB upload limit exists because we base64
the file (~33% inflation) and must stay under Anthropic's 32MB request cap.

**Cost.** A large brochure is ~13 chunks, maybe 40K tokens. Voyage charges $0.06/1M — about
two-tenths of a cent — with 200M free tokens. Embeddings are not a cost centre; voice is.

---

## 2. Outreach — a lead becomes a conversation

```
Meta / Google / test webhook
  (src/routes/webhooks/leads.ts)
            │
            ▼
┌───────────────────────────────┐
│ handleIncomingLead()          │  src/core/router.ts
│                               │
│  Dedupe (upsert on            │
│   company+provider+external_id)│
│            │                  │
│  Business hours? ─── yes ──►  │  routed: "human". Nothing automated.
│            │ no               │  The lead appears in the dashboard; the team owns it.
│            ▼                  │
│  Trial expired? ─── yes ──►   │  routed: "billing_paused". Stored, no outreach.
│            │ no               │
│            ▼                  │
│  matchRule(routing_rules)     │  First active rule whose day-type + time window
│            │                  │  matches. Handles windows that wrap midnight.
│            ▼                  │
│  For each channel[i]:         │  boss.send("outreach", …, {
│    enqueue at i × delay        │    startAfter: i * followup_delay_min * 60
│                               │  })
└───────────────┬───────────────┘
                ▼
        ┌───────────────┐
        │ outreach      │  src/jobs/worker.ts
        │ worker        │
        │               │  ESCALATION GUARD: if lead.status is already
        │               │  engaged / handed_off / qualified — the lead replied —
        │               │  skip. This is what stops us calling someone who is
        │               │  actively texting us back.
        └───┬───────┬───┘
            │       │
   ┌────────┘       └────────┐
   ▼                         ▼
WhatsApp                   Voice
```

**The escalation ladder.** `routing_rules.channels` is an ordered array. Channel 0 fires
immediately; each next channel fires `followup_delay_min` later **and is cancelled if the lead
replies in the meantime**. Current rule: `["whatsapp", "voice"]` with a 1-minute gap. That's
what makes voice cheap — you only pay for a call when WhatsApp got no answer.

### WhatsApp (`src/channels/whatsapp.ts`)

Twilio, and shaped entirely by one WhatsApp rule: **a business cannot send free-form text to
someone who hasn't messaged them recently.**

- **First touch** → must be a **pre-approved template** (`contentSid` + variables).
- **Within 24h of the lead's last inbound message** → free-form AI text is allowed.
- **Outside that 24h window** → back to an approved re-engagement template.

The adapter checks the lead's last inbound message timestamp to decide which mode it's in.
Don't "simplify" this away — Twilio rejects out-of-window free-form with error 63016.

### Voice (`src/channels/voice.ts`)

`POST https://api.vapi.ai/call` with the full assistant config inline:

- `phoneNumberId` — the **Vapi UUID** for the imported Twilio number (not the E.164 string).
- `firstMessage` — spoken verbatim before the model runs. When voice is an escalation (there
  are prior channels), it opens by softly acknowledging the earlier attempt without naming it.
- `model` — Claude, with the assembled system prompt (see §4).
- `voice` — ElevenLabs, per-company voice ID.
- `metadata: { conversationId }` — **the end-of-call webhook depends on this.**

Vapi then runs the call itself. We do not drive the conversation turn by turn.

---

## 3. Inbound — a lead's message becomes an AI reply

### WhatsApp (`src/routes/webhooks/inbound.ts` → `/twilio/whatsapp`)

```
Lead sends a WhatsApp message
        │
        ▼
  Twilio POSTs the webhook
        │
        ├─ STOP/UNSUBSCRIBE?  → opt out, done.
        ├─ Media attached?    → Claude vision describes it, folded into the text
        │                        (leads send competitor brochures and listings).
        ├─ Store the inbound message.
        ├─ lead.status = 'engaged'   ← THIS is what cancels the queued voice call.
        │
        ├─ Conversation handed off to a human? → store, no AI reply.
        ├─ Trial expired?                      → store, no AI reply.
        │
        ▼
  generateReply(conversationId)   ← src/ai/conversation.ts
        │
        ├─ [HANDOFF] flag → mark handed_off, SMS the on-call agent
        ├─ [OPTOUT]  flag → mark opted out
        ├─ [CALLBACK:…]   → write a `callbacks` row
        │
        ▼
  Send the reply back via the WhatsApp adapter
```

### Voice (`/webhooks/vapi`, end-of-call)

Nothing arrives *during* the call — Vapi owns the loop. When it ends, Vapi POSTs an
end-of-call report (gated on the `x-vapi-secret` header), and we:

1. Store the recording URL, duration, and outcome in `calls`.
2. Write every transcript turn into `messages`, so the dashboard renders voice and text
   identically.
3. **Extract intent from the finished transcript** with one Claude call: callback time,
   handoff, opt-out, plus the lead's **score** and detected language. A call has no per-turn
   hook to parse `[CALLBACK:…]` tags out of — and those tags would be *read aloud by the TTS*
   — so voice is forbidden the tags and intent is recovered afterwards instead.

---

## 4. How the AI gets its knowledge — and why the two channels differ

`buildSystemPrompt(companyId, projectId, channel, opts)` — `src/ai/conversation.ts`

Every prompt is assembled in layers:

```
┌─ guardrails ────────────────────────────────┐  Hardcoded. Never invent pricing.
│                                             │  No legal/mortgage/tax advice.
│  Channel-specific rules:                    │  Identify as an assistant if asked.
│    text  → keep replies under 3 sentences,  │
│            emit [HANDOFF]/[OPTOUT]/          │  ⚠️ Voice must NOT emit control tags —
│            [CALLBACK:…] tags                │  the TTS would speak them aloud. It did:
│    voice → spoken sentences, no markdown,   │  a lead once heard "Handoff lead.
│            NEVER say a control tag aloud    │  Callback 2 0 2 5 0 7 1 6 T 9."
├─ follow-up context (if escalating) ─────────┤  "You reached out earlier and didn't hear
│                                             │   back" — deliberately vague about which
│                                             │   channel, so the lead isn't made to feel
│                                             │   chased.
├─ company/project template ──────────────────┤  prompt_templates — editable in the
│                                             │  dashboard. Guardrails WRAP this; they are
│                                             │  not editable away.
├─ PROJECT KNOWLEDGE ─────────────────────────┤  projects.knowledge JSON, if populated.
└─ PROJECT DOCUMENTS (voice only) ────────────┘  Up to 20 doc_chunks, inlined.
```

**The key asymmetry:**

| | WhatsApp | Phone call |
|---|---|---|
| **Knowledge delivery** | **RAG**: embed the lead's message → `match_chunks` → inject the top 5 chunks | **Inline**: load the project's chunks into the system prompt up front |
| **When** | Every turn, keyed to what they just asked | Once, at call setup |
| **Needs Voyage?** | Yes — embeds the query and searches vectors | **No** — reads `doc_chunks.content`, the plain text |

**Why voice can't do RAG.** RAG is a per-turn operation: see the question, retrieve the
answer. Vapi owns the call loop — there is no moment where we observe "the lead just asked
about parking" and can go fetch the parking chunk. So retrieval has to happen *before* we know
what they'll ask, which isn't retrieval; it's loading everything.

This works at current scale (a project has a handful of documents) but **does not scale**. A
brokerage with 40 pages of floor plans will blow the prompt. The fixes, in order of effort:

1. **Pre-retrieval** — embed the lead's *inquiry* at call setup and retrieve against that,
   instead of blindly taking the first 20 chunks.
2. **A Vapi mid-call tool** — give the assistant a `lookup_project_details` function it can
   call mid-conversation. This is real RAG on voice, at the cost of in-call latency.

---

## 5. Guardrails that must not be weakened

1. **`companyId` / `userId` come only from `requireAuth`**, never from a request body.
   Webhooks authenticate the provider instead (HMAC / signature / shared secret).
2. **The data assistant uses a fixed read-only tool menu.** No tool accepts `company_id`.
   Never replace it with text-to-SQL.
3. **Guardrails in `buildSystemPrompt` wrap the user-editable template.** A brokerage can
   change the AI's tone; it cannot give it permission to invent a price.
4. **`supabaseAdmin` bypasses RLS.** Every endpoint using it must scope by the `companyId`
   from the auth context — that filter is the only tenant boundary.

---

## 6. Known gaps

- **Storage and delete RLS.** RLS is enabled on `storage.objects` and every table, but there
  is **no DELETE policy anywhere** and no storage policy. Browser-issued deletes and uploads
  are denied — currently routed through the API on the service-role key. A migration adding
  the missing policies is the real fix.
- **WhatsApp scoring is mid-conversation**, not at conversation end — WhatsApp has no natural
  "end", so it needs a lull timer. Voice scores correctly (the call ends).
- **Email is outbound only.** No inbound handler.
- **SMS does not exist** as a lead channel. The only SMS is on-call staff paging.
- **Voice knowledge doesn't scale** past a few documents per project (see §4).
