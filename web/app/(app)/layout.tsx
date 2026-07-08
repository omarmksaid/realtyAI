"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { getCompanyId } from "@/lib/api";
import { Nav } from "./nav";
import TrialBanner from "./trial-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(isDemo);
  const [companyName, setCompanyName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (isDemo) return;
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserEmail(session.user.email ?? "");
      setReady(true);

      // Fetch company name
      try {
        const companyId = await getCompanyId();
        if (companyId) {
          const { data } = await supabase
            .from("companies")
            .select("name")
            .eq("id", companyId)
            .single();
          if (data) setCompanyName(data.name);
        }
      } catch {}
    });
  }, [router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!ready) return null;

  return (
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
  );
}
