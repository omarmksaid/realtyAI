import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getChannel } from "../channels/types";

/**
 * Authenticated agent API, called by the dashboard.
 * Auth middleware (add): verify the Supabase JWT from the Authorization header,
 * resolve user's membership, and require the conversation's company_id to match.
 */
export const agentRoutes = new Hono();

/* Take over: AI stops replying the moment this flips. The inbound webhook
   checks conversation.status — if 'handed_off', it stores the lead's message
   and notifies the agent instead of calling generateReply(). */
agentRoutes.post("/conversations/:id/takeover", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");
  await supabaseAdmin.from("conversations")
    .update({ status: "handed_off", handed_off_to: userId }).eq("id", id);
  const { data: convo } = await supabaseAdmin
    .from("conversations").select("company_id, lead_id").eq("id", id).single();
  await supabaseAdmin.from("messages").insert({
    company_id: convo!.company_id, conversation_id: id,
    direction: "internal", role: "system", content: "Agent took over · AI paused",
  });
  await supabaseAdmin.from("leads").update({ status: "handed_off" }).eq("id", convo!.lead_id);
  return c.json({ ok: true });
});

agentRoutes.post("/conversations/:id/handback", async (c) => {
  const id = c.req.param("id");
  await supabaseAdmin.from("conversations")
    .update({ status: "active", handed_off_to: null }).eq("id", id);
  const { data: convo } = await supabaseAdmin
    .from("conversations").select("company_id").eq("id", id).single();
  await supabaseAdmin.from("messages").insert({
    company_id: convo!.company_id, conversation_id: id,
    direction: "internal", role: "system", content: "Handed back to AI",
  });
  return c.json({ ok: true });
});

/* Agent sends a message into the same WhatsApp thread, from the same number. */
agentRoutes.post("/conversations/:id/messages", async (c) => {
  const id = c.req.param("id");
  const { text } = await c.req.json();
  const { data: convo } = await supabaseAdmin
    .from("conversations").select("id, company_id, channel, leads(*)").eq("id", id).single();
  if (!convo) return c.json({ error: "not found" }, 404);

  const adapter = getChannel(convo.channel)!;
  const sent = await adapter.send({
    lead: convo.leads as any, conversationId: id,
    projectName: "", isFirstTouch: false, body: text,
  });
  await supabaseAdmin.from("messages").insert({
    company_id: convo.company_id, conversation_id: id,
    direction: "outbound", role: "human_agent", content: text,
    provider_message_id: sent.providerMessageId,
  });
  return c.json({ ok: sent.ok, error: sent.error });
});

/** Company + billing summary for the trial banner and settings header. */
agentRoutes.get("/company", async (c) => {
  const { data: co } = await supabaseAdmin
    .from("companies").select("name, timezone, plan, billing_status, trial_ends_at")
    .eq("id", c.get("companyId")).single();
  const daysLeft = co?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(co.trial_ends_at).getTime() - Date.now()) / 86400_000))
    : null;
  const { automationActive } = await import("../lib/billing");
  return c.json({ ...co, trial_days_left: daysLeft, automation_active: co ? automationActive(co as any) : false });
});

/** Operating spend: this month's total, by category, and per-lead — real recorded data. */
agentRoutes.get("/costs", async (c) => {
  const companyId = c.get("companyId");
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const [{ data: events }, { count: leads }] = await Promise.all([
    supabaseAdmin.from("cost_events").select("category, amount_usd")
      .eq("company_id", companyId).gte("created_at", monthStart.toISOString()),
    supabaseAdmin.from("leads").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).gte("created_at", monthStart.toISOString()),
  ]);
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const e of events ?? []) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount_usd);
    total += Number(e.amount_usd);
  }
  return c.json({
    month_total_usd: +total.toFixed(2),
    by_category: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, +v.toFixed(2)])),
    leads_this_month: leads ?? 0,
    per_lead_usd: leads ? +(total / leads).toFixed(2) : 0,
  });
});

/** Transcript search: keyword search across every channel's turns.
 *  Supports quoted phrases and -exclusions (websearch syntax). */
agentRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ results: [] });
  const { data, error } = await supabaseAdmin.rpc("search_transcripts", {
    p_company: c.get("companyId"), p_query: q, p_limit: 25,
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ results: data ?? [] });
});

