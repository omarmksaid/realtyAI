"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { demoDigest, demoLeads, demoStats, isDemo } from "@/lib/data";
import type { LeadRow } from "@/lib/data";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase";

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
  const emptyStats = { newLeads: 0, engaged: 0, engagementRate: "0%", handoffs: 0 };
  const emptyDigest = { date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), body: ["No overnight briefing yet. Briefings are generated at 8:30 AM after your first leads arrive."] };

  const [stats, setStats] = useState(isDemo ? demoStats : emptyStats);
  const [digest, setDigest] = useState(isDemo ? demoDigest : emptyDigest);
  const [hot, setHot] = useState<LeadRow[]>(isDemo ? demoLeads.filter((l) => l.score === "hot") : []);
  const [spend, setSpend] = useState(isDemo ? "$247" : "$0");
  const [spendPerLead, setSpendPerLead] = useState(isDemo ? "~$0.41/lead" : "");

  useEffect(() => {
    if (isDemo) return;

    async function load() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Fetch company stats from API
        const companyRes = await apiFetch("/agent/company");
        if (companyRes.ok) {
          const company = await companyRes.json();
          if (company.stats) {
            setStats({
              newLeads: company.stats.new_leads ?? 0,
              engaged: company.stats.engaged ?? 0,
              engagementRate: company.stats.engagement_rate ?? "0%",
              handoffs: company.stats.handoffs ?? 0,
            });
          }
          if (company.spend != null) {
            setSpend(`$${company.spend}`);
            const perLead = company.stats?.new_leads
              ? `~$${(company.spend / company.stats.new_leads).toFixed(2)}/lead`
              : "";
            setSpendPerLead(perLead);
          }
        }

        // Fetch today’s digest from Supabase
        const today = new Date().toISOString().slice(0, 10);
        const { data: digestRow } = await supabase
          .from("daily_summaries")
          .select("*")
          .eq("for_date", today)
          .single();

        if (digestRow) {
          setDigest({
            date: digestRow.date_label ?? digest.date,
            body: Array.isArray(digestRow.content) ? digestRow.content : [digestRow.content ?? ""],
          });
        }

        // Fetch hot leads from Supabase
        const { data: hotLeads } = await supabase
          .from("leads")
          .select("*, projects(name)")
          .eq("score", "hot")
          .order("created_at", { ascending: false })
          .limit(10);

        if (hotLeads) {
          setHot(
            hotLeads.map((l: any) => ({
              id: l.id,
              name: l.full_name ?? l.name ?? "Unknown",
              project: l.projects?.name ?? "",
              source: l.provider ?? l.source ?? "unknown",
              status: l.status,
              channel: "",
              language: l.detected_language ?? "en",
              langLabel: l.detected_language ?? "English",
              score: (l.score ?? "warm") as "hot",
              scoreReason: l.score_reason ?? "",
              receivedAt: new Date(l.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
            }))
          );
        }
      } catch {
        // Keep current state on failure
      }
    }
    load();
  }, []);

  return (
    <>
      <h1 className="page-title">Good morning</h1>
      <p className="page-sub">Here&#39;s what happened while you were out.</p>

      <div className="grid-3" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card stat"><b>{stats.newLeads}</b><span>new leads overnight</span></div>
        <div className="card stat"><b>{stats.engaged}</b><span>engaged in conversation</span></div>
        <div className="card stat"><b>{stats.handoffs}</b><span>flagged for your team</span></div>
        <div className="card stat"><b>{spend}</b><span>spend this month · {spendPerLead}</span></div>
      </div>

      <div className="memo">
        <div className="memo-head">
          <h2>Overnight briefing</h2>
          <time>{digest.date} · written at 8:30 AM</time>
        </div>
        {digest.body.map((p, i) => <Md key={i} text={p} />)}
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
