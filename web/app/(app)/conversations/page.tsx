"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { isDemo } from "@/lib/data";

interface SearchResult {
  id: string; lead: string; project: string; channel: string; role: string;
  snippet: string; at: string; recording: boolean;
}

const demoResults: SearchResult[] = [
  { id: "l1", lead: "Reza Karimi", project: "The Riv — Vaughan", channel: "call", role: "lead",
    snippet: "…is the 5% <<deposit>> still available for the July allocation? I'm comparing with…", at: "Jun 28, 7:31 PM", recording: true },
  { id: "l1", lead: "Reza Karimi", project: "The Riv — Vaughan", channel: "whatsapp", role: "lead",
    snippet: "…how does the <<deposit>> structure work? Is the 5% still…", at: "Jun 21, 11:49 PM", recording: false },
  { id: "l2", lead: "Priya Sharma", project: "Union East — Scarborough", channel: "whatsapp", role: "ai",
    snippet: "…the <<deposit>> schedule is 5% in 30 days and 5% in 180 days, and assignment is…", at: "Jun 21, 11:24 PM", recording: false },
];

function highlightSnippet(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<<$1>>");
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/<<|>>/);
  return <span>{parts.map((p, i) => i % 2 ? <mark key={i} style={{ background: "var(--warm-wash, #f7f1e2)", padding: "0 2px", borderRadius: 3 }}>{p}</mark> : p)}</span>;
}

export default function Conversations() {
  const [q, setQ] = useState(isDemo ? "deposit" : "");
  const [results, setResults] = useState<SearchResult[]>(isDemo ? demoResults : []);
  const [searching, setSearching] = useState(false);

  async function doSearch() {
    if (isDemo) return;
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    try {
      const companyId = await getCompanyId();
      if (!companyId) { setSearching(false); return; }
      const supabase = createClient();

      // Direct text search on messages using the generated tsvector column
      // Convert search terms to tsquery format using OR for broader matching
      // "pricings setup" -> "pricings | setup" (matches either word)
      const tsQuery = query.split(/\s+/).filter(Boolean).join(" | ");
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, direction, role, created_at, conversations!inner(channel, lead_id, leads!inner(full_name, projects(name)))")
        .eq("company_id", companyId)
        .textSearch("search", tsQuery)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Search error:", error);
        setResults([]);
        setSearching(false);
        return;
      }
      if (!data || data.length === 0) {
        setResults([]);
        setSearching(false);
        return;
      }
      setResults(
        data.map((r: any) => ({
          id: r.conversations?.lead_id || r.id,
          lead: r.conversations?.leads?.full_name || "Unknown",
          project: r.conversations?.leads?.projects?.name || "",
          channel: r.conversations?.channel || "whatsapp",
          role: r.direction === "outbound" ? "ai" : "lead",
          snippet: highlightSnippet(r.content || "", query),
          at: r.created_at
            ? new Date(r.created_at).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
              })
            : "",
          // The voice adapter registers as "voice"; "call" was never a real channel value.
          recording: r.conversations?.channel === "voice",
        }))
      );
    } catch (e) {
      console.error("Search failed:", e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Conversations</h1>
      <p className="page-sub">Search every word said on every channel — WhatsApp, calls, and email.</p>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }}
          placeholder='Search transcripts… try "parking cost" or deposit -email'
          onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        <button className="btn btn-primary" onClick={doSearch} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      <div className="card">
        {results.map((r, i) => (
          <Link key={i} href={`/conversations/${r.id}`} style={{ display: "block", padding: "14px 22px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span><b>{r.lead}</b> <span style={{ color: "var(--muted)", fontSize: 13 }}>· {r.project}</span></span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* "call" was never a real channel value — the voice adapter emits "voice",
                    so a phone call used to fall through and get labelled "Email". */}
                <span className="chip chip-lang">
                  {r.channel === "voice" ? "📞 Phone call" : r.channel === "whatsapp" ? "💬 WhatsApp" : "✉️ Email"}
                </span>
                {r.recording && <span className="chip chip-ai">▶ Recording</span>}
                <span style={{ color: "var(--muted)", fontSize: 13 }}>{r.at}</span>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>
              <span style={{ fontSize: 12.5 }}>{r.role === "lead" ? "Lead said: " : "AI said: "}</span>
              <Snippet text={r.snippet} />
            </div>
          </Link>
        ))}
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "12px 22px" }}>
          Results link into the full transcript at the matching turn. Call results include the audio player.
        </p>
      </div>
    </>
  );
}
