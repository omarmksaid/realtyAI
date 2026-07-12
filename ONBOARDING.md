# Onboarding a Brokerage

Who does what, what's automated, and what's a queue you can't shorten.

**Status:** the WhatsApp/Meta specifics below are marked ⚠️ where they rest on general
knowledge rather than verified current documentation. A research pass on Meta's Tech
Provider model, Embedded Signup, and template APIs is in flight — this file will be
corrected against it. Do not commit to a customer SLA on the ⚠️ items yet.

---

## The short version

| | Who | How long |
|---|---|---|
| Create workspace, invite team | **Brokerage** (self-serve) | Minutes |
| Buy number, wire webhooks, import to Vapi | **realtyAI** (automated) | Seconds |
| Upload brochures / price sheets | **Brokerage** | Their pace |
| Set coverage hours, routing rules | **Brokerage** | Minutes |
| **AI voice calls live** | — | **Same day** ✅ |
| Provide business verification documents | **Brokerage** — nobody can do this for them | Their pace |
| Submit WhatsApp sender to Meta | **realtyAI** (on their behalf) | Minutes to submit |
| Meta business verification | **Meta** — a queue | ⚠️ Days |
| Author + submit message templates | **realtyAI** | Minutes to submit |
| Template approval | **Meta** — a queue | ⚠️ Hours to days |
| **WhatsApp live** | — | ⚠️ **Days, gated on Meta** |

**The headline: voice works on day one. WhatsApp does not.** Everything blocking WhatsApp
is a Meta approval queue, and no amount of engineering removes it. Sell against that.

---

## What realtyAI does (automated — seconds)

Triggered by `POST /agent/company/buy-number`:

1. **Buy a Twilio number** in the requested area code.
2. **Configure its webhooks** — inbound WhatsApp/SMS → `/webhooks/twilio/whatsapp`,
   delivery receipts → `/webhooks/twilio/status`.
3. **Import it into Vapi** for AI voice, and set the end-of-call webhook + secret at import
   time. This writes `settings.vapi_phone_id`, which `voice.ts` requires.

Retry, if the Vapi import fails: `POST /agent/company/provision-voice`.

**After this the brokerage can place AI voice calls.** Voice has no external approval
gate — that's why it's the demo-day channel.

---

## What realtyAI does (manual — but it's your work, not theirs)

These are yours to do, on the brokerage's behalf. They are the reason onboarding twenty
brokerages is a pipeline, not a button.

- **Submit the WhatsApp sender request** to Meta using the documents the brokerage provided.
- **Author the message templates** and submit them for approval. A first-touch template is
  mandatory — WhatsApp forbids business-initiated free-form messages.
- **Watch the queue** and record the result: `PUT /agent/company/whatsapp-sender` with the
  approved template SIDs.

⚠️ **How much of this is automatable is exactly what the research is resolving.** If Meta's
Tech Provider model and Embedded Signup work the way they appear to, most of the submission
could become self-serve. Do not build the manual flow out before that lands.

---

## What the brokerage MUST do (you cannot do it for them)

This is the list to put in front of a customer on day one.

- **Business verification documents.** Meta verifies *their* legal entity, not yours:
  registered business name, business registration/incorporation document, a verifiable
  address, and a public website with matching details. **This is the single most common
  reason onboarding stalls** — the brokerage sits on it for a week.
- **Choose the WhatsApp display name.** ⚠️ Meta rejects names that don't match the verified
  business, and the rules are strict.
- **Upload their knowledge** — brochures, price sheets, feature sheets. Without it the AI
  deflects every question to "the team will confirm in the morning," which is a bad demo and
  a worse product.
- **Set coverage hours.** Determines what counts as after-hours, which is the whole trigger
  for the product.

---

## What nobody can do

**Meta's review queue.** ⚠️ Business verification takes days; template approval hours to
days. There is no API to jump it, no partner tier that skips it, and no code that helps.

Plan onboarding around this: **voice on day one, WhatsApp when Meta clears.**

---

## The architectural fork (decided: Option A)

**Option A — each brokerage owns their own Meta Business Account and WhatsApp sender.**
✅ *Chosen.*
- The brokerage's business is verified; the sender and templates live in **their** account.
- If they leave, they keep their number and sender. Clean boundary.
- **Lower CASL exposure** (see below).
- Cost: more per-tenant provisioning; less self-serve.

**Option B — everything under realtyAI's Meta Business Account**, brokerages as sub-accounts
under a Tech Provider / BSP arrangement.
- Faster, more self-serve onboarding.
- But **you** own the senders, **you** submit the templates, and you become a WhatsApp
  Business Solution Provider in practice — with Meta's obligations attached.
