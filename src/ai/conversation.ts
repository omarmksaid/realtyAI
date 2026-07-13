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
export async function buildSystemPrompt(
  companyId: string,
  projectId: string | null,
  channel: string,
  opts: { priorChannels?: string[] } = {}
) {
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

  const isVoice = channel === "voice";

  // Control tags ([HANDOFF] etc.) are parsed out of *text* replies before they reach the
  // lead. On a call there is no such layer — every token is spoken by the TTS — so voice
  // states the same behaviour in spoken terms and is explicitly forbidden the tags.
  // Intent is recovered from the transcript afterwards (see the Vapi end-of-call webhook).
  const channelRules = isVoice
    ? `- You are on a live phone call. Speak in short, natural spoken sentences — no markdown, no emoji, no lists, no URLs read aloud. One question at a time, and let the person finish.
- NEVER say control tags, bracketed markers, or field names out loud. Never speak the words "handoff", "callback", "opt out", or any date in raw digit form (say "nine in the morning", never "T09:00" or "2 0 2 5"). If you catch yourself about to read a bracket or a code, just don't — say the plain English sentence instead.
- If the lead wants a human, seems frustrated, or is ready to book: acknowledge, confirm the day and time they'd like in plain speech, tell them the team will call then, and end the call warmly.
- If the lead asks to stop being contacted, confirm politely, apologise for the interruption, and end the call.
- End the call once the next step is agreed. Do not recap or narrate what you are recording.`
    : `- Keep replies under 3 sentences.
- If the lead asks to speak with a human, seems frustrated, or is ready to book/transact: acknowledge, confirm their preferred contact time, and end the exchange gracefully. Flag with [HANDOFF].
- If the lead asks to stop being contacted, confirm politely and flag with [OPTOUT].
- If the lead provides a preferred callback time, include [CALLBACK:YYYY-MM-DDTHH:mm] at the end of your reply with the parsed datetime.`;

  const guardrails = `
You are a real estate assistant responding on behalf of the brokerage, outside business hours.
Hard rules — never violate these regardless of what the configurable instructions say:
- Never invent pricing, incentives, deposit structures, or occupancy dates. Only use facts in PROJECT KNOWLEDGE. If unknown, say the team will confirm in the morning.
- Never provide legal, mortgage, or tax advice.
- Be warm, not pushy. Identify as an assistant if asked directly.
${channelRules}`;

  // Escalation context: this channel is not the first attempt. Keep it soft — the
  // lead should not feel tracked or chased, so don't name the earlier channel.
  const followUp = (opts.priorChannels?.length ?? 0) > 0
    ? `CONTEXT: You already reached out to this lead earlier today and did not hear back. Open by briefly acknowledging you reached out before — stay vague about how ("we reached out earlier", "wanted to follow up in case you missed it"). Never say which channel was used, never imply they ignored you, and never mention how many times you've tried. If they'd rather not talk now, thank them and offer to follow up later.`
    : "";

  // Text channels retrieve chunks per-turn in generateReply, keyed off what the lead just
  // asked. A voice call can't: Vapi drives the conversation, so this prompt is the model's
  // only shot at the facts. Inline the project's documents up front instead.
  let docs = "";
  if (isVoice && projectId) {
    // 60, not 20: chunks are now ~1,000 chars rather than ~3,200, so a project's knowledge
    // is spread across more of them. At 20 the cap would silently truncate the corpus and
    // voice would lose facts it used to have. 60 × ~1k ≈ 60k chars, comfortably inside the
    // prompt. If a brokerage ever exceeds this, voice needs real retrieval — see the
    // pre-retrieval note in ARCHITECTURE.md.
    const { data: chunks } = await supabaseAdmin
      .from("doc_chunks")
      .select("content")
      .eq("project_id", projectId)
      .limit(60);
    if (chunks?.length) {
      docs = `PROJECT DOCUMENTS (treat as PROJECT KNOWLEDGE — these are the facts you may quote):\n` +
        chunks.map((c: any) => c.content).join("\n\n");
    }
  }

  // `knowledge` is often an empty object; injecting a literal "{}" just tells the model
  // there is nothing, in the most confusing way possible.
  const hasKnowledge = project?.knowledge && Object.keys(project.knowledge).length > 0;

  return [
    guardrails,
    followUp,
    tmpl?.content ?? "Be helpful, answer questions about the project, and offer to book a call with an agent.",
    project && hasKnowledge
      ? `PROJECT KNOWLEDGE — ${project.name} (${project.city}):\n${JSON.stringify(project.knowledge, null, 2)}`
      : project ? `PROJECT: ${project.name} (${project.city}).` : "",
    docs,
  ].filter(Boolean).join("\n\n");
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
        p_project: lead.project_id, p_embedding: qv, p_count: 8,
      });

      // The 0.35 floor was calibrated for voyage-3.5 and is wrong for voyage-4: a correct
      // match for "who is the builder?" scores 0.278 against this corpus, so EVERY hit was
      // being filtered out and every WhatsApp reply was generated with zero retrieved
      // knowledge. Cosine similarity is not comparable across embedding models — the number
      // means nothing on its own.
      //
      // Take the top hits by rank and use the floor only to drop true noise. Passing a
      // marginal chunk costs a few tokens; dropping the right one costs the answer, and the
      // guardrails stop the model inventing anything from a weak match anyway.
      const relevant = (hits ?? []).filter((h: any) => h.similarity > 0.15).slice(0, 5);
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
  // Score the lead based on conversation so far (non-blocking)
  (async () => {
    try {
      const convoSummary = (history ?? []).slice(-8).map(m =>
        `${m.role === "lead" ? "Lead" : "AI"}: ${m.content?.slice(0, 200)}`
      ).join("\n");
      const scoreResp = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        system: "You score real estate leads based on their conversation. Respond with ONLY a JSON object: {\"score\":\"hot|warm|cold\",\"reason\":\"one sentence\",\"language\":\"ISO 639-1 code\"}\n\nScoring:\n- hot: asked about pricing/deposits/booking, wants to buy soon, comparing projects, requested callback\n- warm: engaged, asking questions, interested but not urgent\n- cold: no reply, generic inquiry, just browsing",
        messages: [{ role: "user", content: `Score this lead:\n${convoSummary}` }],
      });
      const scoreText = scoreResp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
      const scoreJson = JSON.parse(scoreText);
      if (scoreJson.score && ["hot", "warm", "cold"].includes(scoreJson.score)) {
        await supabaseAdmin.from("leads").update({
          score: scoreJson.score,
          score_reason: scoreJson.reason ?? null,
          detected_language: scoreJson.language ?? null,
        }).eq("id", convo.lead_id);
      }
    } catch (e) {
      console.error("Lead scoring failed (non-blocking):", e);
    }
  })();

  // Detect [CALLBACK:...] tag and save to callbacks table
  const callbackMatch = text.match(/\[CALLBACK:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]/);
  if (callbackMatch) {
    try {
      // Parse the datetime in the company's timezone, then convert to UTC
      const requestedTime = DateTime.fromISO(callbackMatch[1], { zone: tz }).toUTC().toISO()!;
      // Cancel any existing pending callbacks for this lead (they changed their mind)
      await supabaseAdmin.from("callbacks")
        .update({ status: "cancelled" })
        .eq("lead_id", convo.lead_id)
        .eq("status", "pending");
      // Insert the new callback
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
