"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { apiFetch, apiCall } from "@/lib/api";

function JoinForm() {
  const [onCall, setOnCall] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState<string | null>(null);
  const [inviteLoaded, setInviteLoaded] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  // An invite is bound to an email. Resolve it and lock the field so nobody signs up under
  // a different address than the one invited. The API re-checks this against the verified
  // JWT regardless — pinning it here just stops the mistake from happening.
  useEffect(() => {
    if (!token) { setInviteLoaded(true); return; }
    (async () => {
      try {
        const inv = await apiCall<{ email: string; company: string | null }>(
          `/team/invite?token=${encodeURIComponent(token)}`
        );
        setEmail(inv.email);
        setCompany(inv.company);
      } catch (e: any) {
        setError(e?.message ?? "This invite link is no longer valid.");
      } finally {
        setInviteLoaded(true);
      }
    })();
  }, [token]);

  async function handleSubmit() {
    setError("");
    if (!email || !password) { setError("Email and password are required."); return; }
    if (!token) { setError("Missing invite token. Please use the link from your invite email."); return; }

    setLoading(true);
    try {
      const supabase = createClient();

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) { setError(signUpError.message); setLoading(false); return; }

      let session = signUpData.session;
      if (!session) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) { setError(signInError.message); setLoading(false); return; }
        session = signInData.session;
      }

      if (!session) { setError("Could not establish a session. Please try signing in."); setLoading(false); return; }

      const res = await apiFetch("/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone: phone || null, on_call: onCall }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || body.message || "Failed to accept invite.");
        setLoading(false);
        return;
      }

      router.push("/today");
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "8vh auto" }}>
      <h1 className="page-title">Join your team</h1>
      <p className="page-sub">
        {company
          ? <>You&apos;ve been invited to <b>{company}</b> on realtyAI.</>
          : <>You&apos;ve been invited to a realtyAI workspace.</>}
      </p>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <input
            type="email"
            value={email}
            readOnly
            disabled
            placeholder={inviteLoaded ? "" : "Loading invite…"}
            style={{ width: "100%", background: "var(--bg)", color: "var(--muted)" }}
          />
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            This invite is for this address. Ask for a new one to use a different email.
          </p>
        </div>
        <input type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div>
          <input type="tel" placeholder="Mobile number, e.g. +1 647 555 0102" style={{ width: "100%" }} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            Used only for hot-lead texts when you&apos;re on call. Standard rates apply; toggle off anytime in Settings.
          </p>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={onCall} onChange={() => setOnCall(!onCall)} style={{ width: 18, height: 18 }} />
          Text me when a lead asks for a person
        </label>
        {error && <p style={{ color: "#c2703d", fontSize: 13, margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !inviteLoaded || !email}>
          {loading ? "Creating account…" : "Create account & join"}
        </button>
      </div>
    </div>
  );
}

export default function Join() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 420, margin: "8vh auto", color: "var(--muted)" }}>Loading...</div>}>
      <JoinForm />
    </Suspense>
  );
}
