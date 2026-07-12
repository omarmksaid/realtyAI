"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { Nav } from "./nav";
import TrialBanner from "./trial-banner";
import { ToastProvider } from "@/lib/toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(isDemo);
  const [companyName, setCompanyName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const pathname = usePathname();

  useEffect(() => {
    if (isDemo) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // getSession() reads localStorage — it does NOT contact the server. A user whose
      // access was revoked still holds a cached session object here, so this alone said
      // "signed in" and rendered the app. Their queries returned nothing (RLS re-reads
      // memberships live) and the API 403'd, but the shell looked fine: empty pages, no
      // explanation, no bounce to login. Access was revoked; the session was not.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      // The real check: are they still a member of anything? This hits the database, and
      // RLS's my_company_ids() re-reads memberships on every query — so a removed user
      // gets zero rows the moment their membership is deleted.
      const companyId = await getCompanyId();
      if (!companyId) {
        // Clear the dead session so they land on a login screen, not a broken dashboard.
        await supabase.auth.signOut();
        if (!cancelled) router.replace("/login?removed=1");
        return;
      }

      if (cancelled) return;
      setUserEmail(session.user.email ?? "");
      setReady(true);

      try {
        const { data } = await supabase
          .from("companies").select("name").eq("id", companyId).single();
        if (data && !cancelled) setCompanyName(data.name);
      } catch {}
    })();

    // Supabase fires SIGNED_OUT when a refresh fails against a revoked session. Catch it
    // so a user who was removed mid-session is ejected rather than left on a stale shell.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
    // Re-runs on navigation: membership is re-checked as they move around the app, so a
    // removal takes effect on their next click rather than on their next token refresh.
  }, [router, pathname]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!ready) return null;

  return (
    <ToastProvider>
    <div className="shell">
      <aside className="sidebar">
        <Link href="/today" className="brand">realty<em>AI</em></Link>
        {companyName && (
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px", padding: "0 12px" }}>{companyName}</p>
        )}
        <Nav />
        <div style={{ marginTop: "auto", padding: "16px 12px", borderTop: "1px solid var(--line)" }}>
          {userEmail && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail}</p>
          )}
          <button onClick={signOut} className="btn btn-quiet" style={{ fontSize: 13, width: "100%", textAlign: "left" }}>Sign out</button>
        </div>
      </aside>
      <main className="main"><TrialBanner />{children}</main>
    </div>
    </ToastProvider>
  );
}
