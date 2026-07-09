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
  leads?: { projects?: { name?: string } | null } | null;
}

const demoCallbacks: Callback[] = [
  {
    id: "cb1",
    lead_name: "Reza Karimi",
    phone: "+14165551234",
    requested_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    notes: "Wants to discuss deposit structure for The Riv, comparing with Pickering project",
    status: "pending",
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    leads: { projects: { name: "The Riv" } },
  },
  {
    id: "cb2",
    lead_name: "Priya Sharma",
    phone: "+14165559876",
    requested_time: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    notes: "Requested 2-bed floor plans facing away from tracks, asked about assignment rights",
    status: "pending",
    created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    leads: { projects: { name: "Union East" } },
  },
  {
    id: "cb3",
    lead_name: "Wei Chen",
    phone: "+14165555555",
    requested_time: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    notes: "Asked about occupancy date and parking cost",
    status: "pending",
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    leads: { projects: { name: "Harbourline" } },
  },
];

function groupByDate(callbacks: Callback[]): { label: string; items: Callback[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  const groups: Record<string, Callback[]> = {};
  const order: string[] = [];

  for (const cb of callbacks) {
    const d = cb.requested_time ? new Date(cb.requested_time) : null;
    let label: string;
    if (!d) {
      label = "No time specified";
    } else if (d.toDateString() === todayStr) {
      label = "Today";
    } else if (d.toDateString() === tomorrowStr) {
      label = "Tomorrow";
    } else {
      label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    }
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(cb);
  }

  return order.map((label) => ({ label, items: groups[label] }));
}

function formatTime(iso: string | null): string {
  if (!iso) return "No time specified";
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function Callbacks() {
  const [callbacks, setCallbacks] = useState<Callback[]>(isDemo ? demoCallbacks : []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const companyId = await getCompanyId();
        if (!companyId) { setLoading(false); return; }
        const supabase = createClient();
        // Supabase query: callbacks where status = 'pending', ordered by requested_time
        const { data, error } = await supabase
          .from("callbacks")
          .select("*, leads(projects(name))")
          .eq("company_id", companyId)
          .eq("status", "pending")
          .order("requested_time", { ascending: true, nullsFirst: false })
          .limit(100);
        if (error || !data) { setLoading(false); return; }
        if (!cancelled) setCallbacks(data as Callback[]);
      } catch {
        // Keep empty state on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function markComplete(id: string) {
    if (isDemo) {
      setCallbacks((prev) => prev.filter((cb) => cb.id !== id));
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("callbacks")
      .update({ status: "completed" })
      .eq("id", id);
    if (!error) {
      setCallbacks((prev) => prev.filter((cb) => cb.id !== id));
    }
  }

  const groups = groupByDate(callbacks);

  return (
    <>
      <h1 className="page-title">Callbacks</h1>
      <p className="page-sub">Leads who requested a callback</p>

      {loading ? (
        <div className="card">
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>Loading callbacks...</p>
        </div>
      ) : callbacks.length === 0 ? (
        <div className="card">
          <p style={{ padding: "24px 22px", color: "var(--muted)" }}>
            No pending callbacks. When a lead requests a callback during an AI conversation, it will appear here.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", margin: "0 0 8px" }}>
              {group.label}
            </h2>
            <div className="card">
              {group.items.map((cb, i) => (
                <div
                  key={cb.id}
                  style={{
                    padding: "16px 22px",
                    borderBottom: i < group.items.length - 1 ? "1px solid var(--line)" : undefined,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{formatTime(cb.requested_time)}</span>
                      <span style={{ fontWeight: 600 }}>{cb.lead_name || "Unknown"}</span>
                      {(cb.leads as any)?.projects?.name && (
                        <span className="chip" style={{ fontSize: 11.5 }}>
                          {(cb.leads as any).projects.name}
                        </span>
                      )}
                      <span className="chip chip-warm" style={{ fontSize: 11 }}>Pending</span>
                    </div>
                    {cb.phone && (
                      <div style={{ fontSize: 13, marginBottom: 2 }}>
                        <a
                          href={`tel:${cb.phone}`}
                          style={{ color: "var(--accent)", textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {cb.phone}
                        </a>
                      </div>
                    )}
                    {cb.notes && (
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                        {cb.notes}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-quiet"
                    style={{ fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 }}
                    onClick={() => markComplete(cb.id)}
                  >
                    Mark complete
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
