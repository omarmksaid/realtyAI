import { supabaseAdmin } from "./supabase";

/**
 * Trial & billing gates.
 *
 * Policy (deliberate, communicated in UI + emails):
 * - Trial clock starts on the FIRST LEAD, not at signup — setup time is free.
 * - Automation runs while: trial unexpired, or billing_status = 'active',
 *   or 'past_due' (grace: dunning shouldn't drop a customer's leads).
 * - When automation is OFF (trial expired / cancelled): leads still ingest and
 *   appear on the dashboard, inbound messages are still stored, but no outreach
 *   fires, the AI stops replying, and the digest pauses. Read access never dies —
 *   their transcripts remain theirs.
 */
export interface BillingInfo {
  billing_status: string;
  trial_ends_at: string | null;
  plan: string;
}

export function automationActive(b: BillingInfo, at: Date = new Date()): boolean {
  if (b.billing_status === "active" || b.billing_status === "past_due") return true;
  if (b.billing_status === "trial")
    return !b.trial_ends_at || new Date(b.trial_ends_at) > at; // null = clock not started yet
  return false; // cancelled
}

/** First lead starts the 14-day clock. Idempotent. */
export async function startTrialClockIfNeeded(companyId: string, b: BillingInfo) {
  if (b.billing_status !== "trial" || b.trial_ends_at) return;
  const ends = new Date(Date.now() + 14 * 86400_000).toISOString();
  await supabaseAdmin.from("companies").update({ trial_ends_at: ends }).eq("id", companyId);
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, action: "trial.started", detail: { trial_ends_at: ends },
  });
}
