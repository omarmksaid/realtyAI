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

// Supabase JWT secrets may be plain UTF-8 or base64-encoded; try both.
const rawSecret = env.SUPABASE_JWT_SECRET;
const secret = rawSecret.match(/^[A-Za-z0-9+/=]+$/) && rawSecret.length > 40
  ? Buffer.from(rawSecret, "base64")
  : new TextEncoder().encode(rawSecret);

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret, { audience: "authenticated" });
    userId = payload.sub as string;
    if (!userId) throw new Error("no sub");
  } catch (err) {
    // Try the other encoding as fallback
    try {
      const altSecret = rawSecret.match(/^[A-Za-z0-9+/=]+$/) && rawSecret.length > 40
        ? new TextEncoder().encode(rawSecret)
        : Buffer.from(rawSecret, "base64");
      const { payload } = await jwtVerify(token, altSecret, { audience: "authenticated" });
      userId = payload.sub as string;
      if (!userId) throw new Error("no sub");
    } catch {
      console.error("JWT verification failed:", (err as Error).message);
      return c.json({ error: "invalid or expired token" }, 401);
    }
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
    const { payload } = await jwtVerify(token, secret, { audience: "authenticated" });
    userId = payload.sub as string;
    if (!userId) throw new Error("no sub");
  } catch {
    try {
      const altSecret = rawSecret.match(/^[A-Za-z0-9+/=]+$/) && rawSecret.length > 40
        ? new TextEncoder().encode(rawSecret)
        : Buffer.from(rawSecret, "base64");
      const { payload } = await jwtVerify(token, altSecret, { audience: "authenticated" });
      userId = payload.sub as string;
      if (!userId) throw new Error("no sub");
    } catch { return c.json({ error: "invalid or expired token" }, 401); }
  }

  const { data } = await supabaseAdmin
    .from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!data) return c.json({ error: "platform admin required" }, 403);
  c.set("userId", userId);
  await next();
};
