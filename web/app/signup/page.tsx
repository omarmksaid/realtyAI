"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../lib/supabase";

const timezones = [
  "America/Toronto",
  "America/Vancouver",
  "America/Chicago",
  "America/Denver",
  "America/New_York",
  "America/Los_Angeles",
];

export default function Signup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tz, setTz] = useState("America/Toronto");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();

      // 1. Sign up the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { brokerage_name: name } },
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      const userId = authData.user?.id;
      if (!userId) {
        setError("Signup succeeded but no user ID returned.");
        setLoading(false);
        return;
      }

      // 2. Create the company
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .insert({ name, timezone: tz })
        .select("id")
        .single();

      if (companyError) {
        setError(companyError.message);
        setLoading(false);
        return;
      }

      // 3. Create owner membership
      const { error: memberError } = await supabase
        .from("memberships")
        .insert({
          user_id: userId,
          company_id: company.id,
          role: "owner",
          email,
        });

      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      router.push("/today");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "9vh auto", padding: "0 20px" }}>
      <Link href="/" className="brand" style={{ padding: 0 }}>realty<em>AI</em></Link>
      <h1 className="page-title" style={{ marginTop: 18 }}>Create your workspace</h1>
      <p className="page-sub">Joining a team instead? Use the invite link from your email.</p>
      <form onSubmit={handleSubmit} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input placeholder="Brokerage name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <div>
          <select style={{ width: "100%" }} value={tz} onChange={(e) => setTz(e.target.value)}>
            {timezones.map((t) => <option key={t} value={t}>{t.replace("America/", "").replace("_", " ")}</option>)}
          </select>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            Sets your business hours — automation only runs outside them.
          </p>
        </div>
        {error && <p style={{ color: "#c33", fontSize: 14, margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create workspace"}
        </button>
      </form>
      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
        Already have an account? <Link href="/login" style={{ color: "var(--accent-deep)", fontWeight: 600 }}>Log in</Link>
      </p>
    </div>
  );
}
