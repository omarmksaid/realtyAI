"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { isDemo } from "@/lib/data";

interface Callback {
  id: string;
  lead_name: string | null;
  phone: string | null;
  requested_time: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  lead_id: string;
  leads?: { projects?: { name?: string } | null } | null;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}, ${end.getFullYear()}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Callbacks() {
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(!isDemo);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");
  const [selectedCb, setSelectedCb] = useState<Callback | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [convoMessages, setConvoMessages] = useState<{ role: string; content: string; at: string }[]>([]);

  useEffect(() => {
    if (isDemo) {
      setCallbacks([
        { id: "cb1", lead_name: "Reza Karimi", phone: "+14165551234", lead_id: "l1",
          requested_time: new Date(Date.now() + 2 * 3600_000).toISOString(),
          notes: "Deposit structure discussion", status: "pending", created_at: new Date().toISOString(),
          leads: { projects: { name: "The Riv" } } },
        { id: "cb2", lead_name: "Priya Sharma", phone: "+14165559876", lead_id: "l2",
          requested_time: new Date(Date.now() + 26 * 3600_000).toISOString(),
          notes: "2-bed floor plans", status: "pending", created_at: new Date().toISOString(),
          leads: { projects: { name: "Union East" } } },
        { id: "cb3", lead_name: "Wei Chen", phone: "+14165555555", lead_id: "l3",
          requested_time: new Date(Date.now() - 24 * 3600_000).toISOString(),
          notes: "Occupancy date question", status: "completed", created_at: new Date().toISOString(),
          leads: { projects: { name: "Harbourline" } } },
      ]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const companyId = await getCompanyId();
        if (!companyId) { setLoading(false); return; }
        const supabase = createClient();
        const from = weekStart.toISOString();
        const to = addDays(weekStart, 7).toISOString();
        const { data } = await supabase
          .from("callbacks")
          .select("*, leads(projects(name))")
          .eq("company_id", companyId)
          .neq("status", "cancelled")
          .gte("requested_time", from)
          .lt("requested_time", to)
          .order("requested_time", { ascending: true });
        if (data && !cancelled) setCallbacks(data as Callback[]);
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [weekStart]);

  async function markComplete(id: string) {
    if (isDemo) {
      setCallbacks((prev) => prev.map((cb) => cb.id === id ? { ...cb, status: "completed" } : cb));
      return;
    }
    const supabase = createClient();
    await supabase.from("callbacks").update({ status: "completed" }).eq("id", id);
    setCallbacks((prev) => prev.map((cb) => cb.id === id ? { ...cb, status: "completed" } : cb));
  }

  async function markPending(id: string) {
    if (isDemo) {
      setCallbacks((prev) => prev.map((cb) => cb.id === id ? { ...cb, status: "pending" } : cb));
      return;
    }
    const supabase = createClient();
    await supabase.from("callbacks").update({ status: "pending" }).eq("id", id);
    setCallbacks((prev) => prev.map((cb) => cb.id === id ? { ...cb, status: "pending" } : cb));
  }

  async function openDetail(cb: Callback) {
    setSelectedCb(cb);
    setSummary(null);
    setConvoMessages([]);
    setSummaryLoading(true);

    try {
      const supabase = createClient();

      // Fetch conversation messages for this lead
      const { data: convos } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", cb.lead_id);

      if (convos && convos.length > 0) {
        const allConvIds = convos.map((c: any) => c.id);
        const { data: msgs } = await supabase
          .from("messages")
          .select("role, direction, content, created_at")
          .in("conversation_id", allConvIds)
          .order("created_at", { ascending: true })
          .limit(50);

        if (msgs) {
          setConvoMessages(msgs.map((m: any) => ({
            role: m.direction === "inbound" ? "lead" : m.role === "ai" ? "ai" : "agent",
            content: m.content || "",
            at: new Date(m.created_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
          })));

          // Generate a quick summary from the messages
          const convoText = msgs.map((m: any) =>
            `${m.direction === "inbound" ? "Lead" : "AI"}: ${m.content}`
          ).join("\n");

          if (convoText.length > 20) {
            // Use the last few messages for a brief summary
            const lastMessages = msgs.slice(-6);
            const topics = new Set<string>();
            for (const m of lastMessages) {
              if (m.content?.toLowerCase().includes("price") || m.content?.toLowerCase().includes("pricing")) topics.add("pricing");
              if (m.content?.toLowerCase().includes("deposit")) topics.add("deposit structure");
              if (m.content?.toLowerCase().includes("floor plan")) topics.add("floor plans");
              if (m.content?.toLowerCase().includes("call") || m.content?.toLowerCase().includes("callback")) topics.add("callback request");
              if (m.content?.toLowerCase().includes("parking")) topics.add("parking");
              if (m.content?.toLowerCase().includes("occupancy")) topics.add("occupancy date");
              if (m.content?.toLowerCase().includes("amenit")) topics.add("amenities");
            }
            const topicList = topics.size > 0 ? Array.from(topics).join(", ") : "general inquiry";
            setSummary(`${msgs.length} messages exchanged. Topics discussed: ${topicList}. Last message from ${msgs[msgs.length - 1]?.direction === "inbound" ? "the lead" : "AI"}.`);
          } else {
            setSummary("No conversation history yet.");
          }
        }
      } else {
        setSummary("No conversation found for this lead.");
      }
    } catch (e) {
      console.error("Failed to load conversation:", e);
      setSummary("Failed to load conversation details.");
    } finally {
      setSummaryLoading(false);
    }
  }

  // Group callbacks by day of week
  const days = DAY_NAMES.map((name, i) => {
    const date = addDays(weekStart, i);
    const dateStr = date.toDateString();
    const today = new Date().toDateString() === dateStr;
    const dayCallbacks = callbacks
      .filter((cb) => cb.requested_time && new Date(cb.requested_time).toDateString() === dateStr)
      .filter((cb) => filter === "all" || cb.status === filter);
    return { name, date, today, callbacks: dayCallbacks };
  });

  return (
    <>
      <h1 className="page-title">Callbacks</h1>
      <p className="page-sub">Leads who requested a callback — scheduled from WhatsApp conversations.</p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <span style={{ fontWeight: 600, fontSize: 15, minWidth: 200, textAlign: "center" }}>{formatWeekLabel(weekStart)}</span>
          <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
          <button className="btn btn-quiet" style={{ fontSize: 13, marginLeft: 8 }} onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "pending", "completed"] as const).map((f) => (
            <button key={f} className={`btn ${filter === f ? "btn-primary" : ""}`} style={{ fontSize: 12, padding: "4px 10px", textTransform: "capitalize" }} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card card-pad" style={{ color: "var(--muted)" }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
          {days.map((day) => (
            <div key={day.name} style={{ minHeight: 200 }}>
              <div style={{
                textAlign: "center", padding: "8px 0", fontSize: 12, fontWeight: 600,
                color: day.today ? "var(--accent-deep)" : "var(--muted)",
                borderBottom: day.today ? "2px solid var(--accent-deep)" : "1px solid var(--line)",
                marginBottom: 8,
              }}>
                <div>{day.name}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: day.today ? "var(--accent-deep)" : "var(--ink)" }}>
                  {day.date.getDate()}
                </div>
              </div>

              {day.callbacks.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>—</div>
              )}

              {day.callbacks.map((cb) => (
                <div key={cb.id} onClick={() => openDetail(cb)} style={{
                  background: selectedCb?.id === cb.id ? "var(--accent-wash)" : cb.status === "completed" ? "var(--bg)" : "var(--surface)",
                  border: `1px solid ${selectedCb?.id === cb.id ? "var(--accent-deep)" : cb.status === "pending" ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 8, padding: "8px 10px", marginBottom: 6,
                  opacity: cb.status === "completed" ? 0.6 : 1,
                  fontSize: 12, cursor: "pointer",
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
                    {cb.requested_time ? new Date(cb.requested_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "—"}
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{cb.lead_name || "Unknown"}</div>
                  {(cb.leads as any)?.projects?.name && (
                    <div style={{ color: "var(--muted)", marginBottom: 2 }}>{(cb.leads as any).projects.name}</div>
                  )}
                  {cb.phone && (
                    <a href={`tel:${cb.phone}`} style={{ color: "var(--accent)", textDecoration: "none", display: "block", marginBottom: 2 }} onClick={(e) => e.stopPropagation()}>
                      {cb.phone}
                    </a>
                  )}
                  {cb.status === "pending" ? (
                    <button className="btn" style={{ fontSize: 10, padding: "2px 6px", width: "100%" }} onClick={(e) => { e.stopPropagation(); markComplete(cb.id); }}>✓ Done</button>
                  ) : (
                    <button className="btn btn-quiet" style={{ fontSize: 10, padding: "2px 6px", width: "100%", textDecoration: "line-through" }} onClick={(e) => { e.stopPropagation(); markPending(cb.id); }}>Completed</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {selectedCb && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selectedCb.lead_name || "Unknown"}</h2>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                {selectedCb.requested_time ? new Date(selectedCb.requested_time).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "No time specified"}
                {(selectedCb.leads as any)?.projects?.name && ` · ${(selectedCb.leads as any).projects.name}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {selectedCb.phone && (
                <a href={`tel:${selectedCb.phone}`} className="btn btn-primary" style={{ fontSize: 13, textDecoration: "none" }}>
                  Call {selectedCb.phone}
                </a>
              )}
              <button className="btn btn-quiet" style={{ fontSize: 13 }} onClick={() => setSelectedCb(null)}>Close</button>
            </div>
          </div>

          <div className="card-pad">
            <p className="section-label">Conversation summary</p>
            {summaryLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading conversation...</p>
            ) : summary ? (
              <p style={{ fontSize: 14, marginBottom: 16 }}>{summary}</p>
            ) : null}

            {convoMessages.length > 0 && (
              <>
                <p className="section-label" style={{ marginTop: 16 }}>Recent messages</p>
                <div style={{ maxHeight: 300, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {convoMessages.slice(-10).map((m, i) => (
                    <div key={i} style={{
                      padding: "8px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                      background: m.role === "lead" ? "var(--bg)" : m.role === "ai" ? "var(--accent-wash)" : "var(--warm-wash)",
                      alignSelf: m.role === "lead" ? "flex-start" : "flex-end",
                      maxWidth: "80%",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
                        {m.role === "lead" ? selectedCb.lead_name?.split(" ")[0] || "Lead" : m.role === "ai" ? "AI" : "Agent"} · {m.at}
                      </div>
                      {m.content}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
