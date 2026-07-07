"use client";
import { useState, useRef } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const START = 7, END = 23; // 7am–11pm grid
const HOURS = Array.from({ length: END - START }, (_, i) => START + i);

// Default: weekdays 9–5 staffed
const initial = () => {
  const g: boolean[][] = DAYS.map(() => HOURS.map(() => false));
  for (let d = 0; d < 5; d++) for (let h = 0; h < HOURS.length; h++)
    if (HOURS[h] >= 9 && HOURS[h] < 17) g[d][h] = true;
  return g;
};

export default function Coverage() {
  const [grid, setGrid] = useState<boolean[][]>(initial);
  const [dirty, setDirty] = useState(false);
  const paintTo = useRef<boolean | null>(null);

  function set(d: number, h: number, v: boolean) {
    setGrid((g) => g.map((row, di) => di !== d ? row : row.map((c, hi) => (hi === h ? v : c))));
    setDirty(true);
  }
  function down(d: number, h: number) { paintTo.current = !grid[d][h]; set(d, h, paintTo.current); }
  function enter(d: number, h: number, buttons: number) { if (buttons === 1 && paintTo.current !== null) set(d, h, paintTo.current); }

  function save() {
    // Live: PUT /agent/company/hours with { business_hours: { mon: [["09:00","17:00"]], ... } }
    // (contiguous true-cells per day collapse into [start,end] intervals)
    setDirty(false);
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
          <button className="btn btn-primary" style={{ fontSize: 13, opacity: dirty ? 1 : 0.5 }} onClick={save}>
            {dirty ? "Save schedule" : "Saved"}
          </button>
        </span>
      </div>
    </div>
  );
}
