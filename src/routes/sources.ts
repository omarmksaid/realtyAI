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
      // The Google key is config the operator has to paste into Google Ads, not a password —
      // and it was previously shown once in an alert() at creation and then unrecoverable
      // from the UI. Return it so the Sources page can display it permanently.
      // Google only: `config` also holds Meta's page access token, which must never reach
      // the browser — that's why this doesn't just spread cfg.
      google_key: src.provider === "google" ? (cfg.google_key ?? null) : null,
      test_received_at: cfg.test_received_at ?? null,
      default_project_id: cfg.default_project_id ?? null,
      forms: forms.map(f => ({
        ...f,
        project_id: cfg.form_project_map?.[f.form_id] ?? cfg.default_project_id ?? null,
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
  const next = { ...cfg };

  // No form_id means "every lead from this source goes to this project" — that's what the
  // Google UI sends, because a Google source is one lead form, not a page full of them.
  //
  // This used to do `map[form_id] = project_id` regardless, and JS coerces an undefined key
  // to the STRING "undefined" — producing {"undefined": "<project>"} and a map that never
  // matches. Google sends form_id: 2, the lookup missed, default_project_id was never set,
  // and every Google lead arrived with NO project: no brochure, no pricing, an AI that can't
  // answer a single question about the listing it was calling about.
  if (form_id === undefined || form_id === null || form_id === "") {
    next.default_project_id = project_id ?? null;
  } else {
    const map = { ...(cfg.form_project_map ?? {}) };
    if (project_id) map[String(form_id)] = project_id; else delete map[String(form_id)];
    next.form_project_map = map;
  }

  // Clean up the "undefined" key if a previous save created one.
  if (next.form_project_map?.undefined !== undefined) {
    const cleaned = { ...next.form_project_map };
    delete cleaned.undefined;
    next.form_project_map = cleaned;
  }

  await supabaseAdmin.from("lead_sources").update({ config: next }).eq("id", src.id);

  // Retroactively attach recent unmapped leads (they keep their generic conversation
  // history, but scoring/digest/RAG pick up the project from now on).
  if (project_id) {
    let q = supabaseAdmin.from("leads").update({ project_id })
      .eq("company_id", companyId).eq("source_id", src.id).is("project_id", null);
    // A form-specific mapping only backfills that form's leads; a source default backfills
    // every unmapped lead from the source.
    if (form_id) q = q.eq("form_id", String(form_id));
    await q;
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
  const { label, project_id } = await c.req.json();
  const google_key = randomBytes(18).toString("base64url");
  // If a project_id is provided, map all leads from this source to that project by default
  const form_project_map: Record<string, string> = {};
  if (project_id) form_project_map["_default"] = project_id;
  const { data: src } = await supabaseAdmin.from("lead_sources").insert({
    company_id: companyId, provider: "google", label: label ?? "Google lead form",
    config: { google_key, form_project_map, default_project_id: project_id ?? null },
  }).select().single();
  return c.json({
    id: src!.id,
    webhook_url: `${env.APP_URL}/webhooks/google?src=${src!.id}`,
    google_key,
  });
});
