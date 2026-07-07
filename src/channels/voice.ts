import { ChannelAdapter, OutboundContext, SendResult } from "./types";
import { env } from "../lib/env";

/**
 * Outbound AI voice call. Recommendation: use Vapi or Retell on top of Twilio
 * rather than raw Twilio <Gather>/TTS — you get sub-second latency, barge-in,
 * turn-taking, and a transcript webhook out of the box. Twilio ConversationRelay
 * is the DIY alternative if you want everything in one vendor.
 *
 * Vapi flow: POST /call with assistant config (system prompt injected from your
 * prompt_templates table) -> Vapi dials via your Twilio number -> end-of-call
 * webhook delivers transcript + recording URL -> we store into calls/messages.
 */
export const voiceAdapter: ChannelAdapter = {
  name: "voice",

  canReach: (lead) => !!lead.phone && !lead.opted_out,

  async send(ctx: OutboundContext): Promise<SendResult> {
    try {
      // Per-company voice + number: chosen in dashboard Settings, stored in companies.settings
      const { supabaseAdmin } = await import("../lib/supabase");
      const { data: co } = await supabaseAdmin
        .from("companies").select("settings").eq("id", ctx.lead.company_id).single();
      const voice = (co?.settings as any)?.voice ?? { provider: "11labs", voice_id: env.DEFAULT_VOICE_ID };
      const phoneNumberId = (co?.settings as any)?.vapi_phone_id ?? env.VAPI_PHONE_NUMBER_ID;

      const res = await fetch("https://api.vapi.ai/call", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumberId,
          customer: { number: ctx.lead.phone },
          assistant: {
            firstMessage: `Hi, is this ${ctx.lead.full_name?.split(" ")[0] ?? "the person"} who just asked about ${ctx.projectName}?`,
            model: {
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              messages: [{ role: "system", content: ctx.body ?? "" }], // assembled prompt
            },
            voice: { provider: voice.provider, voiceId: voice.voice_id },
            transcriber: { provider: "deepgram", language: "multi" },
            voicemailDetection: { provider: "twilio" },
            voicemailMessage: `Hi, it's the team about ${ctx.projectName} — I've sent you the details on WhatsApp. Talk soon!`,
            maxDurationSeconds: 600,
            endCallFunctionEnabled: true,
            recordingEnabled: true,
            metadata: { conversationId: ctx.conversationId, leadId: ctx.lead.id },
          },
        }),
      });
      if (!res.ok) return { ok: false, error: `Vapi ${res.status}: ${await res.text()}` };
      const data = await res.json();
      return { ok: true, providerMessageId: data.id };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },
};
