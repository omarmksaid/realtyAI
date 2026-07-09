import { Hono } from "hono";
import twilio from "twilio";
import { env } from "../../lib/env";
import { supabaseAdmin } from "../../lib/supabase";
import { generateReply } from "../../ai/conversation";
import { getChannel } from "../../channels/types";
import { boss } from "../../jobs/queue";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/** Download Twilio-hosted media (basic-auth) and, for images, extract facts with Claude vision. */
async function describeInboundMedia(url: string, contentType: string): Promise<string> {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) return "[attachment could not be retrieved]";
  if (!/^image\/(png|jpe?g|webp)/.test(contentType)) return `[${contentType} attachment]`;
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 600,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: contentType.split(";")[0] as any, data: b64 } },
      { type: "text", text: "A real-estate lead sent this image in a chat. Describe it factually and extract any text/numbers (it may be a floor plan, price sheet, listing screenshot, or competitor brochure). 4 sentences max." },
    ]}],
  });
  return resp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
}

export const inboundWebhooks = new Hono();

/* Lead replied on WhatsApp -> store, cancel pending escalations, AI responds. */
inboundWebhooks.post("/twilio/whatsapp", async (c) => {
  const form = await c.req.parseBody();
  // Signature validation — skip in sandbox/dev when URL mismatch is expected
  const sig = c.req.header("x-twilio-signature") ?? "";
  if (sig) {
    const valid = twilio.validateRequest(
      env.TWILIO_AUTH_TOKEN, sig,
      `${env.APP_URL}/webhooks/twilio/whatsapp`,
      form as Record<string, string>
    );
    if (!valid) console.warn("Twilio signature mismatch (sandbox?)");
  }

  const phone = String(form.From).replace("whatsapp:", "");
  let text = String(form.Body ?? "").trim();

  // Leads send photos (competitor brochures, listings). Fold a vision description
  // into the message so the AI can actually respond to what they sent.
  const numMedia = Number(form.NumMedia ?? 0);
  let mediaUrls: string[] = [];
  for (let m = 0; m < Math.min(numMedia, 3); m++) {
    const url = String(form[`MediaUrl${m}`]);
    mediaUrls.push(url);
    const desc = await describeInboundMedia(url, String(form[`MediaContentType${m}`] ?? ""));
    text = `${text}\n[Lead sent an image: ${desc}]`.trim();
  }
  if (!text) return c.text("ok");

  console.log("WhatsApp inbound from", phone, "text:", text.slice(0, 100));

  const { data: lead } = await supabaseAdmin
    .from("leads").select("id, company_id, opted_out")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(1).single();
  if (!lead) { console.log("No lead found for phone", phone); return c.text("ok"); }

  // STOP handling (compliance)
  if (/^(stop|unsubscribe|opt out)$/i.test(text)) {
    await supabaseAdmin.from("leads").update({ opted_out: true, status: "opted_out" }).eq("id", lead.id);
    return c.text("ok");
  }

  // Lead engaged -> cancel any scheduled call/email escalations
  await boss.cancel("outreach", `${lead.id}:voice`).catch(() => {});
  await boss.cancel("outreach", `${lead.id}:email`).catch(() => {});

  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .upsert(
      { company_id: lead.company_id, lead_id: lead.id, channel: "whatsapp", status: "active" },
      { onConflict: "lead_id,channel" } // add a unique index for this in a follow-up migration
    )
    .select().single();

  await supabaseAdmin.from("messages").insert({
    company_id: lead.company_id, conversation_id: convo!.id,
    direction: "inbound", role: "lead", content: text,
    meta: mediaUrls.length ? { media_urls: mediaUrls } : {},
  });
  await supabaseAdmin.from("leads").update({ status: "engaged" }).eq("id", lead.id);
  {
    const { recordCost, RATES } = await import("../../lib/costs");
    await recordCost({ companyId: lead.company_id, conversationId: convo!.id, leadId: lead.id,
      category: "whatsapp", amountUsd: RATES.WA_MSG, meta: { kind: "inbound" } });
  }

  // Billing gate: trial expired / cancelled -> store the message, no AI reply.
  const { automationActive } = await import("../../lib/billing");
  const { data: co } = await supabaseAdmin
    .from("companies").select("plan, billing_status, trial_ends_at").eq("id", lead.company_id).single();
  if (!co || !automationActive(co as any)) { console.log("Automation inactive for", lead.company_id); return c.text("ok"); }

  console.log("Generating AI reply for conversation", convo!.id);
  const reply = await generateReply(convo!.id);

  if (reply.optout) {
    await supabaseAdmin.from("leads").update({ opted_out: true, status: "opted_out" }).eq("id", lead.id);
  }
  if (reply.handoff) {
    await supabaseAdmin.from("conversations").update({ status: "handed_off" }).eq("id", convo!.id);
    await supabaseAdmin.from("leads").update({ status: "handed_off" }).eq("id", lead.id);
    const { notifyOnCall } = await import("../team");
    const { data: full } = await supabaseAdmin
      .from("leads").select("full_name, projects(name)").eq("id", lead.id).single();
    await notifyOnCall(lead.company_id, lead.id, full?.full_name ?? "Lead",
      (full?.projects as any)?.name ?? "a project", "Wants to talk to a person.");
  }

  const wa = getChannel("whatsapp")!;
  const sent = await wa.send({
    lead: lead as any, conversationId: convo!.id,
    projectName: "", isFirstTouch: false, body: reply.text,
  });
  console.log("AI reply:", reply.text?.slice(0, 100), "sent:", sent.ok, sent.error ?? "");
  await supabaseAdmin.from("messages").insert({
    company_id: lead.company_id, conversation_id: convo!.id,
    direction: "outbound", role: "ai", content: reply.text,
    provider_message_id: sent.providerMessageId,
  });
  return c.text("ok");
});

