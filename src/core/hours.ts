import { DateTime } from "luxon";

export interface RoutingRule {
  id: string;
  label: string;
  day_type: "weekday" | "weekend" | "any";
  start_time: string; // "17:00:00"
  end_time: string;   // "09:00:00" — may wrap past midnight
  channels: string[];
  followup_delay_min: number;
  priority: number;
  is_active: boolean;
}

export interface WeeklySchedule {
  mon?: [string, string][]; tue?: [string, string][]; wed?: [string, string][];
  thu?: [string, string][]; fri?: [string, string][]; sat?: [string, string][];
  sun?: [string, string][]; holidays?: string[];
}
const DAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"] as const;

/** After hours = outside the company's staffed schedule (set in the Coverage calendar).
 *  Falls back to weekdays 09:00–17:00 when no schedule is configured. Holidays are
 *  fully after-hours regardless of weekday. */
export function isAfterHours(tz: string, at: Date = new Date(), schedule?: WeeklySchedule | null): boolean {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  const mins = dt.hour * 60 + dt.minute;
  if (!schedule) {
    const isWeekend = dt.weekday >= 6;
    return isWeekend || mins < 9 * 60 || mins >= 17 * 60;
  }
  if (schedule.holidays?.includes(dt.toISODate()!)) return true;
  const intervals = schedule[DAY_KEYS[dt.weekday - 1]] ?? [];
  const toMin = (t: string) => { const [hh, mm] = t.split(":").map(Number); return hh * 60 + mm; };
  const staffed = intervals.some(([s, e]) => mins >= toMin(s) && mins < toMin(e));
  return !staffed;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** First active rule (by priority) whose day-type and time window match `at`. Handles windows that wrap midnight (22:00→09:00). */
export function matchRule(rules: RoutingRule[], tz: string, at: Date = new Date()): RoutingRule | null {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  const isWeekend = dt.weekday >= 6;
  const now = dt.hour * 60 + dt.minute;

  const candidates = rules
    .filter(r => r.is_active)
    .filter(r => r.day_type === "any" || (r.day_type === "weekend") === isWeekend)
    .sort((a, b) => a.priority - b.priority);

  for (const r of candidates) {
    const start = toMinutes(r.start_time);
    const end = toMinutes(r.end_time);
    const inWindow = start <= end
      ? now >= start && now < end
      : now >= start || now < end; // wraps midnight
    if (inWindow) return r;
  }
  return null;
}
