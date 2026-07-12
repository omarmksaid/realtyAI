# Onboarding a Brokerage

Who does what, what's automated, and what's a queue you can't shorten.

The WhatsApp/Meta sections are now grounded in primary sources (Meta's Tech Provider and
Embedded Signup docs, Twilio's Tech Provider program), adversarially verified. Claims marked
**[2-1]** had one dissenting verifier — treat as likely but not settled.

---

## The headline

**Voice is live on day one. WhatsApp is not.** Everything blocking WhatsApp is a Meta
approval queue. Sell against that.

But the WhatsApp picture is much better than a manual back-and-forth: **Embedded Signup lets
each brokerage self-onboard their own WhatsApp account inside realtyAI's UI**, in one
Login-with-Facebook popup. The manual submission flow does not need to be built.

**The real constraint is a one-time cost on realtyAI, not a per-brokerage cost.**

---

## The one-time work realtyAI must do BEFORE onboarding anyone

This is the gate. Until it's done, **you cannot onboard a single brokerage's WhatsApp.**

1. **Enable 2FA and complete Meta Business Verification on realtyAI's own Meta Business
   Manager.** A vendor-side prerequisite, done once.
   > *"To participate in the Tech Provider program you need to turn on two-factor
   > authentication (2FA) and complete business verification in your Meta Business Manager
   > settings."*
2. **Create a Meta app with the WhatsApp use case** and a connected business portfolio.
3. **Pass Meta App Review for Advanced Access** to `whatsapp_business_messaging` and
   `whatsapp_business_management` — required to send on behalf of clients and access their
   WABAs.
4. **Complete Access Verification.**
5. **Build the Embedded Signup flow** — Meta app, Configuration ID, Partner Solution ID,
   Facebook JavaScript SDK. Must use **Facebook Login for Business** (not plain Facebook
   Login), which scopes the token so you only get WhatsApp-relevant assets. **[2-0]**

⚠️ **Meta Business Verification "varies by region and can take several weeks."** That is
Twilio's own warning, and it applies to *your* verification. **Start this now** — it is the
long pole in the entire product, and it blocks every WhatsApp customer you will ever have.

### The throughput cap — this is the number that matters

| Vendor state | New WhatsApp customers per rolling 7 days |
|---|---|
| App not approved for Advanced Access | **0** — you cannot onboard anyone |
| Advanced Access approved (default) | **10 / week** |
| + Business Verification + App Review + Access Verification | **200 / week** |
| Above 200/week | Must become a **Meta Business Partner** |

> *"By default, you can onboard up to 10 new business customers in a rolling 7-day window...
> If you complete Business Verification, App Review, and Access Verification, your limit is
> automatically increased to 200."*

**"Onboard tens of brokerages at once" is fine — 200/week is not your bottleneck.** Getting
*through* verification is.

---

## The architectural question — answered, and not by choice

You picked "own sender per brokerage." **It turns out that isn't a choice — it's the only
option.**

> Twilio: *"Each WABA must be mapped to a single Twilio account or subaccount. You must keep
> track of every customer business or brand and connect each one to a dedicated Twilio
> subaccount."*
>
> Meta: *"Business customers onboarded via Embedded Signup own all of their WhatsApp
> assets."* The vendor receives only delegated access — the customer's WABA ID, phone number
> ID, and an exchangeable token.

**A SaaS vendor cannot host many clients' senders under one shared WABA.** There is no
"Option B."

Two consequences worth internalising:

- **Each brokerage needs its own Twilio subaccount**, mapped 1:1 to their WABA. realtyAI
  currently uses one flat Twilio account. **This is a real architectural change we have not
  made.**
- **Messaging limits are per business portfolio, not per number.** Because each brokerage
  owns their own portfolio, each gets their **own** limit — they don't share a pool. That's
  good. (Had a shared-WABA model been possible, every client would have contended for one
  limit.)

### Lower CASL exposure, as a bonus

From the CASL research: CRTC Bulletin 2018-415 names *"software and application developers"*
as liable under s.9 for aiding a customer's violation — **strict liability**, and the test is
**level of control**. realtyAI already composes the message, selects the recipient, and
executes the send. Client-owned WABAs put the sender in the brokerage's name and draw a
clearer boundary than hosting it yourself would have. The forced architecture is also the
safer one.

---

## Per-brokerage onboarding — what actually happens

### realtyAI (automated, seconds)

`POST /agent/company/buy-number`:
1. Buy a Twilio number.
2. Configure its webhooks (inbound → `/webhooks/twilio/whatsapp`, receipts →
   `/webhooks/twilio/status`).
3. **Import it into Vapi**, setting the end-of-call webhook + secret at import time. Writes
   `settings.vapi_phone_id`, which `voice.ts` requires.

Retry if the Vapi import fails: `POST /agent/company/provision-voice`.

**→ AI voice calls work now.** No external approval gate. This is the demo-day channel.

### The brokerage (self-serve, minutes — via Embedded Signup)

They click **"Connect WhatsApp"** in realtyAI and complete one Meta popup:
- Log in with Facebook
- Create or select their Meta Business Portfolio
- Create their WhatsApp Business Account (WABA)
- Optionally verify a phone number by OTP

> *"The customer clicks Login with Facebook in your application to open the Embedded Signup
> popup... In the popup window, the customer follows the Embedded Signup flow."*

**realtyAI never calls a Meta API.** After the popup completes, your backend registers the
sender through **Twilio's Messaging API Senders resource** — *"the ISV won't need to call any
Meta APIs."*

### Meta (a queue — nobody can shorten it)

- **Business verification** for the brokerage. ⚠️ Several weeks in the worst case.
  **[2-1]** A partner (you) can verify the business *on the client's behalf* — an officially
  supported path, and worth doing.
- **Template approval.**

### Messaging limits — plan for the cold start

A new business portfolio starts at **250 unique contacts per 24 hours**, scaling to 2,000 →
10,000 → 100,000 → unlimited.

**This matters operationally:** if a brokerage's ad campaign dumps 300 leads on day one, the
first 250 get WhatsApp and the rest silently don't. Voice has no such cap — another reason
voice is the stronger day-one channel.

---

## What the brokerage MUST do (you cannot do it for them)

- **Complete the Embedded Signup popup.** Two minutes, but it needs a Facebook login and
  authority to create a business portfolio — that's the *owner*, not an agent.
- **Provide business verification details.** Meta verifies *their* legal entity: registered
  name, incorporation document, verifiable address, public website with matching details.
  **This is where onboarding actually stalls** — the brokerage sits on it.
- **Choose the WhatsApp display name.** Meta rejects names that don't match the verified
  business.
- **Upload their knowledge** — brochures, price sheets. Without it the AI deflects every
  question to "the team will confirm in the morning."
- **Set coverage hours** — defines after-hours, which is the entire product trigger.

---

## Gap analysis — what realtyAI has NOT built

| | Status |
|---|---|
| Buy number → webhooks → Vapi import | ✅ Built, automated |
| Provisioning status card (`GET /company/provisioning`) | ✅ Built |
| Per-company number / templates / brokerage name (no platform fallback) | ✅ Built |
| **Meta Business Verification for realtyAI itself** | ❌ **Not started — blocks everything** |
| **Meta app + App Review + Advanced Access** | ❌ Not started |
| **Embedded Signup flow in the UI** | ❌ Not built |
| **Twilio subaccount per brokerage (1:1 with WABA)** | ❌ **Not built — flat account today** |
| Register sender via Twilio Senders API post-signup | ❌ Not built |
| Template creation/submission | ❌ Manual today (SIDs pasted into Settings) |
| CASL: identification + unsubscribe on WhatsApp/SMS | ❌ Email only |
| CASL: 6-month implied-consent window | ❌ Not enforced |
| CASL: STOP suppression across all channels | ❌ Channel-local |

**The two big ones:** Meta verification (a calendar problem — start today) and Twilio
subaccounts (an architecture problem — every brokerage needs one).

---

## Multi-tenant invariants — do not weaken

1. **A workspace sends only from its own number.** The adapters used to fall back to the
   platform's `TWILIO_WHATSAPP_NUMBER` / `VAPI_PHONE_NUMBER_ID` when a company wasn't
   provisioned — so an unprovisioned brokerage's leads received messages from **our** number,
   and their replies landed in a webhook we couldn't attribute. That now requires an explicit
   `settings.use_platform_number` opt-in (dev/demo only) and otherwise **fails with an
   actionable error**.
2. **Template SIDs are per-sender.** A template SID belongs to the client's own WABA. It
   **cannot** be shared across brokerages.
3. **The brokerage's own name**, never `env.BROKERAGE_NAME` — that global would have
   introduced the AI as the same company to every tenant's leads.
4. **`companies.settings` is the source of truth.** Env vars are a dev fallback, not
   configuration.
5. **One Twilio subaccount per brokerage**, 1:1 with their WABA. *(Not yet implemented.)*

---

## Recommended sequence

1. **Today:** start Meta Business Verification for realtyAI. It's weeks of waiting and it
   gates everything. Nothing else on this list is on the critical path until it's done.
2. **This week:** demo on **voice** — it works today and has no approval gate.
3. **While Meta reviews:** build the Twilio subaccount-per-brokerage architecture, and the
   CASL compliance layer (identification + unsubscribe on WhatsApp, cross-channel STOP,
   six-month consent window). Both are needed regardless.
4. **Once verified:** build Embedded Signup. Onboarding then becomes: brokerage clicks one
   button, completes one popup, and waits on Meta's queue — with the Setup Status card
   showing them exactly where they are.

---

## Sources

Meta Tech Provider / Solution Partner overview · Meta Embedded Signup overview · Meta Tech
Provider getting-started · Twilio WhatsApp Tech Provider Program · Twilio Embedded Signup
docs. All primary. Verified 2026-07.
