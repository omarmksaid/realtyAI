import Link from "next/link";

export default function Signup() {
  return (
    <div style={{ maxWidth: 400, margin: "9vh auto", padding: "0 20px" }}>
      <Link href="/" className="brand" style={{ padding: 0 }}>realty<em>AI</em></Link>
      <h1 className="page-title" style={{ marginTop: 18 }}>Create your workspace</h1>
      <p className="page-sub">Joining a team instead? Use the invite link from your email.</p>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input placeholder="Brokerage name" />
        <input type="email" placeholder="Work email" />
        <input type="password" placeholder="Create a password" />
        <div>
          <select style={{ width: "100%" }}><option>America/Toronto (EDT)</option></select>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            Sets your business hours — automation only runs outside them.
          </p>
        </div>
        <button className="btn btn-primary">Create workspace</button>
        <button className="btn">Continue with Google</button>
        {/* Live: supabase.auth.signUp -> insert companies row + owner membership */}
      </div>
      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
        Already have an account? <Link href="/login" style={{ color: "var(--accent-deep)", fontWeight: 600 }}>Log in</Link>
      </p>
    </div>
  );
}
