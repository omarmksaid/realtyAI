import { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";

/**
 * Auth model:
 * 1. Dashboard sends the Supabase session JWT as `Authorization: Bearer <jwt>`.
 * 2. We verify it LOCALLY with the project's JWT secret (no network hop, fast).
 * 3. We resolve the user's memberships and pin the request to ONE company:
 *    - `X-Company-Id` header if the user belongs to it (multi-company users),
 *    - otherwise their single membership.
 * 4. Handlers read companyId/userId from context — NEVER from the request body.
 *    This is the line that makes cross-tenant access impossible to express.
 *
 * Webhook routes (/webhooks/*) do NOT use this — they authenticate the
 * provider instead (Meta HMAC, Twilio signature, Google/Vapi shared keys).
 */

// Supabase JWT secret — may be HMAC (HS256) or need to be used as-is.
// We try HMAC first with the raw secret as bytes, which covers most Supabase setups.
const rawSecret = env.SUPABASE_JWT_SECRET;
const hmacSecret = new TextEncoder().encode(rawSecret);

async function verifyJwt(token: string): Promise<{ sub: string; email?: string }> {
  // Try HS256 with the secret as UTF-8 bytes (most common Supabase setup)
  try {
    const { payload } = await jwtVerify(token, hmacSecret, { audience: "authenticated" });
    return { sub: payload.sub as string, email: (payload as any).email };
  } catch {}

  // Try HS256 with base64-decoded secret
  try {
    const b64Secret = Buffer.from(rawSecret, "base64");
    const key = await crypto.subtle.importKey(
      "raw", b64Secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const { payload } = await jwtVerify(token, key, { audience: "authenticated" });
    return { sub: payload.sub as string, email: (payload as any).email };
  } catch {}

  // Try without audience check (some Supabase versions use different aud)
  try {
    const { payload } = await jwtVerify(token, hmacSecret);
    return { sub: payload.sub as string, email: (payload as any).email };
  } catch (err) {
    throw err;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  let userId: string;
  try {
    const result = await verifyJwt(token);
    userId = result.sub;
    if (!userId) throw new Error("no sub");
  } catch (err) {
    console.error("JWT verification failed:", (err as Error).message);
    return c.json({ error: "invalid or expired token" }, 401);
  }

  const { data: memberships } = await supabaseAdmin
    .from("memberships").select("company_id, role").eq("user_id", userId);
  if (!memberships?.length) return c.json({ error: "no company membership" }, 403);

  const requested = c.req.header("x-company-id");
  const membership = requested
    ? memberships.find(m => m.company_id === requested)
    : memberships[0];
  if (!membership) return c.json({ error: "not a member of that company" }, 403);

  c.set("userId", userId);
  c.set("companyId", membership.company_id);
  c.set("role", membership.role);
  await next();
};

/** Restrict a route to owners/admins (e.g. changing prompts, voices, rules). */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const role = c.get("role");
  if (role !== "owner" && role !== "admin") return c.json({ error: "admin required" }, 403);
  await next();
};

/** Platform operator gate: verified JWT + a row in platform_admins.
 *  Independent of company memberships — the operator may belong to zero companies. */
export const requirePlatformAdmin: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "missing bearer token" }, 401);
  let userId: string;
  try {
    const result = await verifyJwt(token);
    userId = result.sub;
    if (!userId) throw new Error("no sub");
  } catch { return c.json({ error: "invalid or expired token" }, 401); }

  const { data } = await supabaseAdmin
    .from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!data) return c.json({ error: "platform admin required" }, 403);
  c.set("userId", userId);
  await next();
};
