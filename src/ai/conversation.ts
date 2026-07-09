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
  let system = await buildSystemPrompt(convo.company_id, lead?.project_id ?? null, convo.channel);

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
  return {
    text: text.replace(/\[HANDOFF\]|\[OPTOUT\]/g, "").trim(),
    handoff: text.includes("[HANDOFF]"),
    optout: text.includes("[OPTOUT]"),
  };
}
