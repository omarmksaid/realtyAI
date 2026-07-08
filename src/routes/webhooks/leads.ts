import { Hono } from "hono";
import crypto from "node:crypto";
import { env } from "../../lib/env";
import { supabaseAdmin } from "../../lib/supabase";
import { handleIncomingLead } from "../../core/router";

export const leadWebhooks = new Hono();

/* ---------------- META LEAD ADS ----------------
 * Setup: App Dashboard -> Webhooks -> subscribe Page to `leadgen`.
 * Meta sends only a leadgen_id; we fetch full field data via Graph API.
 */
leadWebhooks.get("/meta", (c) => {
  // Verification handshake
  const q = c.req.query();
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.META_VERIFY_TOKEN)
    return c.text(q["hub.challenge"]);
  return c.text("forbidden", 403);
});

leadWebhooks.post("/meta", async (c) => {
  const rawBody = await c.req.text();
  // Verify X-Hub-Signature-256 so nobody can inject fake leads
  const sig = c.req.header("x-hub-signature-256") ?? "";
  const expected = "sha256=" + crypto.createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return c.text("bad signature", 401);

  const body = JSON.parse(rawBody);
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const { leadgen_id, page_id, form_id, ad_id, campaign_id } = change.value;

      // Which company/project does this page+form belong to?
      const { data: source } = await supabaseAdmin
        .from("lead_sources").select("id, company_id, config")
        .eq("provider", "meta").contains("config", { page_id }).single();
      if (!source) continue;

      // Pull full lead details
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${leadgen_id}?access_token=${(source.config as any).page_access_token}`
      );
      const leadData = await res.json();
      const fields: Record<string, string> = {};
      for (const f of leadData.field_data ?? []) fields[f.name] = f.values?.[0];

      await handleIncomingLead({
        company_id: source.company_id,
        project_id: (source.config as any).form_project_map?.[form_id] ?? null,
        source_id: source.id,
        provider: "meta",
        external_id: leadgen_id,
        form_id: String(form_id),
        full_name: fields.full_name ?? fields.name,
        phone: fields.phone_number,
        email: fields.email,
        campaign_id, ad_id,
        form_data: fields,
      });
    }
  }
  return c.text("ok"); // always 200 fast; Meta retries on non-200
});

/* ---------------- GOOGLE ADS LEAD FORMS ----------------
 * Setup: in the lead form asset, set "Webhook integration" to
 * https://yourapp/webhooks/google?src={lead_source_id} with a google_key.
 * Google POSTs the full lead payload directly — no fetch-back needed.
 */
leadWebhooks.post("/google", async (c) => {
  const body = await c.req.json();
  const srcId = c.req.query("src");

  const { data: source } = await supabaseAdmin
    .from("lead_sources").select("id, company_id, config")
    .eq("id", srcId).eq("provider", "google").single();
  if (!source || body.google_key !== (source.config as any).google_key)
    return c.text("forbidden", 403);

  // Google's "send test data" button marks payloads is_test — verify the pipe, never message anyone.
  if (body.is_test) {
    await supabaseAdmin.from("lead_sources").update({
      config: { ...(source.config as any), test_received_at: new Date().toISOString() },
    }).eq("id", source.id);
    return c.text("ok (test lead recorded)");
  }

  const fields: Record<string, string> = {};
  for (const col of body.user_column_data ?? []) fields[col.column_id] = col.string_value;

  await handleIncomingLead({
    company_id: source.company_id,
    project_id: (source.config as any).form_project_map?.[body.form_id] ?? (source.config as any).default_project_id ?? null,
    source_id: source.id,
    provider: "google",
    external_id: body.lead_id,
    form_id: String(body.form_id ?? ""),
    full_name: fields.FULL_NAME,
    phone: fields.PHONE_NUMBER,
    email: fields.EMAIL,
    campaign_id: String(body.campaign_id ?? ""),
    form_data: fields,
  });
  return c.text("ok");
});
