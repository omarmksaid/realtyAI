import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "../lib/supabase";
import { env } from "../lib/env";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/**
 * The morning briefing, in one place.
 *
 * This used to exist twice — once in the cron worker and once, copy-pasted, in an
 * unauthenticated /webhooks/trigger-digest endpoint that looped over EVERY company in the
 * database. Two copies of the same logic drift, and the endpoint was a live hole: no auth,
 * no secret, anyone with the URL could run up the Anthropic bill and read back per-company
 * lead counts. One function now, called from both.
 */
export async function generateDigest(companyId: string, hoursBack = 16) {
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  const [{ data: co }, { data: leads }, { data: msgs }] = await Promise.all([
    supabaseAdmin.from("companies").select("id, name, timezone").eq("id", companyId).single(),
    supabaseAdmin
      .from("leads")
      .select("id, full_name, status, score, score_reason, phone, projects(name)")
      .eq("company_id", companyId).gte("created_at", since),
    supabaseAdmin
      .from("messages")
      .select("content, role, conversation_id, conversations(channel, lead_id)")
      .eq("company_id", companyId).gte("created_at", since)
      .order("created_at").limit(500),
  ]);

  if (!co) throw new Error("company not found");
  if (!leads?.length && !msgs?.length) return { skipped: "no activity" as const };

  // Callbacks the AI booked overnight are the single most actionable thing in the briefing —
  // they're a commitment someone made to the lead, with a time attached. The old digest never
  // looked at this table, so the model had to infer them from transcript text.
  const { data: callbacks } = await supabaseAdmin
    .from("callbacks")
    .select("requested_time, lead_name, phone, notes")
    .eq("company_id", companyId).eq("status", "pending")
    .order("requested_time");

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system:
      "You write a morning briefing for a real estate team about overnight lead activity.\n" +
      "Lead with anything time-critical: a booked callback is a promise the AI made to the lead " +
      "on the team's behalf, so surface those first, with the time and the phone number.\n" +
      "Then rank the rest by how close they are to transacting — someone who asked about " +
      "pricing, deposits, or booking outranks someone browsing.\n" +
      "For each lead give: name, project, what they actually asked, sentiment, and one concrete " +
      "next action.\n" +
      "Some leads may be unscored — say so rather than guessing a score.\n" +
      "If two records look like the same person, say so; don't let the team call them twice.\n" +
      "Be concise and scannable. This is read at 8:30am with a coffee, not studied.",
    messages: [{
      role: "user",
      content:
        `Company: ${co.name}\n\n` +
        `Booked callbacks (act on these first):\n${JSON.stringify(callbacks ?? [], null, 1)}\n\n` +
        `Overnight leads:\n${JSON.stringify(leads, null, 1)}\n\n` +
        `Conversation turns:\n${JSON.stringify(msgs, null, 1)}`,
    }],
  });

  const content = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");

  const { recordCost, llmCost } = await import("../lib/costs");
  await recordCost({
    companyId, category: "llm",
    amountUsd: llmCost("claude-sonnet-4-6", resp.usage.input_tokens, resp.usage.output_tokens),
    meta: { job: "digest" },
  });

  const stats = {
    new_leads: leads?.length ?? 0,
    engaged: leads?.filter((l) => ["engaged", "handed_off", "qualified"].includes(l.status)).length ?? 0,
    callbacks: callbacks?.length ?? 0,
    by_status: (leads ?? []).reduce<Record<string, number>>(
      (a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {}
    ),
  };

  await supabaseAdmin.from("daily_summaries").upsert(
    { company_id: companyId, for_date: new Date().toISOString().slice(0, 10), content, stats },
    { onConflict: "company_id,for_date" }
  );

  return { content, stats, leads: leads?.length ?? 0 };
}

/**
 * Email the briefing to the people who should act on it.
 *
 * The digest was previously generated, stored, and never sent — a comment in the worker read
 * "Optional: also email the digest to owners", and it never happened. A briefing nobody
 * receives is a briefing nobody reads: the whole promise is that the team walks in at 8:30
 * to a written summary, not that they remember to open a dashboard.
 */
export async function emailDigest(companyId: string, content: string, stats: any) {
  const { data: recipients } = await supabaseAdmin
    .from("memberships").select("email")
    .eq("company_id", companyId).in("role", ["owner", "admin"]);

  const to = (recipients ?? []).map((r: any) => r.email).filter(Boolean);
  if (!to.length) return { sent: 0 };

  const { data: co } = await supabaseAdmin
    .from("companies").select("name").eq("id", companyId).single();

  const { Resend } = await import("resend");
  const resend = new Resend(env.RESEND_API_KEY);

  const subject =
    `${stats.new_leads} lead${stats.new_leads === 1 ? "" : "s"} overnight` +
    (stats.callbacks ? ` · ${stats.callbacks} callback${stats.callbacks === 1 ? "" : "s"} booked` : "");

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `${co?.name ?? "realtyAI"} — ${subject}`,
    text: `${content}\n\n—\nOpen the dashboard: ${env.WEB_URL}/today\n`,
  });
  if (error) throw new Error(error.message);

  return { sent: to.length, to };
}