/* Delivery receipts: Twilio POSTs status transitions (sent/delivered/read/failed).
   We stamp them onto the original outbound message row -> read receipts in the UI. */
inboundWebhooks.post("/twilio/status", async (c) => {
  const form = await c.req.parseBody();
  const valid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    c.req.header("x-twilio-signature") ?? "",
    `${env.APP_URL}/webhooks/twilio/status`,
    form as Record<string, string>
  );
  if (!valid) return c.text("bad signature", 401);

  const sid = String(form.MessageSid ?? "");
  const status = String(form.MessageStatus ?? ""); // queued|sent|delivered|read|failed|undelivered
  const { data: msg } = await supabaseAdmin
    .from("messages").select("id, meta").eq("provider_message_id", sid).maybeSingle();
  if (msg) {
    await supabaseAdmin.from("messages")
      .update({ meta: { ...(msg.meta ?? {}), status, ...(status === "failed" ? { error_code: form.ErrorCode } : {}) } })
      .eq("id", msg.id);
  }
  return c.text("ok");
});

/* Vapi end-of-call report -> store transcript + recording. */
inboundWebhooks.post("/vapi", async (c) => {
  if (c.req.header("x-vapi-secret") !== env.VAPI_WEBHOOK_SECRET) return c.text("forbidden", 403);
  const { message } = await c.req.json();
  if (message?.type !== "end-of-call-report") return c.text("ok");

  const { conversationId } = message.call?.assistant?.metadata ?? message.call?.metadata ?? {};
  if (!conversationId) return c.text("ok");

  const { data: convo } = await supabaseAdmin
    .from("conversations").select("id, company_id").eq("id", conversationId).single();
  if (!convo) return c.text("ok");

  await supabaseAdmin.from("calls").insert({
    company_id: convo.company_id, conversation_id: convo.id,
    provider_call_id: message.call?.id,
    recording_url: message.recordingUrl,
    duration_sec: Math.round(message.durationSeconds ?? 0),
    outcome: message.endedReason,
  });
  {
    const { recordCost, RATES } = await import("../../lib/costs");
    const actual = typeof message.cost === "number" ? message.cost : null;
    const mins = (message.durationSeconds ?? 0) / 60;
    await recordCost({
      companyId: convo.company_id, conversationId: convo.id, category: "voice",
      amountUsd: actual ?? mins * RATES.VOICE_PER_MIN,
      meta: { minutes: +mins.toFixed(2), source: actual != null ? "vapi_actual" : "estimate" },
    });
  }
  // Store transcript turns as messages so the dashboard renders every channel the same way
  for (const turn of message.artifact?.messages ?? []) {
    if (turn.role !== "user" && turn.role !== "bot") continue;
    await supabaseAdmin.from("messages").insert({
      company_id: convo.company_id, conversation_id: convo.id,
      direction: turn.role === "user" ? "inbound" : "outbound",
      role: turn.role === "user" ? "lead" : "ai",
      content: turn.message, meta: { seconds: turn.secondsFromStart },
    });
  }
  await supabaseAdmin.from("conversations").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", convo.id);
  return c.text("ok");
});
