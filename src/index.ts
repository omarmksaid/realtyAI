import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { leadWebhooks } from "./routes/webhooks/leads";
import { inboundWebhooks } from "./routes/webhooks/inbound";
import { startWorker } from "./jobs/worker";

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/webhooks", leadWebhooks);     // /webhooks/meta, /webhooks/google
app.route("/webhooks", inboundWebhooks);  // /webhooks/twilio/whatsapp, /webhooks/vapi

import { requireAuth, requirePlatformAdmin } from "./lib/auth";
import { agentRoutes } from "./routes/agent";
app.use("/agent/*", requireAuth);
app.route("/agent", agentRoutes);

import { assistantRoutes } from "./routes/assistant";
import { adminRoutes } from "./routes/admin";
app.use("/admin/*", requirePlatformAdmin);
app.route("/admin", adminRoutes);  // platform operator: all companies, usage, billing

import { teamRoutes, acceptInvite } from "./routes/team";
app.post("/team/accept", acceptInvite);   // JWT-verified but pre-membership
app.use("/team/*", requireAuth);
app.route("/team", teamRoutes);

app.use("/sources/*", requireAuth);
import { sourcesRoutes } from "./routes/sources";
app.route("/sources", sourcesRoutes); // form -> project mapping

app.use("/assistant/*", requireAuth);
app.route("/assistant", assistantRoutes); // data-assistant chat + voice settings         // takeover, hand-back, agent messages, knowledge ingestion

// Test lead injection (no provider auth — for dev/demo only)
import { handleIncomingLead } from "./core/router";
app.post("/webhooks/test", async (c) => {
  const body = await c.req.json();
  const result = await handleIncomingLead({
    company_id: body.company_id,
    project_id: body.project_id ?? null,
    source_id: null,
    provider: "test",
    external_id: `test-${Date.now()}`,
    full_name: body.full_name ?? "Test Lead",
    phone: body.phone,
    email: body.email,
    form_data: body.form_data ?? {},
  });
  return c.json(result);
});

// Unsubscribe endpoint (CASL): GET /u/:leadId
import { supabaseAdmin } from "./lib/supabase";
app.get("/u/:leadId", async (c) => {
  await supabaseAdmin.from("leads")
    .update({ opted_out: true, status: "opted_out" })
    .eq("id", c.req.param("leadId"));
  return c.html("<p>You've been unsubscribed. Sorry to see you go!</p>");
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`api listening on :${port}`));
startWorker().catch((e) => { console.error("worker failed to start (will retry on next deploy):", e.message); });
