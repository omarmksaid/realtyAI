"use client";

import { useState, useEffect, useCallback } from "react";
import { demoRules, isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import Coverage from "./coverage";

interface Rule { id: string; label: string; window: string; channels: string[]; active: boolean }
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

export default function Playbooks() {
  const [rules, setRules] = useState<Rule[]>(demoRules);
  const [template, setTemplate] = useState<PromptTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState("");
  const [loading, setLoading] = useState(!isDemo);

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

      if (rulesData?.length) {
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

  const promptLabel = template
    ? `${template.name} (${template.channel}) · v${template.version}`
    : "Conversation prompt — The Riv (WhatsApp) · v4";

  const defaultPrompt = `You represent Northgate Realty for The Riv in Vaughan. Tone: warm, unhurried, never salesy.
Answer questions using PROJECT KNOWLEDGE only. Lead with the July deposit incentive if pricing comes up.
If the lead is comparing projects, ask what matters most to them (commute, deposit, occupancy).
Always offer to book a morning call with the team; collect their preferred time.
Reply in the lead's language.`;

  return (
    <>
      <h1 className="page-title">Playbooks</h1>
      <p className="page-sub">When the AI reaches out, on which channels, and what it&apos;s allowed to say.</p>

      <Coverage />

      <div className="card card-pad">
        <p className="section-label">After-hours routing</p>
        {rules.map((r) => (
          <div className="doc-row" key={r.id}>
            <span>
              <b>{r.label}</b>
              <span style={{ color: "var(--muted)", marginLeft: 10 }}>{r.window}</span>
            </span>
            <span>
              {r.channels.map((c) => (
                <span key={c} className="chip chip-lang" style={{ marginLeft: 6 }}>{c}</span>
              ))}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <button className="btn">Add rule</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          During business hours (weekdays 9–5) nothing is automated — leads go straight to your team.
        </p>
      </div>

      <div className="card card-pad">
        <p className="section-label">{promptLabel}</p>
        <textarea rows={7} value={templateContent || defaultPrompt} onChange={(e) => setTemplateContent(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary">Save as v{(template?.version ?? 4) + 1}</button>
          <button className="btn">Test in sandbox</button>
          <button className="btn btn-quiet">Version history</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          Safety rails (no invented pricing, handoff and opt-out behavior) are enforced in code and can&apos;t be edited away here.
        </p>
      </div>
    </>
  );
}
