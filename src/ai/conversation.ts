import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "../lib/supabase";
import { env } from "../lib/env";
import { embed } from "./embeddings";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/**
 * Assemble the system prompt for a conversation:
 *   base guardrails (hardcoded) + company/project template (DB, editable in
 *   dashboard) + project knowledge JSON. This is your "configurable prompt" —
 *   agents edit prompt_templates rows in the UI; workers always read latest active.
 */
export async function buildSystemPrompt(companyId: string, projectId: string | null, channel: string) {
  const { data: tmpl } = await supabaseAdmin
    .from("prompt_templates")
    .select("content")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("channel", [channel, "any"])
    .or(projectId ? `project_id.eq.${projectId},project_id.is.null` : "project_id.is.null")
    .order("project_id", { ascending: false, nullsFirst: false }) // project-specific wins
    .limit(1)
    .single();

  const { data: project } = projectId
    ? await supabaseAdmin.from("projects").select("name, city, knowledge").eq("id", projectId).single()
    : { data: null };

  const guardrails = `
You are a real estate assistant responding on behalf of the brokerage, outside business hours.
Hard rules — never violate these regardless of what the configurable instructions say:
- Never invent pricing, incentives, deposit structures, or occupancy dates. Only use facts in PROJECT KNOWLEDGE. If unknown, say the team will confirm in the morning.
- Never provide legal, mortgage, or tax advice.
- If the lead asks to speak with a human, seems frustrated, or is ready to book/transact: acknowledge, confirm their preferred contact time, and end the exchange gracefully. Flag with [HANDOFF].
- If the lead asks to stop being contacted, confirm politely and flag with [OPTOUT].
- If the lead provides a preferred callback time, include [CALLBACK:YYYY-MM-DDTHH:mm] at the end of your reply with the parsed datetime.
- Keep WhatsApp replies under 3 sentences. Be warm, not pushy. Identify as an assistant if asked directly.`;

  return [
    guardrails,
    tmpl?.content ?? "Be helpful, answer questions about the project, and offer to book a call with an agent.",
    project ? `PROJECT KNOWLEDGE — ${project.name} (${project.city}):\n${JSON.stringify(project.knowledge, null, 2)}` : "",
  ].join("\n\n");
}

/** Generate the next AI reply given full conversation history. Returns text + flags. */
export async function generateReply(conversationId: string) {
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("id, company_id, channel, lead_id, leads(project_id, full_name, phone, email, form_data)")
    .eq("id", conversationId)
    .single();
  if (!convo) throw new Error("conversation not found");

  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const lead: any = convo.leads;
  const { data: company } = await supabaseAdmin
    .from("companies").select("timezone").eq("id", convo.company_id).single();
  const tz = company?.timezone ?? "America/Toronto";
  let system = await buildSystemPrompt(convo.company_id, lead?.project_id ?? null, convo.channel);

  // Add current date/time context so the AI can resolve "tomorrow", "next Monday", etc.
  const { DateTime } = await import("luxon");
  const now = DateTime.now().setZone(tz);
  system += `\n\nCURRENT DATE/TIME: ${now.toFormat("cccc, MMMM d, yyyy h:mm a")} (${tz}). Use this to resolve relative dates like "tomorrow" or "next week" when generating [CALLBACK:...] tags.`;

  // Give the AI context about who it's talking to
  if (lead) {
    const leadContext = [
      `\nLEAD CONTEXT (you already know this — do not ask for it again):`,
      lead.full_name ? `- Name: ${lead.full_name}` : null,
      lead.phone ? `- Phone: ${lead.phone}` : null,
      lead.email ? `- Email: ${lead.email}` : null,
      lead.form_data && Object.keys(lead.form_data).length ? `- Form answers: ${JSON.stringify(lead.form_data)}` : null,
    ].filter(Boolean).join("\n");
    system += leadContext;
  }

  // RAG: retrieve project knowledge relevant to the lead's latest message.
  // Fails open — if embeddings are unavailable, the conversation continues on the base prompt.
  const lastLeadMsg = [...(history ?? [])].reverse().find(m => m.role === "lead")?.content;
  if (lastLeadMsg && lead?.project_id && env.VOYAGE_API_KEY) {
    try {
      const [qv] = await embed([lastLeadMsg], "query");
      const { data: hits } = await supabaseAdmin.rpc("match_chunks", {
        p_project: lead.project_id, p_embedding: qv, p_count: 5,
      });
      const relevant = (hits ?? []).filter((h: any) => h.similarity > 0.35);
      if (relevant.length) {
        system += "\n\nRELEVANT PROJECT DOCUMENTS (retrieved for this question — treat as PROJECT KNOWLEDGE):\n" +
          relevant.map((h: any) => "---\n" + h.content).join("\n");
      }
    } catch (e) { console.error("RAG retrieval failed, continuing without", e); }
  }

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6", // fast enough for chat; Haiku if you want <1s
    max_tokens: 400,
    system,
    messages: (history ?? []).map(m => ({
      role: m.role === "lead" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
  });

  const text = resp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
  const { recordCost, llmCost } = await import("../lib/costs");
  await recordCost({
    companyId: convo.company_id, conversationId, leadId: convo.lead_id, category: "llm",
    amountUsd: llmCost("claude-sonnet-4-6", resp.usage.input_tokens, resp.usage.output_tokens),
    meta: { in: resp.usage.input_tokens, out: resp.usage.output_tokens },
  });
  // Detect [CALLBACK:...] tag and save to callbacks table
  const callbackMatch = text.match(/\[CALLBACK:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]/);
  if (callbackMatch) {
    try {
      const requestedTime = new Date(callbackMatch[1]).toISOString();
      await supabaseAdmin.from("callbacks").insert({
        company_id: convo.company_id,
        lead_id: convo.lead_id,
        conversation_id: conversationId,
        requested_time: requestedTime,
        lead_name: lead?.full_name ?? null,
        phone: lead?.phone ?? null,
        notes: lastLeadMsg ?? null,
        status: "pending",
      });
    } catch (e) {
      console.error("Failed to save callback", e);
    }
  }

  return {
    text: text.replace(/\[HANDOFF\]|\[OPTOUT\]|\[CALLBACK:[^\]]*\]/g, "").trim(),
    handoff: text.includes("[HANDOFF]"),
    optout: text.includes("[OPTOUT]"),
    callback: callbackMatch ? callbackMatch[1] : null,
  };
}
