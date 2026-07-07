import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";

/**
 * Platform admin API. Mounted behind requirePlatformAdmin (index.ts) —
 * deliberately NOT behind requireAuth, since the operator needs cross-company
 * reads that RLS would (correctly) block for any normal user. This is the one
 * place in the codebase allowed to query without a company_id filter.
 */
export const adminRoutes = new Hono();

/** Everything the portal table needs, one call. */
adminRoutes.get("/companies", async (c) => {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const d30 = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [{ data: companies }, { data: leads }, { data: costs }, { data: members }] = await Promise.all([
    supabaseAdmin.from("companies")
      .select("id, name, timezone, plan, plan_price_usd, billing_status, trial_ends_at, billing_notes, created_at"),
    supabaseAdmin.from("leads").select("company_id, created_at, status").gte("created_at", d30),
    supabaseAdmin.from("cost_events").select("company_id, amount_usd").gte("created_at", monthStart.toISOString()),
    supabaseAdmin.from("memberships").select("company_id"),
  ]);

  const agg: Record<string, { leads30: number; engaged30: number; lastLead: string | null; spendMtd: number; members: number }> = {};
  const A = (id: string) => (agg[id] ??= { leads30: 0, engaged30: 0, lastLead: null, spendMtd: 0, members: 0 });
  for (const l of leads ?? []) {
    const a = A(l.company_id); a.leads30++;
    if (["engaged", "qualified", "handed_off"].includes(l.status)) a.engaged30++;
    if (!a.lastLead || l.created_at > a.lastLead) a.lastLead = l.created_at;
  }
  for (const e of costs ?? []) A(e.company_id).spendMtd += Number(e.amount_usd);
  for (const m of members ?? []) A(m.company_id).members++;

  return c.json((companies ?? []).map((co) => {
    const a = A(co.id);
    return {
      ...co,
      leads_30d: a.leads30,
      engaged_30d: a.engaged30,
      last_lead_at: a.lastLead,
      spend_mtd_usd: +a.spendMtd.toFixed(2),
      members: a.members,
      margin_mtd_usd: +(Number(co.plan_price_usd) - a.spendMtd).toFixed(2),
    };
  }));
});

/** Detail: 6-month spend history by category + channel usage counts. */
adminRoutes.get("/companies/:id", async (c) => {
  const id = c.req.param("id");
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - 5); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);

  const [{ data: co }, { data: events }, { data: convos }] = await Promise.all([
    supabaseAdmin.from("companies").select("*").eq("id", id).single(),
    supabaseAdmin.from("cost_events").select("category, amount_usd, created_at").eq("company_id", id).gte("created_at", since.toISOString()),
    supabaseAdmin.from("conversations").select("channel").eq("company_id", id).gte("started_at", since.toISOString()),
  ]);
  if (!co) return c.json({ error: "not found" }, 404);

  const months: Record<string, Record<string, number>> = {};
  for (const e of events ?? []) {
    const key = e.created_at.slice(0, 7); // YYYY-MM
    (months[key] ??= {})[e.category] = ((months[key] ?? {})[e.category] ?? 0) + Number(e.amount_usd);
  }
  const channels: Record<string, number> = {};
  for (const cv of convos ?? []) channels[cv.channel] = (channels[cv.channel] ?? 0) + 1;

  return c.json({ company: co, spend_by_month: months, conversations_by_channel: channels });
});

/** Set the plan / price / status for a company. Audit-logged under that company. */
adminRoutes.patch("/companies/:id/billing", async (c) => {
  const id = c.req.param("id");
  const { plan, plan_price_usd, billing_status, trial_ends_at, billing_notes } = await c.req.json();
  const patch: any = {};
  if (plan) patch.plan = plan;
  if (plan_price_usd !== undefined) patch.plan_price_usd = plan_price_usd;
  if (billing_status) patch.billing_status = billing_status;
  if (trial_ends_at !== undefined) patch.trial_ends_at = trial_ends_at;
  if (billing_notes !== undefined) patch.billing_notes = billing_notes;

  const { error } = await supabaseAdmin.from("companies").update(patch).eq("id", id);
  if (error) return c.json({ error: error.message }, 400);
  await supabaseAdmin.from("audit_log").insert({
    company_id: id, user_id: c.get("userId"), action: "billing.updated", detail: patch,
  });
  return c.json({ ok: true });
});
