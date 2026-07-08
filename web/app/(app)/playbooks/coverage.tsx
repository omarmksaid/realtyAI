"use client";
import { useState, useRef, useEffect } from "react";
import { isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { apiFetch, getCompanyId } from "@/lib/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const START = 7, END = 23; // 7am–11pm grid
const HOURS = Array.from({ length: END - START }, (_, i) => START + i);

// Default: weekdays 9–5 staffed
const defaultGrid = () => {
  const g: boolean[][] = DAYS.map(() => HOURS.map(() => false));
  for (let d = 0; d < 5; d++) for (let h = 0; h < HOURS.length; h++)
    if (HOURS[h] >= 9 && HOURS[h] < 17) g[d][h] = true;
  return g;
};

/** Convert WeeklySchedule from DB into the boolean grid */
function scheduleToGrid(schedule: Record<string, [string, string][]>): boolean[][] {
  return DAY_KEYS.map((key) => {
    const intervals = schedule[key] ?? [];
    return HOURS.map((hr) => {
      const mins = hr * 60;
      return intervals.some(([s, e]) => {
        const [sh, sm] = s.split(":").map(Number);
        const [eh, em] = e.split(":").map(Number);
        return mins >= sh * 60 + sm && mins < eh * 60 + em;
      });
    });
  });
}

/** Collapse contiguous true-cells per day into [start, end] intervals */
function gridToSchedule(grid: boolean[][]): Record<string, [string, string][]> {
  const schedule: Record<string, [string, string][]> = {};
  DAY_KEYS.forEach((key, di) => {
    const intervals: [string, string][] = [];
    let start: number | null = null;
    for (let hi = 0; hi < HOURS.length; hi++) {
      if (grid[di][hi] && start === null) {
        start = HOURS[hi];
      } else if (!grid[di][hi] && start !== null) {
        const pad = (n: number) => n.toString().padStart(2, "0");
        intervals.push([`${pad(start)}:00`, `${pad(HOURS[hi])}:00`]);
        start = null;
      }
    }
    if (start !== null) {
      const pad = (n: number) => n.toString().padStart(2, "0");
      intervals.push([`${pad(start)}:00`, `${pad(END)}:00`]);
    }
    schedule[key] = intervals;
  });
  return schedule;
}

export default function Coverage() {
  const [grid, setGrid] = useState<boolean[][]>(defaultGrid);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const paintTo = useRef<boolean | null>(null);

  // Load existing schedule from DB
  useEffect(() => {
    if (isDemo) return;
    (async () => {
      try {
        const supabase = createClient();
        const companyId = await getCompanyId();
        if (!companyId) return;
        const { data } = await supabase
          .from("companies")
          .select("settings")
          .eq("id", companyId)
          .single();
        const bh = (data?.settings as any)?.business_hours;
        if (bh) setGrid(scheduleToGrid(bh));
      } catch {}
    })();
  }, []);

  function set(d: number, h: number, v: boolean) {
    setGrid((g) => g.map((row, di) => di !== d ? row : row.map((c, hi) => (hi === h ? v : c))));
    setDirty(true);
  }
  function down(d: number, h: number) { paintTo.current = !grid[d][h]; set(d, h, paintTo.current); }
  function enter(d: number, h: number, buttons: number) { if (buttons === 1 && paintTo.current !== null) set(d, h, paintTo.current); }

  async function save() {
    if (isDemo) { setDirty(false); return; }
    setSaving(true);
    try {
      const schedule = gridToSchedule(grid);
      await apiFetch("/agent/company/hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_hours: schedule }),
      });
      setDirty(false);
    } catch (err) {
      console.error("Failed to save hours:", err);
    } finally {
      setSaving(false);
    }
  }

  const staffedHrs = grid.flat().filter(Boolean).length;

  return (
    <div className="card card-pad" onMouseUp={() => (paintTo.current = null)} onMouseLeave={() => (paintTo.current = null)}>
      <p className="section-label">Coverage calendar</p>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Click and drag to paint when <b>your team</b> handles leads. Everything else, realtyAI runs.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(7, 1fr)`, gap: 3, userSelect: "none" }}>
        <div />
        {DAYS.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{d}</div>)}
        {HOURS.map((hr, hi) => (
          <>
            <div key={`l${hr}`} style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "right", paddingRight: 6, lineHeight: "22px" }}>
              {hr <= 12 ? `${hr}${hr === 12 ? "pm" : "am"}` : `${hr - 12}pm`}
            </div>
            {DAYS.map((_, di) => (
              <div key={`${di}-${hi}`}
                onMouseDown={() => down(di, hi)}
                onMouseEnter={(e) => enter(di, hi, e.buttons)}
                title={grid[di][hi] ? "Staffed — your team" : "realtyAI runs"}
                style={{
                  height: 22, borderRadius: 4, cursor: "pointer",
                  background: grid[di][hi] ? "var(--accent-deep)" : "var(--bg)",
                  border: `1px solid ${grid[di][hi] ? "var(--accent-deep)" : "var(--line)"}`,
                }} />
            ))}
          </>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "var(--accent-deep)", borderRadius: 3, marginRight: 6, verticalAlign: -1 }} />
          Staffed ({staffedHrs}h/wk) · everything else is realtyAI
        </span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn" style={{ fontSize: 13 }}>Add holidays</button>
          <button className="btn btn-primary" style={{ fontSize: 13, opacity: dirty ? 1 : 0.5 }} onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save schedule" : "Saved"}
          </button>
        </span>
      </div>
    </div>
  );
}
