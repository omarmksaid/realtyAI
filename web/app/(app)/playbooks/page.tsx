"use client";

import { useState, useEffect, useCallback } from "react";
import { demoRules, isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { apiFetch, getCompanyId } from "@/lib/api";
import Coverage from "./coverage";

interface Rule { id: string; label: string; window: string; channels: string[]; active: boolean }
interface RuleRaw { id: string; label: string; day_type: string; start_time: string; end_time: string; channels: string[]; is_active: boolean; priority: number }
interface PromptTemplate { id: string; name: string; channel: string; content: string; version: number; project_id: string | null }

function formatWindow(dayType: string, start: string, end: string): string {
  const dayLabel = dayType === "weekday" ? "Weekdays" : dayType === "weekend" ? "Weekends" : "Every day";
  const fmt = (t: string) => {
    const [h] = t.split(":");
    const hr = parseInt(h);
    if (hr === 0) return "12:00 AM";
    if (hr < 12) return `${hr}:00 AM`;
    if (hr === 12) return "12:00 PM";
    return `${hr - 12}:00 PM`;
  };
  return `${dayLabel} · ${fmt(start)} – ${fmt(end)}`;
}

function formatChannels(channels: string[]): string[] {
  return channels.map((c) => {
    if (c === "whatsapp") return "WhatsApp";
    if (c === "voice") return "AI call after 10 min";
    if (c === "email") return "Email";
    return c;
  });
}

const CHANNEL_OPTIONS = ["whatsapp", "voice", "email"];
const DAY_TYPE_OPTIONS = [
  { value: "weekday", label: "Weekdays" },
  { value: "weekend", label: "Weekends" },
  { value: "any", label: "Every day" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(i)}:00`;
});

export default function Playbooks() {
  const [rules, setRules] = useState<Rule[]>(isDemo ? demoRules : []);
  const [rawRules, setRawRules] = useState<RuleRaw[]>([]);
  const [template, setTemplate] = useState<PromptTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState("");
  const [loading, setLoading] = useState(!isDemo);
  const [showAddRule, setShowAddRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // New rule form state
  const [newLabel, setNewLabel] = useState("");
  const [newDayType, setNewDayType] = useState("any");
  const [newStart, setNewStart] = useState("17:00");
  const [newEnd, setNewEnd] = useState("21:00");
  const [newChannels, setNewChannels] = useState<string[]>(["whatsapp", "email"]);
  const [newDelay, setNewDelay] = useState(15);

  const fetchData = useCallback(async () => {
    if (isDemo) return;
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;

      const [{ data: rulesData }, { data: templates }] = await Promise.all([
        supabase
          .from("routing_rules")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("priority"),
        supabase
          .from("prompt_templates")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      if (rulesData) {
        setRawRules(rulesData as any);
        setRules(rulesData.map((r: any) => ({
          id: r.id,
          label: r.label,
          window: formatWindow(r.day_type, r.start_time, r.end_time),
          channels: formatChannels(r.channels ?? []),
          active: r.is_active,
        })));
      }

      if (templates?.length) {
        const t = templates[0] as any;
        setTemplate({ id: t.id, name: t.name, channel: t.channel, content: t.content, version: t.version, project_id: t.project_id });
        setTemplateContent(t.content);
      }
    } catch (e) {
      console.error("Failed to fetch playbooks, using demo data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function addRule() {
    if (!newLabel.trim() || !newChannels.length) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;

      const maxPriority = rawRules.length ? Math.max(...rawRules.map(r => r.priority)) : 0;

      const { error } = await supabase.from("routing_rules").insert({
        company_id: companyId,
        label: newLabel.trim(),
        day_type: newDayType,
        start_time: newStart,
        end_time: newEnd,
        channels: newChannels,
        followup_delay_min: newDelay,
        priority: maxPriority + 10,
      });

      if (error) {
        console.error("Failed to add rule:", error);
      } else {
        setShowAddRule(false);
        setNewLabel("");
        setNewDayType("any");
        setNewStart("17:00");
        setNewEnd("21:00");
        setNewChannels(["whatsapp", "email"]);
        setNewDelay(15);
        fetchData();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(id: string) {
    if (isDemo) return;
    const supabase = createClient();
    await supabase.from("routing_rules").update({ is_active: false }).eq("id", id);
    fetchData();
  }

  async function savePrompt() {
    if (isDemo || !templateContent.trim()) return;
    setSavingPrompt(true);
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;

      if (template) {
        // Deactivate old version
        await supabase.from("prompt_templates").update({ is_active: false }).eq("id", template.id);
      }

      // Insert new version
      await supabase.from("prompt_templates").insert({
        company_id: companyId,
        project_id: template?.project_id ?? null,
        channel: template?.channel ?? "any",
        name: template?.name ?? "Company default",
        content: templateContent.trim(),
        version: (template?.version ?? 0) + 1,
        is_active: true,
      });

      fetchData();
    } catch (e) {
      console.error("Failed to save prompt:", e);
    } finally {
      setSavingPrompt(false);
    }
  }

  function toggleChannel(ch: string) {
    setNewChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  const promptLabel = template
    ? `${template.name} (${template.channel}) · v${template.version}`
    : "Conversation prompt — Company default · v1";

  const defaultPrompt = `You represent the brokerage. Tone: warm, unhurried, never salesy.
Answer questions using PROJECT KNOWLEDGE only. Always offer to book a morning call with the team and collect their preferred time.
Reply in the lead's language.`;

  return (
    <>
      <h1 className="page-title">Playbooks</h1>
      <p className="page-sub">When the AI reaches out, on which channels, and what it&apos;s allowed to say.</p>

      <Coverage />

      <div className="card card-pad">
        <p className="section-label">After-hours routing</p>
        {rules.length === 0 && !loading && (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No routing rules yet. Add one to enable after-hours automation.</p>
        )}
        {rules.map((r) => (
          <div className="doc-row" key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <b>{r.label}</b>
              <span style={{ color: "var(--muted)", marginLeft: 10 }}>{r.window}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {r.channels.map((c) => (
                <span key={c} className="chip chip-lang" style={{ marginLeft: 0 }}>{c}</span>
              ))}
              {!isDemo && (
                <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px", marginLeft: 8 }} onClick={() => deleteRule(r.id)}>×</button>
              )}
            </span>
          </div>
        ))}

        {showAddRule && (
          <div style={{ marginTop: 14, padding: 16, border: "1px solid var(--line)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            <input placeholder="Rule label (e.g. Late night)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <div style={{ display: "flex", gap: 10 }}>
              <select value={newDayType} onChange={(e) => setNewDayType(e.target.value)} style={{ flex: 1 }}>
                {DAY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={newStart} onChange={(e) => setNewStart(e.target.value)} style={{ flex: 1 }}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span style={{ alignSelf: "center", color: "var(--muted)" }}>to</span>
              <select value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={{ flex: 1 }}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {CHANNEL_OPTIONS.map((ch) => (
                <label key={ch} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={newChannels.includes(ch)} onChange={() => toggleChannel(ch)} />
                  {ch === "whatsapp" ? "WhatsApp" : ch === "voice" ? "AI Call" : "Email"}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Follow-up delay (min):</label>
              <input type="number" value={newDelay} onChange={(e) => setNewDelay(Number(e.target.value))} style={{ width: 70 }} min={0} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={addRule} disabled={saving || !newLabel.trim()}>
                {saving ? "Saving…" : "Save rule"}
              </button>
              <button className="btn" onClick={() => setShowAddRule(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {!showAddRule && <button className="btn" onClick={() => setShowAddRule(true)}>Add rule</button>}
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          During staffed hours (see calendar above) nothing is automated — leads go straight to your team.
        </p>
      </div>

      <div className="card card-pad">
        <p className="section-label">{promptLabel}</p>
        <textarea rows={7} value={templateContent || defaultPrompt} onChange={(e) => setTemplateContent(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={savePrompt} disabled={savingPrompt}>
            {savingPrompt ? "Saving…" : `Save as v${(template?.version ?? 0) + 1}`}
          </button>
          <button className="btn btn-quiet">Version history</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          Safety rails (no invented pricing, handoff and opt-out behavior) are enforced in code and can&apos;t be edited away here.
        </p>
      </div>
    </>
  );
}
