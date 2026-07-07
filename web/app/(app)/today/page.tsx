import Link from "next/link";
import { demoDigest, demoLeads, demoStats } from "@/lib/data";

function Md({ text }: { text: string }) {
  // minimal **bold** rendering for the memo
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p>
      {parts.map((p, i) =>
        p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p
      )}
    </p>
  );
}

export default function Today() {
  const hot = demoLeads.filter((l) => l.score === "hot");
  return (
    <>
      <h1 className="page-title">Good morning</h1>
      <p className="page-sub">Here’s what happened while you were out.</p>

      <div className="grid-3" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card stat"><b>{demoStats.newLeads}</b><span>new leads overnight</span></div>
        <div className="card stat"><b>{demoStats.engaged}</b><span>engaged in conversation</span></div>
        <div className="card stat"><b>{demoStats.handoffs}</b><span>flagged for your team</span></div>
        <div className="card stat"><b>$247</b><span>spend this month · ~$0.41/lead</span></div>
      </div>

      <div className="memo">
        <div className="memo-head">
          <h2>Overnight briefing</h2>
          <time>{demoDigest.date} · written at 8:30 AM</time>
        </div>
        {demoDigest.body.map((p, i) => <Md key={i} text={p} />)}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <p className="section-label">Call these first</p>
        </div>
        <table>
          <tbody>
            {hot.map((l) => (
              <tr key={l.id} className="rowlink">
                <td style={{ width: 180 }}>
                  <Link href={`/conversations/${l.id}`}><b>{l.name}</b></Link>
                  <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{l.project}</div>
                </td>
                <td>
                  <span className="chip chip-hot">Hot</span>
                  <span className="chip-reason">{l.scoreReason}</span>
                </td>
                <td style={{ width: 130, textAlign: "right" }}>
                  <span className="chip chip-lang">{l.langLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
