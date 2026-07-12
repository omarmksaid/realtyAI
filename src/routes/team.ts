import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { Resend } from "resend";
import twilio from "twilio";
import { supabaseAdmin } from "../lib/supabase";
import { verifyJwt } from "../lib/auth";
import { env } from "../lib/env";

const resend = new Resend(env.RESEND_API_KEY);
const tw = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/* ============ Protected team routes (requireAuth mounted in index.ts) ============ */
export const teamRoutes = new Hono();

teamRoutes.get("/", async (c) => {
  const { data } = await supabaseAdmin
    .from("memberships").select("user_id, email, role, phone, on_call")
    .eq("company_id", c.get("companyId"));
  // Include expired invites. Filtering them out hid exactly the ones worth acting on —
  // you can't resend an invite you can't see. The UI marks them expired instead.
  const { data: pending } = await supabaseAdmin
    .from("invites").select("email, role, expires_at")
    .eq("company_id", c.get("companyId")).is("accepted_at", null);
  return c.json({ members: data ?? [], pending: pending ?? [] });
});

/** The invite email. WEB_URL, not APP_URL — /join is a page in the dashboard; built from
 *  APP_URL it pointed at this API, which has no such route, and every invite 404'd. */
async function sendInviteEmail(companyId: any, email: string, token: string) {
  const { data: co } = await supabaseAdmin
    .from("companies").select("name").eq("id", companyId).single();
  const link = `${env.WEB_URL}/join?token=${token}`;
  await resend.emails.send({
    from: env.EMAIL_FROM, to: email,
    subject: `Join ${co?.name} on realtyAI`,
    text: `You've been invited to ${co?.name}'s realtyAI workspace.\n\nAccept here (link expires in 7 days):\n${link}\n\nDuring signup you can add your mobile number to receive hot-lead texts when you're on call.`,
  });
}

/** Invite by email: creates a one-time link and sends it via Resend. Admin only. */
teamRoutes.post("/invites", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const companyId = c.get("companyId");
  const { email, role } = await c.req.json();
  if (!email) return c.json({ error: "email required" }, 400);

  const token = randomBytes(24).toString("base64url");
  const { error } = await supabaseAdmin.from("invites").insert({
    company_id: companyId, email, role: role ?? "agent", token, invited_by: c.get("userId"),
  });
  if (error) return c.json({ error: error.message }, 500);

  await sendInviteEmail(companyId, email, token);
  return c.json({ ok: true });
});

/** Resend a pending invite. Mints a fresh token and pushes the expiry out — the usual
 *  reason to resend is that the old link expired or never arrived, so reusing the dead
 *  token would just fail again. */
teamRoutes.post("/invites/resend", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const companyId = c.get("companyId");
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "email required" }, 400);

  // Not .maybeSingle(): inviting the same email twice leaves two pending rows, and
  // maybeSingle THROWS on multiple matches — resend then reported "no pending invite"
  // for an invite that plainly existed. Take the newest.
  const { data: invites } = await supabaseAdmin
    .from("invites").select("id")
    .eq("company_id", companyId).eq("email", email).is("accepted_at", null)
    .order("created_at", { ascending: false }).limit(1);
  const invite = invites?.[0];
  if (!invite) return c.json({ error: "No pending invite for that email." }, 404);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { error } = await supabaseAdmin.from("invites")
    .update({ token, expires_at: expiresAt }).eq("id", invite.id);
  if (error) return c.json({ error: error.message }, 500);

  await sendInviteEmail(companyId, email, token);
  return c.json({ ok: true });
});

/** Revoke a pending invite. */
teamRoutes.delete("/invites", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const email = c.req.query("email");
  if (!email) return c.json({ error: "email required" }, 400);

  const { error } = await supabaseAdmin.from("invites").delete()
    .eq("company_id", c.get("companyId")).eq("email", email).is("accepted_at", null);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

/** Toggle on-call / update phone for a member (self, or admin for anyone). */
teamRoutes.patch("/members/:userId", async (c) => {
  const target = c.req.param("userId");
  if (target !== c.get("userId") && c.get("role") === "agent")
    return c.json({ error: "admin required" }, 403);
  const { on_call, phone } = await c.req.json();
  const patch: any = {};
  if (typeof on_call === "boolean") patch.on_call = on_call;
  if (phone !== undefined) patch.phone = phone; // E.164; validate client-side + Twilio Lookup later
  await supabaseAdmin.from("memberships").update(patch)
    .eq("company_id", c.get("companyId")).eq("user_id", target);
  return c.json({ ok: true });
});

/* ============ Public accept (JWT-verified, but no membership yet — that's the point) ============ */

export async function acceptInvite(c: any) {
  const header = c.req.header("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!jwt) return c.json({ error: "Sign up first, then accept with your session." }, 401);

  let userId: string, userEmail: string;
  try {
    // verifyJwt from lib/auth tries JWKS (ES256) before falling back to HMAC. This file
    // used to carry its own HMAC-only copy, so on an ES256 Supabase project every accept
    // failed with "invalid token" — the sign-up succeeded and the membership never landed.
    const result = await verifyJwt(jwt);
    userId = result.sub;
    userEmail = result.email ?? "";
  } catch {
    return c.json({ error: "Your sign-in session isn't valid. Please try again." }, 401);
  }

  const { token, phone, on_call } = await c.req.json();
  if (!token) return c.json({ error: "This invite link is missing its token." }, 400);

  // Not .single(): a duplicate invite for the same email would make it throw. Take the
  // newest valid one.
  const { data: invites } = await supabaseAdmin
    .from("invites").select("*").eq("token", token)
    .is("accepted_at", null).gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const invite = invites?.[0];
  if (!invite) {
    return c.json({ error: "This invite link has expired or already been used. Ask for a new one." }, 400);
  }

  await supabaseAdmin.from("memberships").upsert({
    user_id: userId, company_id: invite.company_id, role: invite.role,
    email: userEmail || invite.email, phone: phone ?? null, on_call: !!on_call && !!phone,
  });
  await supabaseAdmin.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
  return c.json({ ok: true, companyId: invite.company_id });
}

/* ============ Hot-lead SMS ============ */
/** Text everyone on call for this company. Fired on [HANDOFF] and (later) hot-score events.
 *  Throttled per lead so a chatty conversation doesn't re-page the team. */
export async function notifyOnCall(companyId: string, leadId: string, leadName: string, projectName: string, reason: string) {
  const { data: already } = await supabaseAdmin
    .from("audit_log").select("id").eq("company_id", companyId)
    .eq("action", "oncall.paged").contains("detail", { lead_id: leadId }).limit(1);
  if (already?.length) return; // one page per lead

  const { data: onCall } = await supabaseAdmin
    .from("memberships").select("phone").eq("company_id", companyId)
    .eq("on_call", true).not("phone", "is", null);
  if (!onCall?.length) return;

  const body = `realtyAI — hot lead: ${leadName} (${projectName}). ${reason} Open: ${env.WEB_URL}/conversations/${leadId}`;
  for (const m of onCall) {
    try {
      await tw.messages.create({ to: m.phone!, from: env.TWILIO_WHATSAPP_NUMBER, body });
    } catch (e) { console.error("on-call SMS failed", m.phone, e); }
  }
  const { recordCost, RATES } = await import("../lib/costs");
  await recordCost({ companyId, leadId, category: "sms",
    amountUsd: onCall.length * RATES.SMS, meta: { recipients: onCall.length } });
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, action: "oncall.paged",
    detail: { lead_id: leadId, reason, notified: onCall.length },
  });
}
