"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getCompanyId, apiFetch } from "@/lib/api";
import { isDemo, demoConversation, type LeadRow, type Turn, type Score } from "@/lib/data";

const langLabels: Record<string, string> = {
  en: "English", fa: "\u0641\u0627\u0631\u0633\u06CC \u00B7 Farsi", zh: "\u4E2D\u6587 \u00B7 Mandarin",
  pa: "\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40 \u00B7 Punjabi", ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u00B7 Arabic",
  hi: "\u0939\u093F\u0928\u094D\u0926\u0940 \u00B7 Hindi", es: "Espa\u00F1ol \u00B7 Spanish",
  fr: "Fran\u00E7ais \u00B7 French",
};

interface CallRow {
  id: string;
  recording_url: string | null;
  duration_sec: number | null;
  outcome: string | null;
  created_at: string | null;
}

function formatDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function mapLead(r: any): LeadRow {
  const lang = r.detected_language || "en";
  const score: Score = r.score === "hot" || r.score === "warm" || r.score === "cold" ? r.score : "cold";
  return {
    id: r.id,
    name: r.full_name || r.name || "Unknown",
    project: r.projects?.name || r.project_name || "",
    source: r.provider === "google" ? "google" : "meta",
    status: r.status || "new",
    channel: r.channel || "whatsapp",
    language: lang,
    langLabel: langLabels[lang] || lang,
    score,
    scoreReason: r.score_reason || "",
    receivedAt: r.created_at
      ? new Date(r.created_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : "",
  };
}

function mapTurn(m: any): Turn {
  let role: Turn["role"] = "ai";
  if (m.direction === "inbound") role = "lead";
  else if (m.sender_type === "agent" || m.sender_type === "human") role = "agent";
  else if (m.sender_type === "system") role = "system";

  return {
    id: m.id,
    role,
    text: m.content || m.body || m.text || "",
    gloss: m.gloss || undefined,
    at: m.created_at
      ? new Date(m.created_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : "",
  };
}

export default function Conversation() {
  const params = useParams();
  const id = params?.id as string;

  const [lead, setLead] = useState<LeadRow>(isDemo ? demoConversation.lead : { id: "", name: "", project: "", source: "meta", status: "new", channel: "whatsapp", language: "en", langLabel: "English", score: "cold", scoreReason: "", receivedAt: "" });
  const [mode, setMode] = useState<"ai" | "human">(isDemo ? demoConversation.status : "ai");
  const [turns, setTurns] = useState<Turn[]>(isDemo ? demoConversation.turns : []);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(!isDemo);
  const [convId, setConvId] = useState<string | null>(null);
  const [leadRaw, setLeadRaw] = useState<any>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      try {
        const companyId = await getCompanyId();
        if (!companyId) { setLoading(false); return; }

        // Fetch lead
        const { data: leadData } = await supabase
          .from("leads")
          .select("*, projects(name)")
          .eq("id", id)
          .single();

        if (leadData && !cancelled) {
          setLead(mapLead(leadData));
          setLeadRaw(leadData);
        }

        // Fetch all conversations for this lead
        const { data: convos } = await supabase
          .from("conversations")
          .select("id, status, channel")
          .eq("lead_id", id);

        if (convos && convos.length > 0) {
          // Prefer whatsapp conversation, fall back to first
          const convData = convos.find(c => c.channel === "whatsapp") ?? convos[0];
          if (!cancelled) {
            setConvId(convData.id);
            setMode(convData.status === "handed_off" ? "human" : "ai");
          }

          // Fetch messages from ALL conversations for this lead
          const allConvIds = convos.map(c => c.id);
          const [{ data: msgs }, { data: callRows }] = await Promise.all([
            supabase
              .from("messages")
              .select("*")
              .in("conversation_id", allConvIds)
              .order("created_at", { ascending: true }),
            // AI voice calls: the recording lives on the calls row, not on a message.
            supabase
              .from("calls")
              .select("id, recording_url, duration_sec, outcome, created_at")
              .in("conversation_id", allConvIds)
              .order("created_at", { ascending: true }),
          ]);

          if (msgs && !cancelled) {
            setTurns(msgs.map(mapTurn));
          }
          if (callRows && !cancelled) {
            setCalls((callRows as CallRow[]).filter((r) => r.recording_url));
          }
        }
      } catch {
        // keep defaults on failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  // Real-time subscription for new messages
  useEffect(() => {
    if (isDemo || !convId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`messages:${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const msg = payload.new;
          setTurns((prev) => {
            // Avoid duplicates
            if (prev.some((t) => t.id === msg.id)) return prev;
            return [...prev, mapTurn(msg)];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [convId]);

  async function takeOver() {
    if (!isDemo) {
      try {
        // Find conversation id for this lead
        const supabase = createClient();
        const { data: convData } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", id)
          .limit(1)
          .single();
        if (convData) {
          await apiFetch(`/agent/conversations/${convData.id}/takeover`, { method: "POST" });
        }
      } catch {
        // proceed with local state update even if API fails
      }
    }
    setMode("human");
    setTurns((t) => [...t, {
      id: `sys-${Date.now()}`, role: "system",
      text: `You took over this conversation \u00B7 AI paused`, at: "now",
    }]);
  }

  async function handBack() {
    if (!isDemo) {
      try {
        const supabase = createClient();
        const { data: convData } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", id)
          .limit(1)
          .single();
        if (convData) {
          await apiFetch(`/agent/conversations/${convData.id}/handback`, { method: "POST" });
        }
      } catch {
        // proceed with local state update
      }
    }
    setMode("ai");
    setTurns((t) => [...t, { id: `sys-${Date.now()}`, role: "system", text: "Handed back to AI", at: "now" }]);
  }

  async function send() {
    if (!draft.trim()) return;
    const text = draft.trim();
    if (!isDemo) {
      try {
        const supabase = createClient();
        const { data: convData } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", id)
          .limit(1)
          .single();
        if (convData) {
          await apiFetch("/agent/messages", {
            method: "POST",
            body: JSON.stringify({ conversation_id: convData.id, text }),
          });
        }
      } catch {
        // still show the message locally
      }
    }
    setTurns((t) => [...t, { id: `a-${Date.now()}`, role: "agent", text, at: "now" }]);
    setDraft("");
  }

  if (loading) {
    return (
      <>
        <h1 className="page-title">Loading...</h1>
        <p className="page-sub" style={{ color: "var(--muted)" }}>Fetching conversation</p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">{lead.name}</h1>
      <p className="page-sub">
        {lead.project} · WhatsApp · <span className="chip chip-lang">{lead.langLabel}</span>
      </p>

      <div className="card card-pad" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px 24px" }}>
        {leadRaw?.phone && (
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Phone</div>
            <a href={`tel:${leadRaw.phone}`} style={{ fontWeight: 600, color: "var(--accent-deep)" }}>{leadRaw.phone}</a>
          </div>
        )}
        {leadRaw?.email && (
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Email</div>
            <a href={`mailto:${leadRaw.email}`} style={{ fontWeight: 600, color: "var(--accent-deep)" }}>{leadRaw.email}</a>
          </div>
        )}
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Source</div>
          <span style={{ fontSize: 14, textTransform: "capitalize" }}>{lead.source}</span>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Status</div>
          <span style={{ fontSize: 14, textTransform: "capitalize" }}>{lead.status}</span>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 4 }}>Received</div>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>{lead.receivedAt}</span>
        </div>
      </div>

      {calls.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <p className="section-label">{calls.length > 1 ? "Call recordings" : "Call recording"}</p>
          {calls.map((call) => (
            <div key={call.id} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 13, color: "var(--muted)" }}>
                <span>
                  {call.created_at
                    ? new Date(call.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
                    : "AI call"}
                </span>
                {call.duration_sec ? <span>· {formatDuration(call.duration_sec)}</span> : null}
                {call.outcome ? <span>· {call.outcome.replace(/-/g, " ")}</span> : null}
              </div>
              <audio controls preload="none" src={call.recording_url!} style={{ width: "100%" }} />
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 340px)", minHeight: 400 }}>
        <div className="takeover-bar" style={{ flexShrink: 0 }}>
          {mode === "ai" ? (
            <>
              <span><span className="chip chip-ai">AI is handling this conversation</span></span>
              <button className="btn btn-primary" onClick={takeOver}>Take over</button>
            </>
          ) : (
            <>
              <span><span className="chip chip-human">You are handling this conversation</span></span>
              <button className="btn" onClick={handBack}>Hand back to AI</button>
            </>
          )}
        </div>

        <div className="thread" style={{ flex: 1, overflowY: "auto" }}>
          {turns.map((t) =>
            t.role === "system" ? (
              <div key={t.id} className="sysline">{t.text}</div>
            ) : (
              <div key={t.id}
                className={`bubble ${t.role === "lead" ? "bubble-lead" : t.role === "agent" ? "bubble-agent" : "bubble-ai"}`}
                dir={t.role !== "agent" && lead.language === "fa" ? "auto" : undefined}>
                {t.text}
                {t.gloss && <span className="gloss">{t.gloss}</span>}
                <time>{t.role === "agent" ? "You" : t.role === "ai" ? "AI" : lead.name.split(" ")[0]} · {t.at}</time>
              </div>
            )
          )}
        </div>

        <div style={{ flexShrink: 0, borderTop: "1px solid var(--line)" }}>
          {mode === "human" ? (
            <div className="composer">
              <input
                value={draft}
                placeholder={`Message ${lead.name.split(" ")[0]} — sends from the brokerage's WhatsApp number`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button className="btn btn-primary" onClick={send}>Send</button>
            </div>
          ) : (
            <div style={{ padding: "10px 16px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
              Take over to reply manually. The AI handles responses automatically.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
