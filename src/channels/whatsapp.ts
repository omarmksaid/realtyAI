import twilio from "twilio";
import { ChannelAdapter, OutboundContext, SendResult } from "./types";
import { env } from "../lib/env";

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/**
 * WhatsApp rules that shape this adapter:
 * - Business-initiated messages MUST use a pre-approved template (contentSid).
 *   Free-form text is only allowed inside the 24h session after the lead replies.
 * - So: first touch = template with variables; everything after = AI free-form.
 * Template example to submit for approval:
 *   "Hi {{1}}, thanks for your interest in {{2}}! I'm the assistant for {{3}}.
 *    Want the floor plans and pricing, or have a question I can answer now?"
 */
export const whatsappAdapter: ChannelAdapter = {
  name: "whatsapp",

  canReach: (lead) => !!lead.phone && !lead.opted_out,

  async send(ctx: OutboundContext): Promise<SendResult> {
    try {
      const to = `whatsapp:${ctx.lead.phone}`;

      // Per-company number and templates. This used to fall back to the platform's own
      // TWILIO_WHATSAPP_NUMBER when a company wasn't provisioned — which is a real
      // multi-tenant bug, not untidiness: an unprovisioned brokerage's leads would receive
      // WhatsApps from OUR number, and their replies would land in a webhook we can't
      // attribute to them. A workspace that isn't provisioned must not send at all.
      const { supabaseAdmin } = await import("../lib/supabase");
      const { data: co } = await supabaseAdmin
        .from("companies").select("settings")
        .eq("id", ctx.lead.company_id).single();
      const settings = (co?.settings ?? {}) as any;

      // Single-tenant fallback stays available for the platform's own dev/demo workspace,
      // but only when explicitly opted in — never as a silent default for a real customer.
      const whatsappNumber = settings.whatsapp_number
        ?? (settings.use_platform_number ? env.TWILIO_WHATSAPP_NUMBER : null);
      if (!whatsappNumber) {
        return { ok: false, error: "This workspace has no WhatsApp number. Buy one in Settings." };
      }

      // A template SID belongs to the sender's Meta account — it can't be shared across
      // brokerages. Fall back to the platform template only alongside the platform number.
      const firstTouchSid = settings.first_touch_template_sid
        ?? (settings.use_platform_number ? env.TWILIO_FIRST_TOUCH_TEMPLATE_SID : null);
      const reengageSid = settings.reengage_template_sid
        ?? (settings.use_platform_number ? env.TWILIO_REENGAGE_TEMPLATE_SID : null)
        ?? firstTouchSid;

      const from = `whatsapp:${whatsappNumber}`;
      const statusCallback = `${env.APP_URL}/webhooks/twilio/status`; // sent/delivered/read receipts

      // 24h session rule: free-form is only allowed within 24h of the lead's last
      // inbound message. Outside the window, Twilio rejects (63016) — so we check
      // first and fall back to the approved re-engagement template.
      let inSession = ctx.isFirstTouch ? false : true;
      if (!ctx.isFirstTouch) {
        const { supabaseAdmin } = await import("../lib/supabase");
        const { data: last } = await supabaseAdmin
          .from("messages")
          .select("created_at, conversations!inner(lead_id, channel)")
          .eq("direction", "inbound")
          .eq("conversations.lead_id", ctx.lead.id)
          .eq("conversations.channel", "whatsapp")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        inSession = !!last && Date.now() - new Date((last as any).created_at).getTime() < 24 * 3600 * 1000;
      }

      const needsTemplate = ctx.isFirstTouch || !inSession;
      if (needsTemplate && !firstTouchSid) {
        return {
          ok: false,
          error: "No approved WhatsApp template for this workspace. Business-initiated " +
                 "WhatsApp must use one — submit it to Meta and save its SID in Settings.",
        };
      }

      // The brokerage's own name, not the platform's. env.BROKERAGE_NAME is global — every
      // tenant's template would have introduced the AI as the same company.
      const { data: coName } = await supabaseAdmin
        .from("companies").select("name").eq("id", ctx.lead.company_id).single();
      const brokerageName = coName?.name || env.BROKERAGE_NAME;

      const msg = needsTemplate
        ? await client.messages.create({
            to, from, statusCallback,
            contentSid: ctx.isFirstTouch ? firstTouchSid! : reengageSid!,
            contentVariables: JSON.stringify({
              "1": ctx.lead.full_name?.split(" ")[0] ?? "there",
              "2": ctx.projectName || "the project",
              "3": brokerageName,
            }),
          })
        : await client.messages.create({ to, from, statusCallback, body: ctx.body ?? "" });

      const { recordCost, RATES } = await import("../lib/costs");
      const isTemplate = ctx.isFirstTouch || !inSession;
      await recordCost({
        companyId: ctx.lead.company_id, conversationId: ctx.conversationId, leadId: ctx.lead.id,
        category: "whatsapp", amountUsd: isTemplate ? RATES.WA_TEMPLATE : RATES.WA_MSG,
        meta: { kind: isTemplate ? "template" : "session" },
      });
      return { ok: true, providerMessageId: msg.sid };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },
};
