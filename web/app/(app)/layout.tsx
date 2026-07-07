"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { Nav } from "./nav";
import TrialBanner from "./trial-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(isDemo);

  useEffect(() => {
    if (isDemo) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
  }, [router]);

  if (!ready) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/today" className="brand">realty<em>AI</em></Link>
        <Nav />
      </aside>
      <main className="main"><TrialBanner />{children}</main>
    </div>
  );
}
