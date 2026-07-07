import { Resend } from "resend";
import { ChannelAdapter, OutboundContext, SendResult } from "./types";
import { env } from "../lib/env";

const resend = new Resend(env.RESEND_API_KEY);

export const emailAdapter: ChannelAdapter = {
  name: "email",

  canReach: (lead) => !!lead.email && !lead.opted_out,

  async send(ctx: OutboundContext): Promise<SendResult> {
    try {
      const first = ctx.lead.full_name?.split(" ")[0] ?? "there";
      const body =
        ctx.body ??
        `Hi ${first},\n\nThanks for your interest in ${ctx.projectName}. ` +
        `I've attached the latest project overview — reply to this email or ` +
        `message us on WhatsApp any time and we'll get you floor plans, pricing, ` +
        `and deposit structure right away.\n\n${env.BROKERAGE_NAME}`;

      // CASL: identification + functioning unsubscribe on every CEM.
      const footer =
        `\n\n—\n${env.BROKERAGE_NAME} · ${env.BROKERAGE_ADDRESS}\n` +
        `You're receiving this because you requested info via our ad. ` +
        `Reply STOP or click here to unsubscribe: ${env.APP_URL}/u/${ctx.lead.id}`;

      const { data, error } = await resend.emails.send({
        from: env.EMAIL_FROM, // e.g. "Yasmin at BrokerageName <hello@yourdomain.com>"
        to: ctx.lead.email!,
        subject: `${ctx.projectName} — the info you asked for`,
        text: body + footer,
        headers: { "List-Unsubscribe": `<${env.APP_URL}/u/${ctx.lead.id}>` },
      });
      if (error) return { ok: false, error: error.message };
      const { recordCost, RATES } = await import("../lib/costs");
      await recordCost({ companyId: ctx.lead.company_id, conversationId: ctx.conversationId,
        leadId: ctx.lead.id, category: "email", amountUsd: RATES.EMAIL });
      return { ok: true, providerMessageId: data?.id };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },
};
