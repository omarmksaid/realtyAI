import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getChannel } from "../channels/types";

/**
 * Authenticated agent API, called by the dashboard.
 * Auth middleware (add): verify the Supabase JWT from the Authorization header,
 * resolve user's membership, and require the conversation's company_id to match.
 */
export const agentRoutes = new Hono();

/** Ceiling on an uploaded knowledge file. The binding constraint is the Anthropic API,
 *  which caps a request at 32MB — and we base64 the file, which inflates it ~33%. So a
 *  PDF much over ~20MB can't be read at all; rejecting it here beats failing in the
 *  ingest worker after the upload appeared to succeed. Real brochures are single-digit MB. */
const MAX_UPLOAD_MB = 20;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1_000_000;
/** What extractText() in the ingest worker actually knows how to read. */
const ACCEPTED_UPLOAD = /\.(pdf|docx|png|jpe?g|webp|txt|md|csv)$/i;

/** Brokerage configuration — routing, prompts, knowledge, numbers, hours, voice — is
 *  owner/admin only. Agents work leads; they don't reconfigure the workspace. */
const adminOnly = (c: any) =>
  c.get("role") === "agent" ? c.json({ error: "Only owners and admins can change this." }, 403) : null;


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

/* ============ Routing rules & prompts — owner/admin only ============
   These were being written straight from the browser to Supabase, which bypassed every
   role check: RLS only asks "are you a member of this company", never "are you an admin".
   So any agent could rewrite the AI's system prompt or change the escalation ladder that
   decides when we spend money on a voice call. They go through the API now. */

/** Create or update a routing rule. */
agentRoutes.put("/company/routing-rules/:id?", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const companyId = c.get("companyId");
  const id = c.req.param("id");
  const { label, day_type, start_time, end_time, channels, followup_delay_min, priority } =
    await c.req.json();

  if (!label?.trim()) return c.json({ error: "A rule needs a label." }, 400);
  if (!Array.isArray(channels) || !channels.length) {
    return c.json({ error: "A rule needs at least one channel." }, 400);
  }

  const fields = {
    label: label.trim(), day_type, start_time, end_time, channels,
    followup_delay_min: Number(followup_delay_min) || 0,
  };

  const { error } = id
    ? await supabaseAdmin.from("routing_rules").update(fields)
        .eq("id", id).eq("company_id", companyId)   // scope: supabaseAdmin bypasses RLS
    : await supabaseAdmin.from("routing_rules").insert({
        ...fields, company_id: companyId, priority: Number(priority) || 10,
      });
  if (error) return c.json({ error: error.message }, 500);

  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"),
    action: id ? "routing_rule.updated" : "routing_rule.created", detail: fields,
  });
  return c.json({ ok: true });
});

/** Soft-delete a routing rule. */
agentRoutes.delete("/company/routing-rules/:id", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const companyId = c.get("companyId");
  const id = c.req.param("id");
  const { error } = await supabaseAdmin.from("routing_rules")
    .update({ is_active: false }).eq("id", id).eq("company_id", companyId);
  if (error) return c.json({ error: error.message }, 500);
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"), action: "routing_rule.deleted", detail: { id },
  });
  return c.json({ ok: true });
});

/** Publish a new version of the conversation prompt. The guardrails in buildSystemPrompt
 *  wrap whatever lands here — an admin can change the AI's tone, not its safety rails. */
agentRoutes.post("/company/prompt", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const companyId = c.get("companyId");
  const { content, name, channel, project_id, previous_id, version } = await c.req.json();
  if (!content?.trim()) return c.json({ error: "The prompt can't be empty." }, 400);

  if (previous_id) {
    await supabaseAdmin.from("prompt_templates")
      .update({ is_active: false }).eq("id", previous_id).eq("company_id", companyId);
  }
  const { error } = await supabaseAdmin.from("prompt_templates").insert({
    company_id: companyId,
    project_id: project_id ?? null,
    channel: channel ?? "any",
    name: name ?? "Company default",
    content: content.trim(),
    version: (Number(version) || 0) + 1,
    is_active: true,
  });
  if (error) return c.json({ error: error.message }, 500);

  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"), action: "prompt.published",
    detail: { channel: channel ?? "any", version: (Number(version) || 0) + 1 },
  });
  return c.json({ ok: true });
});

/* Knowledge ingestion — pasted text goes straight to chunking/embedding; uploads land in
   Supabase Storage first, then register here. The 'ingest' worker extracts text
   (pdf/docx/image), chunks ~800 tokens, embeds, inserts doc_chunks, flips status to
   'ready' (or 'failed'). */
