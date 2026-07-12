"use client";

import { useEffect, useState } from "react";
import { createClient } from "./supabase";
import { isDemo } from "./data";

export type Role = "owner" | "admin" | "agent";

/**
 * The current user's role in their company.
 *
 * This is for HIDING controls a user can't use — it is not a security boundary. The API
 * enforces the real check (see adminOnly in src/routes/agent.ts); anything gated only in
 * the browser is gated not at all. RLS can't help here either: every policy checks company
 * membership (`company_id in my_company_ids()`), never role, so an agent has the same
 * table-level write access as the owner. That's exactly why the sensitive writes moved
 * behind the API.
 */
export function useRole() {
  const [role, setRole] = useState<Role | null>(isDemo ? "owner" : null);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from("memberships")
          .select("role")
          .eq("user_id", session.user.id)
          .limit(1)
          .maybeSingle();
        if (!cancelled && data?.role) setRole(data.role as Role);
      } catch {
        // Leave role null — callers treat unknown as non-admin, so we fail closed.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    role,
    isAdmin: role === "owner" || role === "admin",
    isOwner: role === "owner",
    loading: role === null,
  };
}
