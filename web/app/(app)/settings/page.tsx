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
  const [spend, setSpend] = useState<Record<string, number>>({});
  const [totalSpend, setTotalSpend] = useState(0);
  const [waNumber, setWaNumber] = useState("");
  const [waInput, setWaInput] = useState("");
  const [savingWa, setSavingWa] = useState(false);
  const [buyingNumber, setBuyingNumber] = useState(false);
  const [searchingNumbers, setSearchingNumbers] = useState(false);
  const [buyAreaCode, setBuyAreaCode] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<{ phoneNumber: string; locality: string; region: string }[]>([]);

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

      // Fetch company WhatsApp number
      const { data: companyData } = await supabase
        .from("companies").select("settings").eq("id", companyId).single();
      const savedNumber = (companyData?.settings as any)?.whatsapp_number;
      if (savedNumber) { setWaNumber(savedNumber); setWaInput(savedNumber); }

      // Fetch this month's spend
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { data: costs } = await supabase
        .from("cost_events")
        .select("category, amount_usd")
        .eq("company_id", companyId)
        .gte("created_at", monthStart.toISOString());
      if (costs) {
        const totals: Record<string, number> = {};
        let total = 0;
        for (const c of costs) {
          totals[c.category] = (totals[c.category] ?? 0) + c.amount_usd;
          total += c.amount_usd;
        }
        setSpend(totals);
        setTotalSpend(Math.round(total * 100) / 100);
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
      <div className="card card-pad">
        <p className="section-label">WhatsApp number</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          The number leads see when the AI or your team messages them on WhatsApp.
        </p>
        {waNumber ? (
          <>
            <div className="doc-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><b>{waNumber}</b> <span style={{ color: "var(--muted)", fontSize: 13 }}>· active</span></span>
              <span className="chip chip-ai">Connected</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              To change your number, contact support. Only one number per workspace is supported.
            </p>
          </>
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>No WhatsApp number configured. Choose one of the options below.</p>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Option 1: Use an existing number</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Enter number (e.g. +14165551234)" value={waInput} onChange={(e) => setWaInput(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={savingWa || !waInput.trim()} onClick={async () => {
                  setSavingWa(true);
                  try {
                    const res = await apiFetch("/agent/company/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ whatsapp_number: waInput.trim() }) });
                    if (res.ok) setWaNumber(waInput.trim());
                  } catch {} finally { setSavingWa(false); }
                }}>{savingWa ? "Saving…" : "Save"}</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Option 2: Get a new number (~$1/mo)</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input placeholder="Area code (e.g. 416)" value={buyAreaCode} onChange={(e) => setBuyAreaCode(e.target.value)} style={{ width: 140 }} />
                <button className="btn" style={{ fontSize: 13 }} disabled={searchingNumbers} onClick={async () => {
                  setSearchingNumbers(true);
                  setAvailableNumbers([]);
                  try {
                    const res = await apiFetch("/agent/company/search-numbers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: "US", area_code: buyAreaCode || undefined }) });
                    if (res.ok) {
                      const data = await res.json();
                      setAvailableNumbers(data.numbers ?? []);
                      if (!data.numbers?.length) alert("No numbers available in that area. Try a different area code.");
                    }
                  } catch {} finally { setSearchingNumbers(false); }
                }}>{searchingNumbers ? "Searching…" : "Search available numbers"}</button>
              </div>

              {availableNumbers.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {availableNumbers.map((n) => (
                    <div key={n.phoneNumber} className="doc-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>
                        <b>{n.phoneNumber}</b>
                        <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: 8 }}>{n.locality}{n.region ? `, ${n.region}` : ""}</span>
                      </span>
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: "4px 12px" }} disabled={buyingNumber} onClick={async () => {
                        if (!confirm(`Buy ${n.phoneNumber} for ~$1/month?`)) return;
                        setBuyingNumber(true);
                        try {
                          const res = await apiFetch("/agent/company/buy-number", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone_number: n.phoneNumber }) });
                          if (res.ok) {
                            const data = await res.json();
                            setWaNumber(data.phone_number);
                            setAvailableNumbers([]);
                          } else {
                            const err = await res.json().catch(() => ({}));
                            alert(err.error || "Failed to buy number");
                          }
                        } catch { alert("Failed to buy number"); } finally { setBuyingNumber(false); }
                      }}>{buyingNumber ? "…" : "Buy this number"}</button>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                After purchase, the number needs WhatsApp Business registration with Meta (1-3 day review) before it can send WhatsApp messages. SMS and voice work immediately.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="card card-pad">
        <p className="section-label">Usage this month</p>
        {totalSpend === 0 && !isDemo ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No usage yet this month.</p>
        ) : (
          <>
            <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 12 }}>${totalSpend.toFixed(2)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {Object.entries(spend).map(([cat, amount]) => (
                <div key={cat} style={{ fontSize: 13 }}>
                  <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{cat}</span>
                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>${amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
