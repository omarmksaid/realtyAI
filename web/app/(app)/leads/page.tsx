"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { isDemo, demoLeads, type LeadRow, type Score } from "@/lib/data";

const scoreChip = { hot: "chip-hot", warm: "chip-warm", cold: "chip-cold" } as const;
const scoreWord = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

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
  const receivedAt = created ? timeAgo(created) : "";
  return {
    id: r.id,
    name: r.full_name || r.name || "Unknown",
    phone: r.phone || "",
    email: r.email || "",
    project: r.projects?.name || "",
    source: r.provider === "google" ? "google" : "meta",
    status: r.status || "new",
    channel: r.channel || "whatsapp",
    language: lang,
    langLabel: langLabels[lang] || lang,
    score,
    scoreReason: r.score_reason || "",
    receivedAt,
    receivedRaw: r.created_at || "",
  };
}

export default function Leads() {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadRow[]>(isDemo ? demoLeads : []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const companyId = await getCompanyId();
        if (!companyId) { setLoading(false); return; }
        const supabase = createClient();
        const { data, error } = await supabase
          .from("leads")
          .select("*, projects(name)")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error || !data) { setLoading(false); return; }
        if (!cancelled) setLeads(data.map(mapRow));
      } catch {
        // Keep empty state on error
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
        ) : leads.length === 0 ? (
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>No leads yet. They&apos;ll appear here as they come in from your ad campaigns.</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th>Lead</th><th>Project</th><th>Score</th><th>Status</th><th>Language</th><th>Source</th><th>Received</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="rowlink" onClick={() => router.push(`/conversations/${l.id}`)} style={{ cursor: "pointer" }}>
                <td>
                  <b>{l.name}</b>
                  {(l.phone || l.email) && (
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{[l.phone, l.email].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td>{l.project}</td>
                <td>
                  <span className={`chip ${scoreChip[l.score]}`}>{scoreWord[l.score]}</span>
                </td>
                <td style={{ textTransform: "capitalize" }}>{l.status.replace("_", " ")}</td>
                <td><span className="chip chip-lang">{l.langLabel}</span></td>
                <td style={{ textTransform: "capitalize", color: "var(--muted)" }}>{l.source}</td>
                <td style={{ color: "var(--muted)" }} title={l.receivedRaw ? new Date(l.receivedRaw).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : ""}>{l.receivedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </>
  );
}
