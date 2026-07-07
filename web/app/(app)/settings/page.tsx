"use client";
import { useState, useEffect, useCallback } from "react";
import { isDemo } from "@/lib/data";
import { apiFetch } from "@/lib/api";

const demoVoices = [
  { id: "v1", name: "Hope", labels: "Canadian accent · warm · mid 30s", pick: true },
  { id: "v2", name: "Archer", labels: "Neutral NA · calm · low register" },
  { id: "v3", name: "Maya", labels: "Slight Indian accent · friendly" },
  { id: "v4", name: "Daniel", labels: "British · measured · professional" },
];

const demoMembers = [
  { user_id: "u1", email: "you@northgate.ca", role: "owner", phone: "+1 (647) 555-0102", on_call: true },
  { user_id: "u2", email: "sam@northgate.ca", role: "agent", phone: "+1 (416) 555-0177", on_call: false },
  { user_id: "u3", email: "dana@northgate.ca", role: "agent", phone: null, on_call: false },
];
const demoPending = [{ email: "marc@northgate.ca", role: "agent", expires_at: new Date(Date.now() + 6 * 86400_000).toISOString() }];

interface Member { user_id: string; email: string; role: string; phone: string | null; on_call: boolean }
interface Invite { email: string; role: string; expires_at: string }

export default function Settings() {
  const [selected, setSelected] = useState("v1");
  const [voices, setVoices] = useState(demoVoices);
  const [members, setMembers] = useState<Member[]>(demoMembers);
  const [pending, setPending] = useState<Invite[]>(demoPending);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const fetchTeam = useCallback(async () => {
    if (isDemo) return;
    try {
      const res = await apiFetch("/team");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (data.members?.length) setMembers(data.members);
      setPending(data.pending ?? []);
    } catch (e) {
      console.error("Failed to fetch team, using demo data", e);
    }
  }, []);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  async function toggleOnCall(member: Member) {
    const newVal = !member.on_call;
    setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: newVal } : m));
    if (isDemo) return;
    try {
      await apiFetch(`/team/members/${member.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ on_call: newVal }),
      });
    } catch (e) {
      console.error("Failed to toggle on-call", e);
      setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: !newVal } : m));
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    if (!isDemo) {
      try {
        const res = await apiFetch("/team/invites", {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail.trim() }),
        });
        if (res.ok) {
          setPending((p) => [...p, { email: inviteEmail.trim(), role: "agent", expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }]);
          setInviteEmail("");
        }
      } catch (e) {
        console.error("Failed to send invite", e);
      }
    } else {
      setPending((p) => [...p, { email: inviteEmail.trim(), role: "agent", expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }]);
      setInviteEmail("");
    }
    setInviting(false);
  }

  function formatPhone(phone: string | null) {
    return phone ?? "— no phone";
  }

  function daysUntil(iso: string) {
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
    return d > 0 ? `${d} day${d === 1 ? "" : "s"}` : "expired";
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Channel identity for this workspace.</p>

      <div className="card card-pad">
        <p className="section-label">Calling voice</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          The voice leads hear on after-hours calls. Previews read your actual first message.
        </p>
        {voices.map((v) => (
          <div className="doc-row" key={v.id}>
            <span>
              <b>{v.name}</b>
              <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{typeof v.labels === "string" ? v.labels : Object.values(v.labels ?? {}).join(" · ")}</span>
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ padding: "5px 12px", fontSize: 13 }}>Preview</button>
              <button
                className={`btn ${selected === v.id ? "btn-primary" : ""}`}
                style={{ padding: "5px 12px", fontSize: 13 }}
                onClick={() => setSelected(v.id)}>
                {selected === v.id ? "Selected" : "Use"}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="card card-pad">
        <p className="section-label">Team &amp; on-call</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          On-call members get a text the moment a lead asks for a person.
        </p>
        {members.map((m) => (
          <div className="doc-row" key={m.user_id}>
            <span><b>{m.email}</b><span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{m.role.charAt(0).toUpperCase() + m.role.slice(1)} · {formatPhone(m.phone)}</span></span>
            <span className={`chip ${m.on_call ? "chip-ai" : "chip-lang"}`} style={{ cursor: "pointer" }} onClick={() => toggleOnCall(m)}>
              {m.on_call ? "On call" : "Off"}
            </span>
          </div>
        ))}
        {pending.map((inv) => (
          <div className="doc-row" key={inv.email}>
            <span style={{ color: "var(--muted)" }}>{inv.email} <span style={{ fontSize: 13 }}>· invite sent, expires in {daysUntil(inv.expires_at)}</span></span>
            <span className="chip chip-warm">Pending</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <input placeholder="teammate@company.ca" style={{ flex: 1 }} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInvite()} />
          <button className="btn btn-primary" disabled={inviting} onClick={sendInvite}>{inviting ? "Sending…" : "Send invite"}</button>
        </div>
      </div>

      <div className="card card-pad">
        <p className="section-label">WhatsApp sender</p>
        <div className="doc-row"><span>Number</span><span>+1 (416) 555-0138</span></div>
        <div className="doc-row"><span>Display name</span><span>Northgate Realty</span></div>
        <div className="doc-row"><span>Quality rating</span><span className="chip chip-ai">High</span></div>
      </div>
    </>
  );
}
