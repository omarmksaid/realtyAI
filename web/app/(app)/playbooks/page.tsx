"use client";

import { useState, useEffect, useCallback } from "react";
import { demoRules, isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { apiFetch, apiCall, getCompanyId } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useRole } from "@/lib/role";
import Coverage from "./coverage";

interface Rule { id: string; label: string; window: string; channels: string[]; active: boolean; delayMin: number }
interface RuleRaw { id: string; label: string; day_type: string; start_time: string; end_time: string; channels: string[]; is_active: boolean; priority: number; followup_delay_min: number }
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

const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", voice: "AI call", email: "Email" };

/** Channels fire in order: the first immediately, each next one `delayMin` later
 *  (and only if the lead hasn't replied yet). Show that timing, don't hardcode it. */
function formatChannels(channels: string[], delayMin: number): string[] {
  return channels.map((c, i) => {
    const label = CHANNEL_LABELS[c] ?? c;
    if (i === 0) return `${label} — right away`;
    const mins = i * delayMin;
    return mins === 0 ? `${label} — right away` : `${label} — after ${mins} min`;
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
  // Rule id currently being edited inline; null when the form is a "new rule" form.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Rule form state — shared by the add-new form and the inline edit form.
  const [newLabel, setNewLabel] = useState("");
  const [newDayType, setNewDayType] = useState("any");
  const [newStart, setNewStart] = useState("17:00");
  const [newEnd, setNewEnd] = useState("21:00");
  const [newChannels, setNewChannels] = useState<string[]>(["whatsapp", "email"]);
  const [newDelay, setNewDelay] = useState(15);
  const toast = useToast();
  const { isAdmin } = useRole();

  function resetForm() {
    setNewLabel("");
    setNewDayType("any");
    setNewStart("17:00");
    setNewEnd("21:00");
    setNewChannels(["whatsapp", "email"]);
    setNewDelay(15);
  }

  /** Open the inline editor pre-filled from the rule's stored values. */
  function startEdit(id: string) {
    const raw = rawRules.find((r) => r.id === id);
    if (!raw) return;
    setNewLabel(raw.label);
    setNewDayType(raw.day_type);
    setNewStart(raw.start_time.slice(0, 5)); // "17:00:00" -> "17:00"
    setNewEnd(raw.end_time.slice(0, 5));
    setNewChannels(raw.channels ?? []);
    setNewDelay(raw.followup_delay_min ?? 0);
    setEditingId(id);
    setShowAddRule(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setShowAddRule(false);
    resetForm();
  }

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
          channels: formatChannels(r.channels ?? [], r.followup_delay_min ?? 0),
          active: r.is_active,
          delayMin: r.followup_delay_min ?? 0,
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

  /** Create a new rule, or update the one being edited. Channel order is the escalation
   *  ladder (first fires immediately, each next one `followup_delay_min` later), so the
   *  order the boxes are ticked in matters — see reorderChannels. */
  async function saveRule() {
    if (isDemo || !newLabel.trim() || !newChannels.length) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;

      // Through the API, not Supabase: routing rules decide when we spend money on a voice
      // call, and RLS only checks company membership — never role. Any agent could rewrite
      // them. The endpoint enforces owner/admin.
      await apiCall(`/agent/company/routing-rules/${editingId ?? ""}`, {
        method: "PUT",
        body: JSON.stringify({
          label: newLabel.trim(),
          day_type: newDayType,
          start_time: newStart,
          end_time: newEnd,
          channels: newChannels,
          followup_delay_min: newDelay,
          priority: (rawRules.length ? Math.max(...rawRules.map((r) => r.priority)) : 0) + 10,
        }),
      });
      cancelEdit();
      fetchData();
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save that rule.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(id: string) {
    if (isDemo) return;
    try {
      await apiCall(`/agent/company/routing-rules/${id}`, { method: "DELETE" });
      fetchData();
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't delete that rule.");
    }
  }

  /** Publishing a prompt rewrites what the AI is allowed to say. Owner/admin only —
   *  enforced by the endpoint, since RLS can't see role. */
  async function savePrompt() {
    if (isDemo || !templateContent.trim()) return;
    setSavingPrompt(true);
    try {
      await apiCall("/agent/company/prompt", {
        method: "POST",
        body: JSON.stringify({
          content: templateContent.trim(),
          name: template?.name ?? "Company default",
          channel: template?.channel ?? "any",
          project_id: template?.project_id ?? null,
          previous_id: template?.id ?? null,
          version: template?.version ?? 0,
        }),
      });
      fetchData();
      toast.show("Prompt published.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't publish that prompt.");
    } finally {
      setSavingPrompt(false);
    }
  }

  function toggleChannel(ch: string) {
    setNewChannels((prev) => {
      const next = prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch];
      return CHANNEL_OPTIONS.filter((c) => next.includes(c));
    });
  }

  /** One form, two uses: creating a rule and editing an existing one take exactly the
   *  same fields, so they share this rather than keeping two copies in sync. */
  function ruleForm() {
    return (
      <div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
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
              {CHANNEL_LABELS[ch] ?? ch}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Wait between channels (min):</label>
          <input type="number" value={newDelay} onChange={(e) => setNewDelay(Number(e.target.value))} style={{ width: 70 }} min={0} />
        </div>
        {newChannels.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {formatChannels(newChannels, newDelay).join(" · ")}
            {newChannels.length > 1 && " — each step is skipped if the lead has replied."}
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={saveRule} disabled={saving || !newLabel.trim() || !newChannels.length}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Save rule"}
          </button>
          <button className="btn" onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    );
  }

  const promptLabel = template
    ? `${template.name} (${template.channel}) · v${template.version}`
    : "Conversation prompt — Company default · v1";

  const defaultPrompt = `You represent the brokerage. Tone: warm, unhurried, never salesy.
Answer questions using PROJECT KNOWLEDGE only. Always offer to book a morning call with the team and collect their preferred time.
Reply in the lead's language.`;

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", color: "var(--muted)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <p>Loading playbooks...</p>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

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
          editingId === r.id ? (
            <div key={r.id} style={{ marginTop: 14 }}>{ruleForm()}</div>
          ) : (
            <div className="doc-row" key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span>
                <b>{r.label}</b>
                <span style={{ color: "var(--muted)", marginLeft: 10 }}>{r.window}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {r.channels.map((c) => (
                  <span key={c} className="chip chip-lang" style={{ marginLeft: 0 }}>{c}</span>
                ))}
                {!isDemo && isAdmin && (
                  <>
                    <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px", marginLeft: 8 }}
                      onClick={() => startEdit(r.id)}>Edit</button>
                    <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px" }}
                      onClick={() => deleteRule(r.id)}>×</button>
                  </>
                )}
              </span>
            </div>
          )
        ))}

        {showAddRule && <div style={{ marginTop: 14 }}>{ruleForm()}</div>}

        <div style={{ marginTop: 14 }}>
          {!showAddRule && !editingId && isAdmin && (
            <button className="btn" onClick={() => { resetForm(); setShowAddRule(true); }}>Add rule</button>
          )}
          {!isAdmin && !isDemo && (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
              Only owners and admins can change routing rules.
            </p>
          )}
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          During staffed hours (see calendar above) nothing is automated — leads go straight to your team.
        </p>
      </div>

      <div className="card card-pad">
        <p className="section-label">{promptLabel}</p>
        {/* Read-only for agents: this text IS what the AI says to leads. */}
        <textarea rows={7} value={templateContent || defaultPrompt} readOnly={!isAdmin}
          onChange={(e) => setTemplateContent(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          {isAdmin ? (
            <>
              <button className="btn btn-primary" onClick={savePrompt} disabled={savingPrompt}>
                {savingPrompt ? "Saving…" : `Save as v${(template?.version ?? 0) + 1}`}
              </button>
              <button className="btn btn-quiet">Version history</button>
            </>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
              Only owners and admins can change the AI&apos;s prompt.
            </p>
          )}
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          Safety rails (no invented pricing, handoff and opt-out behavior) are enforced in code and can&apos;t be edited away here.
        </p>
      </div>
    </>
  );
}