/** Save company WhatsApp number. Admin only. */
agentRoutes.put("/company/whatsapp", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const companyId = c.get("companyId");
  const { whatsapp_number } = await c.req.json();
  const { data: co } = await supabaseAdmin.from("companies").select("settings").eq("id", companyId).single();
  await supabaseAdmin.from("companies")
    .update({ settings: { ...(co?.settings ?? {}), whatsapp_number } }).eq("id", companyId);
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"), action: "whatsapp.updated", detail: { whatsapp_number },
  });
  return c.json({ ok: true });
});

/** Search for available Twilio phone numbers. Admin only. */
agentRoutes.post("/company/search-numbers", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const { country, area_code } = await c.req.json();
  try {
    const twilio = (await import("twilio")).default;
    const tw = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const available = await tw.availablePhoneNumbers(country || "US").local.list({
      areaCode: area_code ? Number(area_code) : undefined,
      smsEnabled: true,
      voiceEnabled: true,
      limit: 5,
    });
    return c.json({ numbers: available.map(n => ({ phoneNumber: n.phoneNumber, locality: n.locality, region: n.region })) });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** Buy a specific Twilio phone number. Admin only. One per company. */
agentRoutes.post("/company/buy-number", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const companyId = c.get("companyId");

  // Check if company already has a number
  const { data: existing } = await supabaseAdmin.from("companies").select("settings").eq("id", companyId).single();
  if ((existing?.settings as any)?.whatsapp_number) {
    return c.json({ error: "This workspace already has a phone number. Only one number per workspace is allowed." }, 400);
  }

  const { phone_number } = await c.req.json();
  if (!phone_number) return c.json({ error: "phone_number required" }, 400);

  try {
    const twilio = (await import("twilio")).default;
    const tw = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const purchased = await tw.incomingPhoneNumbers.create({
      phoneNumber: phone_number,
      smsUrl: `${env.APP_URL}/webhooks/twilio/whatsapp`,
      statusCallback: `${env.APP_URL}/webhooks/twilio/status`,
    });
    await supabaseAdmin.from("companies")
      .update({ settings: { ...(existing?.settings ?? {}), whatsapp_number: purchased.phoneNumber, twilio_number_sid: purchased.sid } })
      .eq("id", companyId);
    await supabaseAdmin.from("audit_log").insert({
      company_id: companyId, user_id: c.get("userId"), action: "number.purchased",
      detail: { phone_number: purchased.phoneNumber, sid: purchased.sid },
    });
    return c.json({ ok: true, phone_number: purchased.phoneNumber });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** Coverage calendar: replace the company's staffed-hours schedule. Admin only. */
agentRoutes.put("/company/hours", async (c) => {
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const { business_hours } = await c.req.json(); // WeeklySchedule shape (see core/hours.ts)
  const companyId = c.get("companyId");
  const { data: co } = await supabaseAdmin.from("companies").select("settings").eq("id", companyId).single();
  await supabaseAdmin.from("companies")
    .update({ settings: { ...(co?.settings ?? {}), business_hours } }).eq("id", companyId);
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"), action: "hours.updated", detail: { business_hours },
  });
  return c.json({ ok: true });
});

/* Knowledge ingestion — pasted text goes straight to chunking/embedding.
   Uploads land in Supabase Storage first; Drive folders register a sync job.
   The 'ingest' worker (add to worker.ts): extract text (pdf/docx/image OCR),
   chunk ~800 tokens, embed, insert doc_chunks, flip status to 'ready'. */
agentRoutes.post("/projects/:id/knowledge/text", async (c) => {
  const projectId = c.req.param("id");
  const { name, content } = await c.req.json();
  const companyId = c.get("companyId");
  const { data: doc } = await supabaseAdmin.from("documents").insert({
    company_id: companyId, project_id: projectId, source: "text",
    name: name ?? "Pasted text", status: "processing",
  }).select().single();
  const { boss } = await import("../jobs/queue");
  await boss.send("ingest", { documentId: doc!.id, rawText: content });
  return c.json({ ok: true, documentId: doc!.id });
});

agentRoutes.post("/projects/:id/knowledge/drive", async (c) => {
  const projectId = c.req.param("id");
  const { folderUrl } = await c.req.json();
  await supabaseAdmin.from("projects")
    .update({ drive_folder_url: folderUrl }).eq("id", projectId);
  const { boss } = await import("../jobs/queue");
  await boss.send("drive-sync", { projectId });
  // Drive sync worker: Google OAuth service account with folder shared to it ->
  // list files -> download -> extract -> chunk/embed. Re-runs nightly via boss.schedule.
  return c.json({ ok: true });
});
