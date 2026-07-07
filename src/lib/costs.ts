import { supabaseAdmin } from "./supabase";

/**
 * Cost recording. Rates are ESTIMATES for planning — update when providers reprice.
 * Vapi calls use the ACTUAL cost from the end-of-call report when present, falling
 * back to the per-minute estimate. Everything lands in cost_events; the dashboard
 * aggregates. Adding a new billable thing = one recordCost() call at the send site.
 */
export const RATES = {
  VOICE_PER_MIN: 0.20,        // all-in estimate (Vapi + STT + LLM + TTS + telephony)
  WA_TEMPLATE: 0.03,          // Meta marketing template fee, Canada + Twilio msg fee
  WA_MSG: 0.005,              // Twilio per-message fee (session messages, inbound)
  EMAIL: 0.001,
  SMS: 0.008,                 // Canada outbound SMS
  LLM: {                      // USD per token
    "claude-sonnet-4-6": { in: 3 / 1e6, out: 15 / 1e6 },
    default: { in: 3 / 1e6, out: 15 / 1e6 },
  },
};

export async function recordCost(opts: {
  companyId: string; conversationId?: string | null; leadId?: string | null;
  category: "voice" | "whatsapp" | "email" | "sms" | "llm" | "embedding";
  amountUsd: number; meta?: Record<string, unknown>;
}) {
  if (!(opts.amountUsd > 0)) return;
  await supabaseAdmin.from("cost_events").insert({
    company_id: opts.companyId, conversation_id: opts.conversationId ?? null,
    lead_id: opts.leadId ?? null, category: opts.category,
    amount_usd: Number(opts.amountUsd.toFixed(6)), meta: opts.meta ?? {},
  }).then(({ error }) => { if (error) console.error("cost_events insert failed", error.message); });
}

export function llmCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = (RATES.LLM as any)[model] ?? RATES.LLM.default;
  return inputTokens * r.in + outputTokens * r.out;
}
