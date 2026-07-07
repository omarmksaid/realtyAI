"use client";
import { useState } from "react";

export default function Join() {
  const [onCall, setOnCall] = useState(true);
  return (
    <div style={{ maxWidth: 420, margin: "8vh auto" }}>
      <h1 className="page-title">Join Northgate Realty</h1>
      <p className="page-sub">You&apos;ve been invited to the realtyAI workspace.</p>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" placeholder="Work email" defaultValue="sam@northgate.ca" />
        <input type="password" placeholder="Create a password" />
        <div>
          <input type="tel" placeholder="Mobile number, e.g. +1 647 555 0102" style={{ width: "100%" }} />
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>
            Used only for hot-lead texts when you&apos;re on call. Standard rates apply; toggle off anytime in Settings.
          </p>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={onCall} onChange={() => setOnCall(!onCall)} style={{ width: 18, height: 18 }} />
          Text me when a lead asks for a person
        </label>
        <button className="btn btn-primary">Create account &amp; join</button>
        {/* Live: Supabase signUp -> POST /team/accept { token, phone, on_call } with the new session JWT */}
      </div>
    </div>
  );
}
