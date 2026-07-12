"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [removed, setRemoved] = useState(false);

  // The app layout redirects here with ?removed=1 when a signed-in user turns out to have
  // no membership — they were removed from the workspace. Without this they'd be dumped on
  // a bare login screen with no idea why they were kicked out. Read from location rather
  // than useSearchParams to avoid needing a Suspense boundary around the whole page.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setRemoved(new URLSearchParams(window.location.search).get("removed") === "1");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/today");
  }

  return (
    <div style={{ maxWidth: 380, margin: "10vh auto", padding: "0 20px" }}>
      <Link href="/" className="brand" style={{ padding: 0 }}>realty<em>AI</em></Link>
      <h1 className="page-title" style={{ marginTop: 18 }}>Sign in</h1>
      <p className="page-sub">Use your work email.</p>
      <form onSubmit={handleSubmit} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" placeholder="you@brokerage.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {removed && !error && (
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            You no longer have access to that workspace. Sign in again, or ask an admin to re-invite you.
          </p>
        )}
        {error && <p style={{ color: "#c33", fontSize: 14, margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
        New here? <Link href="/signup" style={{ color: "var(--accent-deep)", fontWeight: 600 }}>Create a workspace</Link>
      </p>
    </div>
  );
}
