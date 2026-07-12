import { createClient } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Returns the company_id for the current user by reading their first membership.
 * Returns null if no session or no memberships found.
 */
export async function getCompanyId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data } = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", session.user.id)
    .limit(1)
    .single();

  return data?.company_id ?? null;
}

/**
 * Auth-aware fetch wrapper. Attaches Authorization and X-Company-Id headers
 * from the current Supabase session. Falls back to a plain fetch when there
 * is no session (should not normally happen — callers gate on isDemo first).
 */
export async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // FormData must set its own Content-Type (it carries the multipart boundary) —
  // forcing application/json here makes the server fail to parse the body.
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options?.headers as Record<string, string>),
  };

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const companyId = await getCompanyId();
  if (companyId) {
    headers["X-Company-Id"] = companyId;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
}
