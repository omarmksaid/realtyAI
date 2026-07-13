"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { demoDigest, demoLeads, demoStats, isDemo } from "@/lib/data";
import type { LeadRow } from "@/lib/data";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase";

function Md({ text }: { text: string }) {
  // Convert markdown to HTML-like rendering
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Horizontal rules
    if (/^---+$/.test(line)) {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--line)", margin: "16px 0" }} />);
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} style={{ fontSize: 15, fontWeight: 600, margin: "14px 0 6px", color: "var(--ink)" }}>{renderInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h3 key={i} style={{ fontSize: 17, fontWeight: 600, margin: "18px 0 8px", fontFamily: '"Source Serif 4", Georgia, serif', color: "var(--accent-deep)" }}>{renderInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(<h2 key={i} style={{ fontSize: 20, fontWeight: 600, margin: "20px 0 10px", fontFamily: '"Source Serif 4", Georgia, serif' }}>{renderInline(line.slice(2))}</h2>);
      continue;
    }

    // List items
    if (/^\d+\.\s/.test(line)) {
      elements.push(<p key={i} style={{ margin: "6px 0", paddingLeft: 8 }}>{renderInline(line)}</p>);
      continue;
    }
    if (line.startsWith("- ")) {
      elements.push(<p key={i} style={{ margin: "4px 0", paddingLeft: 12 }}>• {renderInline(line.slice(2))}</p>);
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} style={{ margin: "8px 0" }}>{renderInline(line)}</p>);
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode[] {
  // Handle **bold**, *italic*, and emoji
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export default function Today() {
  const emptyStats = { newLeads: 0, engaged: 0, engagementRate: "0%", handoffs: 0 };
  const emptyDigest = { date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), body: ["No overnight briefing yet. Briefings are generated at 8:30 AM after your first leads arrive."] };

  const [stats, setStats] = useState(isDemo ? demoStats : emptyStats);
  const [digest, setDigest] = useState(isDemo ? demoDigest : emptyDigest);
  const [hot, setHot] = useState<LeadRow[]>(isDemo ? demoLeads.filter((l) => l.score === "hot") : []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    if (isDemo) return;

    async function load() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Fetch stats directly from Supabase
        const { getCompanyId } = await import("@/lib/api");
        const companyId = await getCompanyId();
        if (!companyId) return;

        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: recentLeads } = await supabase
          .from("leads")
          .select("id, status")
          .eq("company_id", companyId)
          .gte("created_at", since);

        if (recentLeads) {
          const newLeads = recentLeads.length;
          const engaged = recentLeads.filter(l => ["engaged", "qualified", "handed_off"].includes(l.status)).length;
          const handoffs = recentLeads.filter(l => l.status === "handed_off").length;
          setStats({ newLeads, engaged, engagementRate: newLeads ? `${Math.round(engaged / newLeads * 100)}%` : "0%", handoffs });
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

        // Fetch leads that need attention: hot scored, engaged, or handed off
        const { data: hotLeads } = await supabase
          .from("leads")
          .select("*, projects(name)")
          .eq("company_id", companyId)
          .in("status", ["engaged", "handed_off", "qualified"])
          .gte("created_at", since)
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
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", color: "var(--muted)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <p>Loading your briefing...</p>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Good morning</h1>
      <p className="page-sub">Here&#39;s what happened while you were out.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1 }}>{stats.newLeads}</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>new leads overnight</div>
        </div>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1 }}>{stats.engaged}</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>engaged in conversation</div>
        </div>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: '"Source Serif 4", Georgia, serif', lineHeight: 1 }}>{stats.handoffs}</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>flagged for your team</div>
        </div>
      </div>

      <div className="memo">
        <div className="memo-head">
          <h2>Overnight briefing</h2>
          <time>{digest.date} · written at 8:30 AM</time>
        </div>
        {digest.body.map((p, i) => <Md key={i} text={p} />)}
      </div>

      {hot.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <p className="section-label">Call these first</p>
          </div>
          <table>
            <tbody>
              {hot.map((l) => (
                <tr key={l.id} className="rowlink" style={{ cursor: "pointer" }}>
                  <td style={{ width: 180 }}>
                    <Link href={`/conversations/${l.id}`}><b>{l.name}</b></Link>
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{l.project}</div>
                  </td>
                  <td>
                    <span className={`chip ${l.score === "hot" ? "chip-hot" : "chip-warm"}`} style={{ textTransform: "capitalize" }}>{l.score}</span>
                    {l.scoreReason && <span className="chip-reason">{l.scoreReason}</span>}
                  </td>
                  <td style={{ width: 130, textAlign: "right" }}>
                    <span className="chip chip-lang">{l.langLabel}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
