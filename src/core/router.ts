import { supabaseAdmin } from "../lib/supabase";
import { isAfterHours, matchRule, RoutingRule } from "./hours";
import { boss } from "../jobs/queue";
import { automationActive, startTrialClockIfNeeded } from "../lib/billing";

/**
 * Entry point for every new lead, regardless of provider.
 * 1. Dedupe + insert.
 * 2. If business hours -> mark for the human team, do nothing else (your comfort constraint).
 * 3. If after hours -> match a routing rule, enqueue first-touch on channel[0],
 *    and schedule escalation jobs for the rest per followup_delay_min.
 */
export async function handleIncomingLead(raw: {
  company_id: string; project_id: string | null; source_id: string | null;
  provider: string; external_id: string; form_id?: string; full_name?: string;
  phone?: string; email?: string; campaign_id?: string; ad_id?: string;
  form_data?: Record<string, unknown>;
}) {
  const { data: company } = await supabaseAdmin
    .from("companies").select("timezone, settings, plan, billing_status, trial_ends_at")
    .eq("id", raw.company_id).single();
  const tz = company?.timezone ?? "America/Toronto";
  const afterHours = isAfterHours(tz, new Date(), (company?.settings as any)?.business_hours ?? null);

  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .upsert(
      { ...raw, received_after_hours: afterHours },
      { onConflict: "company_id,provider,external_id", ignoreDuplicates: true }
    )
    .select()
    .single();
  if (error || !lead) return { deduped: true }; // duplicate webhook delivery — providers retry

  await startTrialClockIfNeeded(raw.company_id, company as any);

  if (!automationActive(company as any)) {
    // Trial expired / cancelled: lead is stored and visible, but nothing fires.
    return { lead_id: lead.id, routed: "billing_paused" };
  }

  if (!afterHours) {
    // Business hours: human team handles it. Lead appears in dashboard, nothing automated.
    return { lead_id: lead.id, routed: "human" };
  }

  const { data: rules } = await supabaseAdmin
    .from("routing_rules")
    .select("*")
    .eq("company_id", raw.company_id)
    .eq("is_active", true);

  const rule = matchRule((rules ?? []) as RoutingRule[], tz);
  if (!rule) return { lead_id: lead.id, routed: "no_rule" };

  // Enqueue: channel[0] fires immediately; each subsequent channel is scheduled
  // followup_delay_min apart and is cancelled if the lead replies (see worker).
  for (let i = 0; i < rule.channels.length; i++) {
    await boss.send(
      "outreach",
      { leadId: lead.id, channel: rule.channels[i], attempt: i, ruleId: rule.id },
      { startAfter: i * rule.followup_delay_min * 60, singletonKey: `${lead.id}:${rule.channels[i]}` }
    );
  }
  return { lead_id: lead.id, routed: rule.label, channels: rule.channels };
}
