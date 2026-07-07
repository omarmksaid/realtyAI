"use client";
import { useState } from "react";
import { demoConversation } from "@/lib/data";

export default function Conversation() {
  const { lead } = demoConversation;
  const [mode, setMode] = useState<"ai" | "human">(demoConversation.status);
  const [turns, setTurns] = useState(demoConversation.turns);
  const [draft, setDraft] = useState("");

  function takeOver() {
    // Live: POST `${API_URL}/agent/conversations/${id}/takeover` — pauses the AI worker
    setMode("human");
    setTurns((t) => [...t, {
      id: `sys-${Date.now()}`, role: "system",
      text: `You took over this conversation · AI paused`, at: "now",
    }]);
  }

  function handBack() {
    setMode("ai");
    setTurns((t) => [...t, { id: `sys-${Date.now()}`, role: "system", text: "Handed back to AI", at: "now" }]);
  }

  function send() {
    if (!draft.trim()) return;
    // Live: POST `${API_URL}/agent/messages` — relayed out the same WhatsApp number
    setTurns((t) => [...t, { id: `a-${Date.now()}`, role: "agent", text: draft.trim(), at: "now" }]);
    setDraft("");
  }

  return (
    <>
      <h1 className="page-title">{lead.name}</h1>
      <p className="page-sub">
        {lead.project} · WhatsApp · <span className="chip chip-lang">{lead.langLabel}</span>
      </p>

      <div className="card card-pad" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px 24px" }}>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Phone</div>
          <a href="tel:+16475550193" style={{ fontWeight: 600, color: "var(--accent-deep)" }}>+1 (647) 555-0193</a>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Email</div>
          <a href="mailto:reza.k@gmail.com" style={{ fontWeight: 600, color: "var(--accent-deep)" }}>reza.k@gmail.com</a>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Source</div>
          <span style={{ fontSize: 14 }}>Meta · &quot;Riv 5% Deposit&quot; campaign</span>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Form answers</div>
          <span style={{ fontSize: 14 }}>Budget: $700–800K · Timeline: 1–3 months</span>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Cost so far</div>
          <span style={{ fontSize: 14 }}>$1.12 <span style={{ color: "var(--muted)" }}>· 1 call, 9 messages</span></span>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Consent</div>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>Form submitted Jun 21, 11:47 PM</span>
        </div>
      </div>

      <div className="card">
        <div className="takeover-bar">
          {mode === "ai" ? (
            <>
              <span><span className="chip chip-ai">AI is handling this conversation</span></span>
              <button className="btn btn-primary" onClick={takeOver}>Take over</button>
            </>
          ) : (
            <>
              <span><span className="chip chip-human">You are handling this conversation</span></span>
              <button className="btn" onClick={handBack}>Hand back to AI</button>
            </>
          )}
        </div>

        <div className="thread">
          {turns.map((t) =>
            t.role === "system" ? (
              <div key={t.id} className="sysline">{t.text}</div>
            ) : (
              <div key={t.id}
                className={`bubble ${t.role === "lead" ? "bubble-lead" : t.role === "agent" ? "bubble-agent" : "bubble-ai"}`}
                dir={t.role !== "agent" && lead.language === "fa" ? "auto" : undefined}>
                {t.text}
                {t.gloss && <span className="gloss">{t.gloss}</span>}
                <time>{t.role === "agent" ? "You" : t.role === "ai" ? "AI" : lead.name.split(" ")[0]} · {t.at}</time>
              </div>
            )
          )}
        </div>

        {mode === "human" && (
          <div className="composer">
            <input
              value={draft}
              placeholder={`Message ${lead.name.split(" ")[0]} — sends from your WhatsApp number`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn btn-primary" onClick={send}>Send</button>
          </div>
        )}
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
        Foreign-language messages show an English gloss so anyone on the team can triage.
        The AI always replies in the lead’s language.
      </p>
    </>
  );
}
