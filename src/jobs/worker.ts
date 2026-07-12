import Anthropic from "@anthropic-ai/sdk";
import { boss } from "./queue";
import { supabaseAdmin } from "../lib/supabase";
import { getChannel, registerChannel } from "../channels/types";
import { whatsappAdapter } from "../channels/whatsapp";
import { emailAdapter } from "../channels/email";
import { voiceAdapter } from "../channels/voice";
import { buildSystemPrompt } from "../ai/conversation";
import { env } from "../lib/env";
import { registerIngest } from "./ingest";

registerChannel(whatsappAdapter);
registerChannel(emailAdapter);
registerChannel(voiceAdapter);

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export async function startWorker() {
  await boss.start();

  /* ------- outreach: one job per (lead, channel) ------- */
  await boss.createQueue("outreach");
  await boss.work("outreach", async ([job]) => {
    const { leadId, channel } = job.data as { leadId: string; channel: string };

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("*, projects(name)")
      .eq("id", leadId).single();
    if (!lead || lead.opted_out) return;

    // Escalation guard: if the lead already replied on any channel, skip.
    if (["engaged", "handed_off", "qualified"].includes(lead.status)) return;

    const adapter = getChannel(channel);
    if (!adapter || !adapter.canReach(lead)) return;

    // Channels already tried for this lead. A later channel in the escalation
    // ladder uses this to acknowledge the earlier attempt rather than open cold.
    const { data: priorConvos } = await supabaseAdmin
      .from("conversations")
      .select("channel")
      .eq("lead_id", lead.id);
    const priorChannels = (priorConvos ?? [])
      .map((c: any) => c.channel)
      .filter((c: string) => c !== channel);

    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .insert({ company_id: lead.company_id, lead_id: lead.id, channel })
      .select().single();

    const projectName = (lead.projects as any)?.name ?? "the project";
    // Voice gets the assembled system prompt as its assistant instructions
    const body = channel === "voice"
      ? await buildSystemPrompt(lead.company_id, lead.project_id, "voice", { priorChannels })
      : undefined;

    const result = await adapter.send({
      lead, conversationId: convo!.id, projectName,
      isFirstTouch: true, body, priorChannels,
    });

    await supabaseAdmin.from("messages").insert({
      company_id: lead.company_id, conversation_id: convo!.id,
      direction: "outbound", role: "ai",
      content: channel === "voice" ? "[Outbound AI call initiated]" : `[First-touch ${channel} sent]`,
      provider_message_id: result.providerMessageId,
      meta: { ok: result.ok, error: result.error },
    });
    if (result.ok && lead.status === "new") {
      await supabaseAdmin.from("leads").update({ status: "contacted" }).eq("id", lead.id);
    }
    if (!result.ok) throw new Error(result.error); // pg-boss retries with backoff
  });

  /* ------- morning digest: 8:30am company-local ------- */
  await boss.createQueue("morning-digest");
  await boss.schedule("morning-digest", "30 8 * * *", {}, { tz: "America/Toronto" });
  await boss.work("morning-digest", async () => {
    const { data: companies } = await supabaseAdmin
      .from("companies").select("id, name, plan, billing_status, trial_ends_at");
    const { automationActive } = await import("../lib/billing");
    for (const co of companies ?? []) {
      if (!automationActive(co as any)) continue;
      const since = new Date(Date.now() - 16 * 3600 * 1000).toISOString(); // ~5pm yesterday

      const { data: leads } = await supabaseAdmin
        .from("leads").select("id, full_name, status, projects(name)")
        .eq("company_id", co.id).gte("created_at", since);

      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("content, role, conversation_id, conversations(channel, lead_id)")
        .eq("company_id", co.id).gte("created_at", since)
        .order("created_at").limit(500);

      if (!leads?.length && !msgs?.length) continue;

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system:
          "You write a morning briefing for a real estate team about overnight lead activity. " +
          "For each lead: name, project, what they asked about, sentiment, and a recommended next action. " +
          "Lead with the hottest leads (asked about pricing, booking, deposits). Be concise and scannable.",
        messages: [{
          role: "user",
          content: `Overnight leads:\n${JSON.stringify(leads)}\n\nConversation turns:\n${JSON.stringify(msgs)}`,
        }],
      });
      const content = resp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
      const { recordCost, llmCost } = await import("../lib/costs");
      await recordCost({ companyId: co.id, category: "llm",
        amountUsd: llmCost("claude-sonnet-4-6", resp.usage.input_tokens, resp.usage.output_tokens),
        meta: { job: "digest" } });

      const stats = {
        new_leads: leads?.length ?? 0,
        engaged: leads?.filter(l => ["engaged", "handed_off", "qualified"].includes(l.status)).length ?? 0,
        by_status: Object.fromEntries(
          Object.entries(
            (leads ?? []).reduce<Record<string, number>>((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {})
          )
        ),
      };

      await supabaseAdmin.from("daily_summaries").upsert(
        { company_id: co.id, for_date: new Date().toISOString().slice(0, 10), content, stats },
        { onConflict: "company_id,for_date" }
      );
      // Optional: also email the digest to owners via emailAdapter here.
    }
  });

  await registerIngest(boss);

  /* ------- trial lifecycle: daily 9am check -> nudge + expiry emails ------- */
  await boss.createQueue("trial-check");
  await boss.schedule("trial-check", "0 9 * * *", {}, { tz: "America/Toronto" });
  await boss.work("trial-check", async () => {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
    const now = Date.now();
    const { data: trials } = await supabaseAdmin
      .from("companies").select("id, name, trial_ends_at")
      .eq("billing_status", "trial").not("trial_ends_at", "is", null);

    for (const co of trials ?? []) {
      const daysLeft = Math.ceil((new Date(co.trial_ends_at!).getTime() - now) / 86400_000);
      let subject: string | null = null, body = "";
      if (daysLeft === 3) {
        subject = `Your realtyAI trial ends in 3 days`;
        body = `Hi — your ${co.name} trial ends in 3 days. After that, leads keep arriving on your dashboard but automated responses pause. Reply to this email to pick a plan and keep the after-hours coverage running.`;
      } else if (daysLeft === 0) {
        subject = `Your realtyAI trial ends today`;
        body = `Your ${co.name} trial ends today. Your data, transcripts, and dashboard stay yours — automation pauses at midnight until a plan is active. Reply to this email and we'll get you set up in minutes.`;
      }
      if (!subject) continue;
      const { data: owners } = await supabaseAdmin
        .from("memberships").select("email").eq("company_id", co.id)
        .in("role", ["owner", "admin"]).not("email", "is", null);
      for (const o of owners ?? []) {
        await resend.emails.send({ from: env.EMAIL_FROM, to: o.email!, subject, text: body })
          .catch((e) => console.error("trial email failed", e));
      }
      await supabaseAdmin.from("audit_log").insert({
        company_id: co.id, action: "trial.notice_sent", detail: { days_left: daysLeft },
      });
    }
  });

  console.log("worker started");
}
