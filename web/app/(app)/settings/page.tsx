"use client";
import { useState, useEffect, useCallback } from "react";
import { isDemo } from "@/lib/data";
import { apiFetch, getCompanyId } from "@/lib/api";
import { createClient } from "@/lib/supabase";

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
  const [members, setMembers] = useState<Member[]>(isDemo ? demoMembers : []);
  const [pending, setPending] = useState<Invite[]>(isDemo ? demoPending : []);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    if (isDemo) return;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setCurrentUserId(session.user.id);

      const companyId = await getCompanyId();
      if (!companyId) return;

      // Fetch members directly from Supabase
      const { data: membersData } = await supabase
        .from("memberships")
        .select("user_id, email, role, phone, on_call")
        .eq("company_id", companyId);

      if (membersData) {
        setMembers(membersData.map((m: any) => ({
          user_id: m.user_id,
          email: m.email ?? "",
          role: m.role,
          phone: m.phone,
          on_call: m.on_call ?? false,
        })));
      }
    } catch (e) {
      console.error("Failed to fetch team", e);
    }
  }, []);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  async function toggleOnCall(member: Member) {
    const newVal = !member.on_call;
    setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: newVal } : m));
    if (isDemo) return;
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      await supabase.from("memberships")
        .update({ on_call: newVal })
        .eq("user_id", member.user_id)
        .eq("company_id", companyId);
    } catch (e) {
      console.error("Failed to toggle on-call", e);
      setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: !newVal } : m));
    }
  }

  async function removeMember(member: Member) {
    if (member.role === "owner") return;
    if (!confirm(`Remove ${member.email} from this workspace?`)) return;
    if (isDemo) {
      setMembers((ms) => ms.filter((m) => m.user_id !== member.user_id));
      return;
    }
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      await supabase.from("memberships")
        .delete()
        .eq("user_id", member.user_id)
        .eq("company_id", companyId);
      setMembers((ms) => ms.filter((m) => m.user_id !== member.user_id));
    } catch (e) {
      console.error("Failed to remove member", e);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    if (!isDemo) {
      try {
        const res = await apiFetch("/team/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
              <button className="btn" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => alert("Voice preview requires ElevenLabs setup")}>Preview</button>
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
        {members.length === 0 && !isDemo && (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No team members yet.</p>
        )}
        {members.map((m) => (
          <div className="doc-row" key={m.user_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span><b>{m.email}</b><span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{m.role.charAt(0).toUpperCase() + m.role.slice(1)} · {formatPhone(m.phone)}</span></span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`chip ${m.on_call ? "chip-ai" : "chip-lang"}`} style={{ cursor: "pointer" }} onClick={() => toggleOnCall(m)}>
                {m.on_call ? "On call" : "Off"}
              </span>
              {m.role !== "owner" && m.user_id !== currentUserId && (
                <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px", color: "#c33" }} onClick={() => removeMember(m)}>Remove</button>
              )}
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
          <input placeholder="teammate@company.com" style={{ flex: 1 }} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInvite()} />
          <button className="btn btn-primary" disabled={inviting} onClick={sendInvite}>{inviting ? "Sending…" : "Send invite"}</button>
        </div>
      </div>
    </>
  );
}