- **Higher CASL exposure** — see below.

⚠️ The research in flight may reveal a middle path (Tech Provider + Embedded Signup, where
the brokerage self-onboards their own WABA through your UI in minutes). If so, that is
strictly better than the manual version of Option A and we should take it.

---

## Why the fork is a legal question, not just an operational one

From the CASL research (see the Canadian SMS/CASL findings):

> CASL s.9 makes it a violation to "aid, induce, procure or cause to be procured" a
> violation. **CRTC Bulletin 2018-415 expressly names "software and application developers"**
> as intermediaries at risk. It is **strict liability** — it attaches "even if they did not
> intend to do so or were unaware that their activities enabled or facilitated
> contraventions." The only defence is s.33 due diligence.

The CRTC's test is **level of control**. realtyAI already **composes the message, selects the
recipient, and executes the send** — that is the high end of control on any reading. Under
**Option B** you would additionally own the sender, which is maximal control and maximal
exposure. **Option A** puts the sender in the brokerage's name and draws a clearer line.

**This is not theoretical.** Hudson's Bay paid **$120,000** for a *defective unsubscribe
alone* — consent was not even at issue.

### The s.33 due-diligence posture realtyAI needs

- **Consent attestation at onboarding** — the brokerage confirms their lead source produces
  CASL-valid consent. (Not built.)
- **Hardcoded identification + unsubscribe** in the message layer, which the brokerage cannot
  edit away. The existing `buildSystemPrompt` guardrail pattern is exactly the right shape.
  (Email has a CASL footer; **WhatsApp and SMS do not.**)
- **STOP suppression across every channel**, not just the one they replied on. (Currently
  channel-local.)
- **Six-month implied-consent window** enforced — a lead who inquired 7 months ago must not
  be messaged. (Not built.)
- **Per-company audit logging.** (Exists.)
- **CASL terms in the customer agreement.** (Yours to write.)

---

## The provisioning state machine

`GET /agent/company/provisioning` returns every step, whether it's done, what's blocking, and
the action to resolve it. Rendered as the **Setup Status** card at the top of Settings.

| Step | Blocking? | Owner | Automated? |
|---|---|---|---|
| `number` | **Yes** — nothing works without it | realtyAI | ✅ Seconds |
| `voice` | No | realtyAI | ✅ Seconds (auto on purchase, retryable) |
| `whatsapp_sender` | No | Brokerage docs → realtyAI submits → **Meta approves** | ❌ Queue |
| `templates` | No | realtyAI authors → **Meta approves** | ❌ Queue |
| `hours` | No | Brokerage | ✅ Self-serve |

**Why this exists:** a half-provisioned workspace used to look *identical* to a working one
right up until a lead arrived and the send failed. At two customers you remember. At twenty
you do not.

---

## Multi-tenant invariants — do not weaken

1. **A workspace sends only from its own number.** The adapters used to fall back to the
   platform's `TWILIO_WHATSAPP_NUMBER` / `VAPI_PHONE_NUMBER_ID` when a company wasn't
   provisioned — so an unprovisioned brokerage's leads received messages from **our** number,
   and their replies landed in a webhook we couldn't attribute. That fallback now requires an
   explicit `settings.use_platform_number` opt-in (dev/demo only) and otherwise **fails with
   an actionable error**.
2. **Template SIDs are per-sender.** A template SID belongs to the sender's Meta account. It
   **cannot** be shared across brokerages. `settings.first_touch_template_sid`, never the env
   var.
3. **The brokerage's own name**, never `env.BROKERAGE_NAME` — that global would have
   introduced the AI as the same company to every tenant's leads.
4. **`companies.settings` is the source of truth.** The env vars are a dev fallback, not
   configuration.

---

## Open questions (research in flight)

1. Can a brokerage self-onboard their WABA via **Embedded Signup** through realtyAI's UI —
   turning the manual submission into minutes? Does Twilio support it?
2. **Tech Provider vs. own-BM**: can realtyAI host senders for many clients under its own
   Meta Business Account, and what does that cost in obligations (and CASL exposure)?
3. Can templates be **created and submitted programmatically** (Twilio Content Template API /
   Meta API), and can one be authored once and cloned across many client WABAs — or must each
   be submitted per-WABA?
4. Real 2026 SLAs for business verification and template approval.
5. New-sender **messaging limits and quality tiers** — a brand-new sender may be throttled,
   which matters if a brokerage's ad campaign dumps 200 leads on day one.
6. **Display name rejection rules** — the most common self-inflicted delay.