agentRoutes.post("/projects/:id/knowledge/text", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
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

/* Deleting a knowledge source has to go through the API: RLS has no delete policy, so
   a delete issued from the browser is silently denied. supabaseAdmin bypasses RLS, which
   means the company_id filter below is the only thing scoping this to the caller's
   tenant — it must come from the auth context, never from the request. */
agentRoutes.delete("/projects/:projectId/knowledge/:docId", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const { projectId, docId } = c.req.param();
  const companyId = c.get("companyId");

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("id")
    .eq("id", docId)
    .eq("project_id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!doc) return c.json({ error: "not found" }, 404);

  // Chunks are what the AI actually reads, so they must go too. No FK cascade here.
  const { error: chunkErr } = await supabaseAdmin
    .from("doc_chunks").delete().eq("document_id", docId).eq("company_id", companyId);
  if (chunkErr) return c.json({ error: chunkErr.message }, 500);

  const { error: docErr } = await supabaseAdmin
    .from("documents").delete().eq("id", docId).eq("company_id", companyId);
  if (docErr) return c.json({ error: docErr.message }, 500);

  return c.json({ ok: true });
});

/* The browser posts the file here rather than straight to Storage: RLS is enabled on
   storage.objects with no policy defined, so a browser-issued upload is denied outright.
   supabaseAdmin bypasses RLS, so the company prefix below is what scopes the write to
   the caller's tenant — it comes from the auth context, never from the request. */
agentRoutes.post("/projects/:id/knowledge/upload", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const projectId = c.req.param("id");
  const companyId = c.get("companyId");

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({
      error: `File is ${(file.size / 1e6).toFixed(1)}MB. The limit is ${MAX_UPLOAD_MB}MB — split it or export a smaller version.`,
    }, 413);
  }
  if (!ACCEPTED_UPLOAD.test(file.name ?? "")) {
    return c.json({ error: "Unsupported file type. Upload a PDF, DOCX, PNG, JPG, or text file." }, 415);
  }

  const name = file.name || "Uploaded file";
  const buf = Buffer.from(await file.arrayBuffer());
  // basename only — a name like "../../other-co/x.pdf" must not escape the prefix.
  const safeName = name.split(/[\\/]/).pop()!;
  const storagePath = `${companyId}/${projectId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from("knowledge")
    .upload(storagePath, buf, { contentType: file.type || "application/octet-stream" });
  if (upErr) return c.json({ error: `storage: ${upErr.message}` }, 500);

  const { data: doc, error } = await supabaseAdmin.from("documents").insert({
    company_id: companyId, project_id: projectId, source: "upload",
    name: safeName, storage_path: storagePath, status: "processing",
  }).select().single();
  if (error) return c.json({ error: error.message }, 500);

  const { boss } = await import("../jobs/queue");
  await boss.send("ingest", { documentId: doc!.id });
  return c.json({ ok: true, documentId: doc!.id });
});

/* Re-run ingest on a document that failed (a provider outage, a rate limit). Only uploads
   can be retried: a pasted-text document's raw text is passed to the job and never stored,
   so there's nothing to re-extract from — re-paste it instead. */
agentRoutes.post("/projects/:projectId/knowledge/:docId/retry", async (c) => {
  const denied = adminOnly(c); if (denied) return denied;
  const { projectId, docId } = c.req.param();
  const companyId = c.get("companyId");

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("id, source, storage_path")
    .eq("id", docId).eq("project_id", projectId).eq("company_id", companyId)
    .maybeSingle();
  if (!doc) return c.json({ error: "not found" }, 404);
  if (doc.source !== "upload" || !doc.storage_path) {
    return c.json({ error: "Only uploaded files can be retried — re-paste the text instead." }, 400);
  }

  await supabaseAdmin.from("documents").update({ status: "processing" }).eq("id", docId);
  const { boss } = await import("../jobs/queue");
  await boss.send("ingest", { documentId: docId });
  return c.json({ ok: true });
});

/* Signed URL so the dashboard can preview/download an uploaded PDF or image. The bucket
   is private, so a bare storage URL 404s — this mints a short-lived signed one, scoped to
   the caller's company. */
agentRoutes.get("/projects/:projectId/knowledge/:docId/url", async (c) => {
  const { projectId, docId } = c.req.param();
  const companyId = c.get("companyId");

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("storage_path, name")
    .eq("id", docId).eq("project_id", projectId).eq("company_id", companyId)
    .maybeSingle();
  if (!doc?.storage_path) return c.json({ error: "not found" }, 404);

  const { data, error } = await supabaseAdmin.storage
    .from("knowledge")
    .createSignedUrl(doc.storage_path, 300); // 5 minutes
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ url: data.signedUrl, name: doc.name });
});
