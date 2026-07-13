import Link from "next/link";

/**
 * Lead-facing privacy notice — the page a brokerage links from its Meta/Google lead form.
 *
 * ⚠️ NOT LEGAL ADVICE, AND NOT READY TO PUBLISH AS-IS.
 *
 * Everything describing how data is processed is accurate to the code (what we collect,
 * who it's sent to, that calls are recorded). Everything that requires a legal decision is
 * marked [PLACEHOLDER] and must be filled in — by the brokerage, reviewed by a lawyer.
 *
 * WHOSE POLICY IS THIS? The brokerage's. They run the lead form; the lead is handing THEIR
 * phone number to the brokerage. Under PIPEDA/CASL the brokerage is the organization
 * accountable for the personal information; realtyAI processes it on their behalf. A notice
 * that named realtyAI as the collector would misdescribe who is accountable and who a lead
 * must contact to have their data deleted.
 *
 * TODO before this is production-ready:
 *   - Make it per-brokerage (/privacy/[slug]) driven by companies.settings, so each
 *     brokerage's real legal name, address, and privacy contact render here.
 *   - Decide and ENFORCE a retention period. Today nothing is ever deleted — no purge job
 *     exists for leads, transcripts, or call recordings. A stated period we don't enforce is
 *     worse than no statement.
 *   - Have a Canadian privacy lawyer review it. See ONBOARDING.md on CASL s.9: CRTC Bulletin
 *     2018-415 names software developers as liable for aiding a customer's violation, and the
 *     only defence is documented due diligence.
 */

const PLACEHOLDER = "[PLACEHOLDER]";

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who we are",
    body: (
      <>
        This notice explains how <b>{PLACEHOLDER} (the &ldquo;Brokerage&rdquo;)</b> handles the
        personal information you provide when you submit an inquiry through one of our
        advertisements or forms.
        <br />
        <br />
        The Brokerage is the organization accountable for your personal information. We use
        realtyAI, a third-party software platform, to respond to inquiries on our behalf.
      </>
    ),
  },
  {
    heading: "What we collect",
    body: (
      <>
        When you submit an inquiry form, we receive the information you enter — typically your{" "}
        <b>name, phone number, and email address</b>, along with any other fields on that
        specific form, and technical details about the ad you responded to.
        <br />
        <br />
        If you then converse with us, we also collect <b>the content of those conversations</b>:
        the messages you send and receive, and — where you speak with us by telephone —{" "}
        <b>a recording and a written transcript of the call</b>.
      </>
    ),
  },
  {
    heading: "Automated conversations",
    body: (
      <>
        Inquiries received outside our staffed hours may be answered by an{" "}
        <b>automated AI assistant</b> — by message, and by telephone call — before a member of
        our team follows up.
        <br />
        <br />
        <b>Calls with the AI assistant are recorded and transcribed.</b> You can ask to speak
        with a person at any time, and you can end the call at any time.
      </>
    ),
  },
  {
    heading: "Why we use it",
    body: (
      <>
        To respond to your inquiry, answer your questions about the property you asked about,
        arrange a follow-up with one of our agents, and keep a record of our conversation so
        our team knows what you have already been told.
      </>
    ),
  },
  {
    heading: "Who we share it with",
    body: (
      <>
        We share your information with service providers who process it strictly on our
        instructions, and only to deliver the service above:
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            <b>realtyAI</b> — the platform that handles the conversation on our behalf
          </li>
          <li>
            <b>Anthropic</b> — the AI model that generates responses
          </li>
          <li>
            <b>Twilio</b> — message and telephone delivery
          </li>
          <li>
            <b>Vapi</b> and <b>ElevenLabs</b> — AI voice calling
          </li>
          <li>
            <b>Voyage AI</b> — search across our property documents
          </li>
          <li>
            <b>Resend</b> — email delivery
          </li>
          <li>
            <b>Supabase</b> — data storage
          </li>
        </ul>
        <br />
        <b>We do not sell your personal information.</b> Some of these providers process data
        outside Canada, which means it may be subject to the laws of those jurisdictions.
      </>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <>
        {PLACEHOLDER} — the Brokerage&apos;s retention period must be stated here, and it must
        be one we actually enforce.
        <br />
        <br />
        This section is deliberately incomplete rather than vague. You have a right to know how
        long a recording of your voice is kept, and we will not state a period we are not yet
        able to honour.
      </>
    ),
  },
  {
    heading: "Your choices",
    body: (
      <>
        <b>To stop receiving messages</b>, reply <b>STOP</b> to any text or WhatsApp message, or
        tell the assistant on a call that you do not wish to be contacted. We will stop.
        <br />
        <br />
        <b>To access, correct, or delete</b> the personal information we hold about you — including
        any call recordings — contact us using the details below. You may also withdraw your
        consent at any time.
      </>
    ),
  },
  {
    heading: "Contact us",
    body: (
      <>
        {PLACEHOLDER}
        <br />
        <br />
        Privacy contact: {PLACEHOLDER}
        <br />
        Mailing address: {PLACEHOLDER}
        <br />
        Email: {PLACEHOLDER}
        <br />
        <br />
        If you are not satisfied with our response, you may contact the Office of the Privacy
        Commissioner of Canada at <b>priv.gc.ca</b>.
      </>
    ),
  },
];

export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <Link href="/" className="brand" style={{ padding: 0 }}>
          realty<em>AI</em>
        </Link>
      </header>

      <main style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 className="page-title">Privacy notice</h1>
        <p className="page-sub">How your information is handled when you contact us.</p>

        <div
          style={{
            border: "1px solid #b8912f",
            background: "rgba(184,145,47,.08)",
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 13.5,
            lineHeight: 1.6,
            margin: "20px 0 8px",
          }}
        >
          <b>Draft — not yet published.</b> Sections marked {PLACEHOLDER} must be completed by
          the brokerage and reviewed by a lawyer before this is linked from a live lead form.
        </div>

        {sections.map((s) => (
          <section key={s.heading} style={{ marginTop: 34 }}>
            <h2 style={{ fontSize: 19, margin: "0 0 10px" }}>{s.heading}</h2>
            <div style={{ fontSize: 15, lineHeight: 1.75, color: "var(--ink)" }}>{s.body}</div>
          </section>
        ))}

        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 44 }}>
          Last updated: {PLACEHOLDER}
        </p>
      </main>
    </div>
  );
}
