// Every outreach channel implements this interface. Adding SMS, iMessage,
// Instagram DM, etc. later = one new file + a registry entry. Nothing else changes.

export interface Lead {
  id: string;
  company_id: string;
  project_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  opted_out: boolean;
}

export interface OutboundContext {
  lead: Lead;
  conversationId: string;
  projectName: string;
  // For WhatsApp first-touch this must map to an approved template SID.
  isFirstTouch: boolean;
  body?: string; // AI-generated content for session replies / emails
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface ChannelAdapter {
  name: "whatsapp" | "voice" | "email" | string;
  /** Can this channel reach this lead at all? (has phone, has email, not opted out) */
  canReach(lead: Lead): boolean;
  send(ctx: OutboundContext): Promise<SendResult>;
}

const registry = new Map<string, ChannelAdapter>();
export const registerChannel = (a: ChannelAdapter) => registry.set(a.name, a);
export const getChannel = (name: string) => registry.get(name);
