import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { runAssistant } from "../ai/assistant";
import { env } from "../lib/env";

/** Protected by requireAuth (see index.ts): companyId/userId come from the verified session. */
export const assistantRoutes = new Hono();

assistantRoutes.post("/threads/:threadId/messages", async (c) => {
  const threadId = c.req.param("threadId");
  const { text } = await c.req.json();
  const companyId = c.get("companyId");

  const { data: prior } = await supabaseAdmin
    .from("assistant_messages").select("role, content")
    .eq("thread_id", threadId).order("created_at").limit(20);

  const { text: answer, toolActivity } = await runAssistant(companyId, text, (prior ?? []) as any);

  await supabaseAdmin.from("assistant_messages").insert([
    { company_id: companyId, thread_id: threadId, role: "user", content: text },
    { company_id: companyId, thread_id: threadId, role: "assistant", content: answer, tool_activity: toolActivity },
  ]);
  return c.json({ answer, toolActivity });
});

assistantRoutes.post("/threads", async (c) => {
  const { title } = await c.req.json();
  const companyId = c.get("companyId"), userId = c.get("userId");
  const { data } = await supabaseAdmin.from("assistant_threads")
    .insert({ company_id: companyId, user_id: userId, title }).select().single();
  return c.json(data);
});

/* ---- Voice settings (ElevenLabs) ---- */

// List voices from the company's ElevenLabs library (or the shared default library).
assistantRoutes.get("/voices", async (c) => {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) return c.json({ error: "ElevenLabs unavailable" }, 502);
  const data = await res.json();
  // preview_url is a hosted mp3 — the dashboard plays it directly for auditioning.
  return c.json((data.voices ?? []).map((v: any) => ({
    voice_id: v.voice_id, name: v.name,
    labels: v.labels,               // accent, age, gender, use case
    preview_url: v.preview_url,
  })));
});

assistantRoutes.post("/companies/:id/voice", async (c) => {
  const companyId = c.get("companyId"); // param ignored: you can only change your own company
  if (c.get("role") === "agent") return c.json({ error: "admin required" }, 403);
  const { voice_id, name } = await c.req.json();
  const { data: co } = await supabaseAdmin.from("companies").select("settings").eq("id", companyId).single();
  await supabaseAdmin.from("companies").update({
    settings: { ...(co?.settings ?? {}), voice: { provider: "11labs", voice_id, name } },
  }).eq("id", companyId);
  return c.json({ ok: true });
});
