import Link from "next/link";

const features = [
  {
    title: "Answers in seconds, any hour",
    body: "The moment a lead clicks your ad at 11pm, realtyAI reaches out — a WhatsApp message, an AI phone call, an email — following rules you set. In their language, with your project's real pricing and floor plans, never inventing a number.",
  },
  {
    title: "Your team, one tap away",
    body: "Every conversation shows a live transcript. Tap \u201CTake over\u201D and you're typing in the same thread, from the same number — the lead never notices the handoff. Hot leads can text your on-call agent instantly.",
  },
  {
    title: "The morning briefing",
    body: "Walk in at 8:30 to a written briefing: who came in overnight, what they asked, who's ready to buy, and who to call first — with every word of every conversation searchable.",
  },
];

export default function Landing() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 48px", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
        <span className="brand" style={{ padding: 0 }}>realty<em>AI</em></span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" className="btn btn-quiet" style={{ fontWeight: 600 }}>Log in</Link>
          <Link href="/signup" className="btn btn-primary">Sign up</Link>
        </span>
      </header>

      <main style={{ flex: 1 }}>
        <section style={{ maxWidth: 820, margin: "0 auto", padding: "96px 24px 72px", textAlign: "center" }}>
          <h1 style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 52, fontWeight: 600, margin: 0, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            Every lead answered.<br />Even at 2am.
          </h1>
          <p style={{ fontSize: 19, color: "var(--muted)", margin: "24px auto 36px", maxWidth: 620, lineHeight: 1.6 }}>
            Leads from your Meta and Google ads don&apos;t wait for morning. realtyAI responds
            for your brokerage the moment they click — after hours, on weekends — and hands
            your team a briefing and the hot list by 8:30.
          </p>
          <span style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Link href="/signup" className="btn btn-primary" style={{ padding: "12px 26px", fontSize: 16 }}>Get started</Link>
            <Link href="/login" className="btn" style={{ padding: "12px 26px", fontSize: 16 }}>Log in</Link>
          </span>
          <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 28 }}>
            Speed-to-lead is the whole game: contact within the first hour, and a lead is many times more likely to convert.
          </p>
        </section>

        <section style={{ background: "var(--surface)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "64px 24px" }}>
          <div style={{ maxWidth: 1060, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {features.map((f) => (
              <div key={f.title} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "26px 26px" }}>
                <h3 style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 20, fontWeight: 600, margin: "0 0 10px", color: "var(--accent-deep)" }}>{f.title}</h3>
                <p style={{ margin: 0, color: "var(--ink)", fontSize: 15, lineHeight: 1.65 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.7, margin: 0 }}>
            Multilingual conversations with English glosses · full call recordings and searchable transcripts ·
            your prompts, your hours, your voice — every workspace fully isolated.
          </p>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--line)", padding: "20px 48px", display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 13.5 }}>
        <span>realtyAI</span>
        <span>Built for real estate brokerages · Toronto</span>
      </footer>
    </div>
  );
}
