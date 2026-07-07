import Link from "next/link";

export default function Login() {
  return (
    <div style={{ maxWidth: 380, margin: "10vh auto", padding: "0 20px" }}>
      <Link href="/" className="brand" style={{ padding: 0 }}>realty<em>AI</em></Link>
      <h1 className="page-title" style={{ marginTop: 18 }}>Sign in</h1>
      <p className="page-sub">Use your work email.</p>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" placeholder="you@brokerage.com" />
        <input type="password" placeholder="Password" />
        <button className="btn btn-primary">Sign in</button>
        <button className="btn">Continue with Google</button>
      </div>
      {/* Wire with @supabase/ssr: supabase.auth.signInWithPassword / signInWithOAuth.
          Membership row determines company scope; RLS does the rest. */}
      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
        New here? <Link href="/signup" style={{ color: "var(--accent-deep)", fontWeight: 600 }}>Create a workspace</Link>
      </p>
    </div>
  );
}
