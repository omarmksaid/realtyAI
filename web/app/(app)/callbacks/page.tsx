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
                <div key={cb.id} style={{
                  background: cb.status === "completed" ? "var(--bg)" : "var(--surface)",
                  border: `1px solid ${cb.status === "pending" ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 8, padding: "8px 10px", marginBottom: 6,
                  opacity: cb.status === "completed" ? 0.6 : 1,
                  fontSize: 12,
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
                  {cb.notes && (
                    <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 4, lineHeight: 1.4 }}>{cb.notes}</div>
                  )}
                  {cb.status === "pending" ? (
                    <button className="btn" style={{ fontSize: 10, padding: "2px 6px", width: "100%" }} onClick={() => markComplete(cb.id)}>✓ Done</button>
                  ) : (
                    <button className="btn btn-quiet" style={{ fontSize: 10, padding: "2px 6px", width: "100%", textDecoration: "line-through" }} onClick={() => markPending(cb.id)}>Completed</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
