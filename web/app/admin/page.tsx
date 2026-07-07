"use client";
import { useState } from "react";

const planChip: Record<string, string> = { trial: "chip-warm", pilot: "chip-ai", standard: "chip-ai", custom: "chip-lang" };
const statusChip: Record<string, string> = { trial: "chip-warm", active: "chip-ai", past_due: "chip-hot", cancelled: "chip-lang" };

const seed = [
  { id: "c1", name: "Northgate Realty", plan: "pilot", price: 750, status: "active", leads: 812, engaged: 486, spend: 247.3, members: 5, joined: "May 2026", last: "12m ago" },
  { id: "c2", name: "Lakeshore Group", plan: "trial", price: 0, status: "trial", leads: 96, engaged: 51, spend: 31.2, members: 2, joined: "Jun 2026", last: "3h ago", trialEnds: "9 days left" },
  { id: "c3", name: "Summit Homes GTA", plan: "standard", price: 1200, status: "past_due", leads: 1140, engaged: 590, spend: 402.8, members: 8, joined: "Mar 2026", last: "41m ago" },
];

export default function Admin() {
  const [rows, setRows] = useState(seed);
  const totals = {
    mrr: rows.filter(r => r.status === "active").reduce((a, r) => a + r.price, 0),
    spend: rows.reduce((a, r) => a + r.spend, 0),
    leads: rows.reduce((a, r) => a + r.leads, 0),
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 className="page-title">Platform admin</h1>
        <span className="chip chip-human">Operator</span>
      </div>
      <p className="page-sub">Every workspace, its usage, and its plan. Visible only to platform admins.</p>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><b>${totals.mrr.toLocaleString()}</b><span>MRR (active plans)</span></div>
        <div className="card stat"><b>${totals.spend.toFixed(0)}</b><span>operating spend · MTD</span></div>
        <div className="card stat"><b>{totals.leads.toLocaleString()}</b><span>leads · 30 days, all companies</span></div>
      </div>

      <div className="card">
        <table>
          <thead><tr>
            <th>Company</th><th>Plan</th><th>Status</th><th>Leads 30d</th><th>Spend MTD</th><th>Margin</th><th>Team</th><th>Last lead</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b><div style={{ color: "var(--muted)", fontSize: 12.5 }}>since {r.joined}</div></td>
                <td>
                  <select value={r.plan}
                    onChange={(e) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, plan: e.target.value } : x))}>
                    {/* Live: PATCH /admin/companies/:id/billing */}
                    <option value="trial">Trial</option><option value="pilot">Pilot $750</option>
                    <option value="standard">Standard $1,200</option><option value="custom">Custom</option>
                  </select>
                  {r.trialEnds && <div style={{ fontSize: 12, color: "#b8912f", marginTop: 4 }}>{r.trialEnds}</div>}
                </td>
                <td><span className={`chip ${statusChip[r.status]}`} style={{ textTransform: "capitalize" }}>{r.status.replace("_", " ")}</span></td>
                <td>{r.leads.toLocaleString()}<div style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(r.engaged / r.leads * 100)}% engaged</div></td>
                <td>${r.spend.toFixed(2)}</td>
                <td style={{ color: r.price - r.spend > 0 ? "var(--accent-deep)" : "#c2703d", fontWeight: 600 }}>
                  {r.price ? `$${(r.price - r.spend).toFixed(0)}` : "—"}
                </td>
                <td>{r.members}</td>
                <td style={{ color: "var(--muted)" }}>{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "12px 22px" }}>
          Spend is recorded per event from real provider usage. Margin = plan price − spend, before your time.
          Payment collection (Stripe) not yet wired — status is managed manually here.
        </p>
      </div>
    </div>
  );
}
