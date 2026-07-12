"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { isDemo, demoLeads, type LeadRow, type Score } from "@/lib/data";

const scoreChip = { hot: "chip-hot", warm: "chip-warm", cold: "chip-cold" } as const;

/** leads.provider verbatim, made presentable. Unrecognised providers show as themselves
 *  rather than being silently relabelled Meta. */
const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta", facebook: "Meta", instagram: "Meta",
  google: "Google", test: "Test", unknown: "—",
};
const sourceLabel = (s: string) =>
  SOURCE_LABELS[s?.toLowerCase()] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");

/** "handed_off" covers two different things: a human took the chat over, and the AI booked
 *  a callback that a human now owes. Both need follow-up, so say so in plain words. */
const statusLabel = (s: string) =>
  s === "handed_off" ? "Needs follow-up" : s.replace(/_/g, " ");
const scoreWord = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

const PAGE_SIZE = 20;

type SortKey = "name" | "project" | "score" | "status" | "source" | "receivedRaw";
type SortDir = "asc" | "desc";

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
  // An unscored lead is not a cold lead. This used to fall back to "cold", so a lead who
  // booked a callback showed as cold simply because scoring hadn't run yet.
  const score: Score | null =
    r.score === "hot" || r.score === "warm" || r.score === "cold" ? r.score : null;
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
    source: r.provider || "unknown", // real provider — not everything is Meta
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
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("receivedRaw");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

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
          .limit(200);
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter((l) => l.name.toLowerCase().includes(q));
  }, [leads, search]);

  const sorted = useMemo(() => {
    const scoreOrder: Record<Score, number> = { hot: 3, warm: 2, cold: 1 };
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "project":
          cmp = a.project.localeCompare(b.project);
          break;
        case "score":
          // Unscored leads sort below every scored one rather than ranking as cold.
          cmp = (a.score ? scoreOrder[a.score] : -1) - (b.score ? scoreOrder[b.score] : -1);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "source":
          cmp = a.source.localeCompare(b.source);
          break;
        case "receivedRaw":
          cmp = (a.receivedRaw || "").localeCompare(b.receivedRaw || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageLeads = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 when search changes
  useEffect(() => { setPage(1); }, [search]);

  const thStyle: React.CSSProperties = { cursor: "pointer", userSelect: "none" };

  return (
    <>
      <h1 className="page-title">Leads</h1>
      <p className="page-sub">Everything that came in, business hours and after.</p>

      {/* Search + Pagination controls */}
      {!loading && leads.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "7px 12px",
              border: "1px solid var(--border, #ddd)",
              borderRadius: 6,
              fontSize: 14,
              width: 240,
              background: "var(--surface, #fff)",
              color: "var(--fg, #222)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--muted)" }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              style={{
                padding: "4px 10px",
                border: "1px solid var(--border, #ddd)",
                borderRadius: 5,
                background: "var(--surface, #fff)",
                cursor: safePage <= 1 ? "default" : "pointer",
                opacity: safePage <= 1 ? 0.4 : 1,
                fontSize: 14,
              }}
            >
              &larr;
            </button>
            <span>Page {safePage} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              style={{
                padding: "4px 10px",
                border: "1px solid var(--border, #ddd)",
                borderRadius: 5,
                background: "var(--surface, #fff)",
                cursor: safePage >= totalPages ? "default" : "pointer",
                opacity: safePage >= totalPages ? 0.4 : 1,
                fontSize: 14,
              }}
            >
              &rarr;
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>Loading leads...</p>
        ) : leads.length === 0 ? (
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>No leads yet. They&apos;ll appear here as they come in from your ad campaigns.</p>
        ) : sorted.length === 0 ? (
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>No leads match &ldquo;{search}&rdquo;.</p>
        ) : (
        <table>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => toggleSort("name")}>Lead{sortIndicator("name")}</th>
              <th style={thStyle} onClick={() => toggleSort("project")}>Project{sortIndicator("project")}</th>
              <th style={thStyle} onClick={() => toggleSort("score")}>Score{sortIndicator("score")}</th>
              <th style={thStyle} onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
              <th>Language</th>
              <th style={thStyle} onClick={() => toggleSort("source")}>Source{sortIndicator("source")}</th>
              <th style={thStyle} onClick={() => toggleSort("receivedRaw")}>Received{sortIndicator("receivedRaw")}</th>
            </tr>
          </thead>
          <tbody>
            {pageLeads.map((l) => (
              <tr key={l.id} className="rowlink" onClick={() => router.push(`/conversations/${l.id}`)} style={{ cursor: "pointer" }}>
                <td>
                  <b>{l.name}</b>
                  {(l.phone || l.email) && (
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{[l.phone, l.email].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td>{l.project}</td>
                <td>
                  {/* Blank until the conversation ends and scoring runs — an unscored lead
                      is not a cold lead. */}
                  {l.score ? (
                    <span className={`chip ${scoreChip[l.score]}`} title={l.scoreReason}>{scoreWord[l.score]}</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }} title="Scored once the conversation ends">—</span>
                  )}
                </td>
                <td style={{ textTransform: "capitalize" }}>{statusLabel(l.status)}</td>
                <td><span className="chip chip-lang">{l.langLabel}</span></td>
                <td style={{ color: "var(--muted)" }}>{sourceLabel(l.source)}</td>
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
