import { demoRules } from "@/lib/data";
import Coverage from "./coverage";

export default function Playbooks() {
  return (
    <>
      <h1 className="page-title">Playbooks</h1>
      <p className="page-sub">When the AI reaches out, on which channels, and what it&apos;s allowed to say.</p>

      <Coverage />

      <div className="card card-pad">
        <p className="section-label">After-hours routing</p>
        {demoRules.map((r) => (
          <div className="doc-row" key={r.id}>
            <span>
              <b>{r.label}</b>
              <span style={{ color: "var(--muted)", marginLeft: 10 }}>{r.window}</span>
            </span>
            <span>
              {r.channels.map((c) => (
                <span key={c} className="chip chip-lang" style={{ marginLeft: 6 }}>{c}</span>
              ))}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <button className="btn">Add rule</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          During business hours (weekdays 9–5) nothing is automated — leads go straight to your team.
        </p>
      </div>

      <div className="card card-pad">
        <p className="section-label">Conversation prompt — The Riv (WhatsApp) · v4</p>
        <textarea rows={7} defaultValue={`You represent Northgate Realty for The Riv in Vaughan. Tone: warm, unhurried, never salesy.
Answer questions using PROJECT KNOWLEDGE only. Lead with the July deposit incentive if pricing comes up.
If the lead is comparing projects, ask what matters most to them (commute, deposit, occupancy).
Always offer to book a morning call with the team; collect their preferred time.
Reply in the lead's language.`} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary">Save as v5</button>
          <button className="btn">Test in sandbox</button>
          <button className="btn btn-quiet">Version history</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          Safety rails (no invented pricing, handoff and opt-out behavior) are enforced in code and can&apos;t be edited away here.
        </p>
      </div>
    </>
  );
}
