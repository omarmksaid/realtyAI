"use client";
import { useState } from "react";

const voices = [
  { id: "v1", name: "Hope", labels: "Canadian accent · warm · mid 30s", pick: true },
  { id: "v2", name: "Archer", labels: "Neutral NA · calm · low register" },
  { id: "v3", name: "Maya", labels: "Slight Indian accent · friendly" },
  { id: "v4", name: "Daniel", labels: "British · measured · professional" },
];

export default function Settings() {
  const [selected, setSelected] = useState("v1");
  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Channel identity for this workspace.</p>

      <div className="card card-pad">
        <p className="section-label">Calling voice</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          The voice leads hear on after-hours calls. Previews read your actual first message.
          {/* Live: GET /assistant/voices (ElevenLabs library) -> POST /assistant/companies/:id/voice */}
        </p>
        {voices.map((v) => (
          <div className="doc-row" key={v.id}>
            <span>
              <b>{v.name}</b>
              <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{v.labels}</span>
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ padding: "5px 12px", fontSize: 13 }}>Preview</button>
              <button
                className={`btn ${selected === v.id ? "btn-primary" : ""}`}
                style={{ padding: "5px 12px", fontSize: 13 }}
                onClick={() => setSelected(v.id)}>
                {selected === v.id ? "Selected" : "Use"}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="card card-pad">
        <p className="section-label">Team &amp; on-call</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          On-call members get a text the moment a lead asks for a person.
        </p>
        {[
          { name: "you@northgate.ca", role: "Owner", phone: "+1 (647) 555-0102", onCall: true },
          { name: "sam@northgate.ca", role: "Agent", phone: "+1 (416) 555-0177", onCall: false },
          { name: "dana@northgate.ca", role: "Agent", phone: "— no phone", onCall: false, pending: false },
        ].map((m) => (
          <div className="doc-row" key={m.name}>
            <span><b>{m.name}</b><span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{m.role} · {m.phone}</span></span>
            <span className={`chip ${m.onCall ? "chip-ai" : "chip-lang"}`} style={{ cursor: "pointer" }}>
              {m.onCall ? "On call" : "Off"}
            </span>
          </div>
        ))}
        <div className="doc-row">
          <span style={{ color: "var(--muted)" }}>marc@northgate.ca <span style={{ fontSize: 13 }}>· invite sent, expires in 6 days</span></span>
          <span className="chip chip-warm">Pending</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <input placeholder="teammate@northgate.ca" style={{ flex: 1 }} />
          <button className="btn btn-primary">Send invite</button>
        </div>
      </div>

      <div className="card card-pad">
        <p className="section-label">WhatsApp sender</p>
        <div className="doc-row"><span>Number</span><span>+1 (416) 555-0138</span></div>
        <div className="doc-row"><span>Display name</span><span>Northgate Realty</span></div>
        <div className="doc-row"><span>Quality rating</span><span className="chip chip-ai">High</span></div>
      </div>
    </>
  );
}
