import Link from "next/link";
import { demoLeads } from "@/lib/data";

const scoreChip = { hot: "chip-hot", warm: "chip-warm", cold: "chip-cold" } as const;
const scoreWord = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

export default function Leads() {
  return (
    <>
      <h1 className="page-title">Leads</h1>
      <p className="page-sub">Everything that came in, business hours and after.</p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Lead</th><th>Project</th><th>Score</th><th>Status</th><th>Language</th><th>Source</th><th>Received</th>
            </tr>
          </thead>
          <tbody>
            {demoLeads.map((l) => (
              <tr key={l.id} className="rowlink">
                <td>
                  <Link href={`/conversations/${l.id}`}><b>{l.name}</b></Link>
                  <div style={{ color: "var(--muted)", fontSize: 12.5 }}>+1 647 555-01{l.id.slice(-1)}3 · {l.name.split(" ")[0].toLowerCase()}@gmail.com</div>
                </td>
                <td>{l.project}</td>
                <td>
                  <span className={`chip ${scoreChip[l.score]}`}>{scoreWord[l.score]}</span>
                </td>
                <td style={{ textTransform: "capitalize" }}>{l.status}</td>
                <td><span className="chip chip-lang">{l.langLabel}</span></td>
                <td style={{ textTransform: "capitalize", color: "var(--muted)" }}>{l.source}</td>
                <td style={{ color: "var(--muted)" }}>{l.receivedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
