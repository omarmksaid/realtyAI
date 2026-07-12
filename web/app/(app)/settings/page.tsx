"use client";
import { useState, useEffect, useCallback } from "react";
import { isDemo } from "@/lib/data";
import { apiFetch, apiCall, getCompanyId } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { useRole } from "@/lib/role";
import Provisioning from "./provisioning";

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
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
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
  const toast = useToast();
  const { isAdmin } = useRole();

  const fetchTeam = useCallback(async () => {
    if (isDemo) return;
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setCurrentUserId(session.user.id);

      const companyId = await getCompanyId();
      if (!companyId) return;

      // GET /team returns { members, pending }. This used to read memberships straight from
      // Supabase and never fetch invites at all — so `pending` was populated only by the
      // local setPending() after sending one, and vanished on every reload. The invites were
      // in the database the whole time; the page just never asked for them.
      try {
        const team = await apiCall<{ members: any[]; pending: Invite[] }>("/team");
        setMembers(
          (team.members ?? []).map((m: any) => ({
            user_id: m.user_id,
            email: m.email ?? "",
            role: m.role,
            phone: m.phone,
            on_call: m.on_call ?? false,
          }))
        );
        setPending(team.pending ?? []);
      } catch (e) {
        console.error("Failed to load team", e);
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

  /** Through the API. memberships has no UPDATE policy either, so this was silently failing
   *  against Supabase: the chip flipped and nothing persisted — meaning nobody got paged for
   *  a hot lead while the dashboard showed them on call. PATCH /team/members/:userId already
   *  existed; the page just wasn't using it. */
  async function toggleOnCall(member: Member) {
    const newVal = !member.on_call;
    setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: newVal } : m));
    if (isDemo) return;
    try {
      await apiCall(`/team/members/${member.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ on_call: newVal }),
      });
    } catch (e: any) {
      console.error("Failed to toggle on-call", e);
      // Roll the chip back — don't leave it showing a state the server rejected.
      setMembers((ms) => ms.map((m) => m.user_id === member.user_id ? { ...m, on_call: !newVal } : m));
      toast.show(e?.message ?? "Couldn't change on-call status.");
    }
  }

  /** Through the API. Deleting straight from Supabase silently failed — memberships has no
   *  DELETE policy — while the UI removed the row anyway, so a "revoked" user kept access
   *  and the dashboard claimed they were gone. Never report a revoke that didn't happen. */
  async function removeMember(member: Member) {
    if (!confirm(`Remove ${member.email} from this workspace? They lose access immediately.`)) return;
    if (isDemo) {
      setMembers((ms) => ms.filter((m) => m.user_id !== member.user_id));
      return;
    }
    setRemoving(member.user_id);
    try {
      await apiCall(`/team/members/${member.user_id}`, { method: "DELETE" });
      await fetchTeam(); // reflect what the server actually did, not what we hoped
      toast.show(`${member.email} no longer has access.`, "success");
    } catch (e: any) {
      console.error("Failed to remove member", e);
      toast.show(e?.message ?? "Couldn't remove that member.");
    } finally {
      setRemoving(null);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    if (!isDemo) {
      try {
        await apiCall("/team/invites", {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail.trim() }),
        });
        setInviteEmail("");
        // Refetch rather than appending a guess — the local copy is what let the list drift
        // from the database in the first place.
        await fetchTeam();
        toast.show(`Invite sent to ${inviteEmail.trim()}.`, "success");
      } catch (e: any) {
        console.error("Failed to send invite", e);
        toast.show(e?.message ?? "Couldn't send that invite. Please try again.");
      } finally {
        setInviting(false);
      }
      return;
    } else {
      setPending((p) => [...p, { email: inviteEmail.trim(), role: "agent", expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() }]);
      setInviteEmail("");
    }
    setInviting(false);
  }

  /** Resend mints a fresh token server-side and pushes the expiry out — the old link is
   *  usually dead, which is why someone is resending in the first place. */
  async function resendInvite(email: string) {
    if (isDemo) return;
    setBusyInvite(email);
    try {
      await apiCall("/team/invites/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      await fetchTeam();
      toast.show(`Invite re-sent to ${email}.`, "success");
    } catch (e: any) {
      console.error("Failed to resend invite", e);
      toast.show(e?.message ?? "Couldn't resend that invite. Please try again.");
    } finally {
      setBusyInvite(null);
    }
  }

  async function revokeInvite(email: string) {
    if (isDemo) return;
    if (!confirm(`Revoke the invite for ${email}? Their link will stop working.`)) return;
    setBusyInvite(email);
    try {
      await apiCall(`/team/invites?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      await fetchTeam();
    } catch (e: any) {
      console.error("Failed to revoke invite", e);
      toast.show(e?.message ?? "Couldn't revoke that invite. Please try again.");
    } finally {
      setBusyInvite(null);
    }
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

      {/* First, because a workspace that isn't provisioned can't reach a lead at all —
          and until now that failed silently, only surfacing when a lead arrived. */}
      <Provisioning />

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
              {/* Revoking access is an owner/admin action — the API enforces it too. */}
              {isAdmin && m.role !== "owner" && m.user_id !== currentUserId && (
                <button
                  className="btn btn-quiet"
                  style={{ fontSize: 12, padding: "2px 8px", color: "#c33" }}
                  disabled={removing === m.user_id}
                  onClick={() => removeMember(m)}
                >
                  {removing === m.user_id ? "Removing…" : "Remove"}
                </button>
              )}
            </span>
          </div>
        ))}
        {pending.map((inv) => {
          const expired = new Date(inv.expires_at).getTime() < Date.now();
          return (
            <div className="doc-row" key={inv.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--muted)" }}>
                {inv.email}{" "}
                <span style={{ fontSize: 13 }}>
                  {expired ? "· invite expired" : `· invite sent, expires in ${daysUntil(inv.expires_at)}`}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className={`chip ${expired ? "chip-cold" : "chip-warm"}`}>
                  {expired ? "Expired" : "Pending"}
                </span>
                {!isDemo && (
                  <>
                    <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px" }}
                      disabled={busyInvite === inv.email}
                      onClick={() => resendInvite(inv.email)}>
                      {busyInvite === inv.email ? "Sending…" : "Resend"}
                    </button>
                    <button className="btn btn-quiet" style={{ fontSize: 12, padding: "2px 8px", color: "#c33" }}
                      disabled={busyInvite === inv.email}
                      onClick={() => revokeInvite(inv.email)}>
                      Revoke
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
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
