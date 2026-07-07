"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import { getCompanyId } from "../../lib/api";
import { isDemo, demoLeads, type LeadRow, type Score } from "../../lib/data";

const scoreChip = { hot: "chip-hot", warm: "chip-warm", cold: "chip-cold" } as const;
const scoreWord = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

function mapRow(r: any): LeadRow {
  const score: Score = r.score === "hot" || r.score === "warm" || r.score === "cold" ? r.score : "cold";
  const lang = r.detected_language || "en";
  const langLabels: Record<string, string> = {
    en: "English", fa: "\u0641\u0627\u0631\u0633\u06CC \u00B7 Farsi", zh: "\u4E2D\u6587 \u00B7 Mandarin",
    pa: "\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40 \u00B7 Punjabi", ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u00B7 Arabic",
    hi: "\u0939\u093F\u0928\u094D\u0926\u0940 \u00B7 Hindi", es: "Espa\u00F1ol \u00B7 Spanish",
    fr: "Fran\u00E7ais \u00B7 French",
  };
  const created = r.created_at ? new Date(r.created_at) : null;
  const receivedAt = created
    ? created.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : "";
  return {
    id: r.id,
    name: r.name || "Unknown",
    project: r.projects?.name || "",
    source: r.source === "google" ? "google" : "meta",
    status: r.status || "new",
    channel: r.channel || "whatsapp",
    language: lang,
    langLabel: langLabels[lang] || lang,
    score,
    scoreReason: r.score_reason || "",
    receivedAt,
  };
}

export default function Leads() {
  const [leads, setLeads] = useState<LeadRow[]>(isDemo ? demoLeads : []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const companyId = await getCompanyId();
        if (!companyId) { setLeads(demoLeads); setLoading(false); return; }
        const supabase = createClient();
        const { data, error } = await supabase
          .from("leads")
          .select("*, projects(name)")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error || !data) { setLeads(demoLeads); setLoading(false); return; }
        if (!cancelled) setLeads(data.map(mapRow));
      } catch {
        if (!cancelled) setLeads(demoLeads);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <h1 className="page-title">Leads</h1>
      <p className="page-sub">Everything that came in, business hours and after.</p>
      <div className="card">
        {loading ? (
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>Loading leads...</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>Lead</th><th>Project</th><th>Score</th><th>Status</th><th>Language</th><th>Source</th><th>Received</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
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
        )}
      </div>
    </>
  );
}
