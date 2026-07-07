import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";
import { env } from "../lib/env";

/** Protected by requireAuth (mounted in index.ts). companyId comes from the session. */
export const sourcesRoutes = new Hono();

/**
 * GET /sources — everything the mapping page needs in one call:
 * each source, its forms (Meta forms auto-discovered via Graph API), the
 * current form→project mapping, per-form 30-day lead counts + last-lead time,
 * and the unmapped-lead alert count for the banner.
 */
sourcesRoutes.get("/", async (c) => {
  const companyId = c.get("companyId");

  const [{ data: sources }, { data: projects }] = await Promise.all([
    supabaseAdmin.from("lead_sources").select("*").eq("company_id", companyId).eq("is_active", true),
    supabaseAdmin.from("projects").select("id, name, city").eq("company_id", companyId).neq("status", "archived"),
  ]);

  // Per-form stats from the last 30 days, one query
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: leadRows } = await supabaseAdmin
    .from("leads").select("form_id, provider, created_at")
    .eq("company_id", companyId).gte("created_at", since);
  const stats: Record<string, { count: number; last: string }> = {};
  for (const l of leadRows ?? []) {
    if (!l.form_id) continue;
    const s = (stats[l.form_id] ??= { count: 0, last: l.created_at });
    s.count++; if (l.created_at > s.last) s.last = l.created_at;
  }

  // Unmapped alert: leads in the last 24h with no project
  const { count: unmapped24h } = await supabaseAdmin
    .from("leads").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).is("project_id", null)
    .gte("created_at", new Date(Date.now() - 86400_000).toISOString());

  const out = [];
  for (const src of sources ?? []) {
    const cfg = src.config as any;
    let forms: { form_id: string; name: string }[] = [];

    if (src.provider === "meta" && cfg.page_id && cfg.page_access_token) {
      // Auto-discovery: new ad forms appear here without anyone touching config
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${cfg.page_id}/leadgen_forms?fields=id,name,status&limit=100&access_token=${cfg.page_access_token}`
        );
        const data = await res.json();
        forms = (data.data ?? [])
          .filter((f: any) => f.status === "ACTIVE")
          .map((f: any) => ({ form_id: f.id, name: f.name }));
      } catch { /* Graph down: fall through to known forms below */ }
    }
    // Always include forms we've seen leads from or already mapped, even if discovery failed
    const known = new Set(forms.map(f => f.form_id));
    for (const fid of Object.keys(cfg.form_project_map ?? {})) {
      if (!known.has(fid)) forms.push({ form_id: fid, name: fid });
    }

    out.push({
      id: src.id, provider: src.provider, label: src.label,
      webhook_url: src.provider === "google" ? `${env.APP_URL}/webhooks/google?src=${src.id}` : null,
      test_received_at: cfg.test_received_at ?? null,
      forms: forms.map(f => ({
        ...f,
        project_id: cfg.form_project_map?.[f.form_id] ?? null,
        leads_30d: stats[f.form_id]?.count ?? 0,
        last_lead_at: stats[f.form_id]?.last ?? null,
      })),
    });
  }
  return c.json({ sources: out, projects, unmapped_24h: unmapped24h ?? 0 });
});

/** PATCH /sources/:id/mapping — set (or clear) one form's project. */
sourcesRoutes.patch("/:id/mapping", async (c) => {
  const companyId = c.get("companyId");
  const { form_id, project_id } = await c.req.json();

  const { data: src } = await supabaseAdmin
    .from("lead_sources").select("id, config").eq("id", c.req.param("id")).eq("company_id", companyId).single();
  if (!src) return c.json({ error: "not found" }, 404);
  if (project_id) {
    const { data: proj } = await supabaseAdmin
      .from("projects").select("id").eq("id", project_id).eq("company_id", companyId).single();
    if (!proj) return c.json({ error: "project not in this company" }, 400);
  }

  const cfg = src.config as any;
  const map = { ...(cfg.form_project_map ?? {}) };
  if (project_id) map[form_id] = project_id; else delete map[form_id];
  await supabaseAdmin.from("lead_sources").update({ config: { ...cfg, form_project_map: map } }).eq("id", src.id);

  // Retroactively attach recent unmapped leads from this form (they keep their generic
  // conversation history, but scoring/digest/RAG pick up the project from now on)
  if (project_id) {
    await supabaseAdmin.from("leads").update({ project_id })
      .eq("company_id", companyId).eq("form_id", form_id).is("project_id", null);
  }
  await supabaseAdmin.from("audit_log").insert({
    company_id: companyId, user_id: c.get("userId"),
    action: "source.mapping_updated", detail: { source_id: src.id, form_id, project_id },
  });
  return c.json({ ok: true });
});

/** POST /sources — register a new Google form source; returns its webhook URL + key. */
sourcesRoutes.post("/", async (c) => {
  const companyId = c.get("companyId");
  const { label } = await c.req.json();
  const google_key = randomBytes(18).toString("base64url");
  const { data: src } = await supabaseAdmin.from("lead_sources").insert({
    company_id: companyId, provider: "google", label: label ?? "Google lead form",
    config: { google_key, form_project_map: {} },
  }).select().single();
  return c.json({
    id: src!.id,
    webhook_url: `${env.APP_URL}/webhooks/google?src=${src!.id}`,
    google_key, // paste both into the lead form's webhook section
  });
});
