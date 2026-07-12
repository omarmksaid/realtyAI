"use client";

import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useRole } from "@/lib/role";
import { isDemo } from "@/lib/data";

interface Step {
  key: string;
  label: string;
  done: boolean;
  detail: string | null;
  blocking: boolean;
  action: string | null;
}
interface Provisioning {
  ready: boolean;
  voice_ready: boolean;
  whatsapp_ready: boolean;
  steps: Step[];
}

/**
 * Onboarding status for this workspace.
 *
 * Half of provisioning can't be automated — Meta verifies each brokerage's business and
 * approves each template against the sender's own account, which takes days. So the state
 * has to be VISIBLE: without this, a half-provisioned workspace looks identical to a working
 * one right up until a lead arrives and the send fails. That's the difference between
 * onboarding two brokerages and onboarding twenty.
 */
export default function Provisioning() {
  const [data, setData] = useState<Provisioning | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [firstTouch, setFirstTouch] = useState("");
  const [reengage, setReengage] = useState("");
  const toast = useToast();
  const { isAdmin } = useRole();

  const load = useCallback(async () => {
    if (isDemo) return;
    try {
      setData(await apiCall<Provisioning>("/agent/company/provisioning"));
    } catch (e) {
      console.error("Failed to load provisioning status", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function retryVoice() {
    setBusy("voice");
    try {
      await apiCall("/agent/company/provision-voice", { method: "POST" });
      await load();
      toast.show("Voice is provisioned — this workspace can place AI calls.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't provision voice.");
    } finally {
      setBusy(null);
    }
  }

  async function saveTemplates() {
    setBusy("templates");
    try {
      await apiCall("/agent/company/whatsapp-sender", {
        method: "PUT",
        body: JSON.stringify({
          first_touch_template_sid: firstTouch.trim() || undefined,
          reengage_template_sid: reengage.trim() || undefined,
          // Saving an approved template implies the sender itself cleared Meta review.
          whatsapp_sender_approved: firstTouch.trim() ? true : undefined,
        }),
      });
      setFirstTouch("");
      setReengage("");
      await load();
      toast.show("Saved. WhatsApp is ready for this workspace.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save those template SIDs.");
    } finally {
      setBusy(null);
    }
  }

  if (isDemo || !data) return null;

  const missing = data.steps.filter((s) => !s.done);
  const templatesDone = data.steps.find((s) => s.key === "templates")?.done;
  const numberDone = data.steps.find((s) => s.key === "number")?.done;

  return (
    <div className="card card-pad">
      <p className="section-label">Setup status</p>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        {missing.length === 0
          ? "This workspace is fully provisioned."
          : "Leads won't be reached on a channel until its setup is complete."}
      </p>

      {data.steps.map((s) => (
        <div
          key={s.key}
          className="doc-row"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
        >
          <span style={{ minWidth: 0 }}>
            <b>{s.label}</b>
            {s.detail && (
              <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 13 }}>{s.detail}</span>
            )}
            {!s.done && s.action && (
              <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2 }}>{s.action}</div>
            )}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* A blocking step that isn't done is the reason nothing works — say so. */}
            <span className={`chip ${s.done ? "chip-ai" : s.blocking ? "chip-cold" : "chip-warm"}`}>
              {s.done ? "Ready" : s.blocking ? "Required" : "Pending"}
            </span>
            {isAdmin && s.key === "voice" && !s.done && numberDone && (
              <button
                className="btn btn-quiet"
                style={{ fontSize: 12, padding: "2px 8px" }}
                disabled={busy === "voice"}
                onClick={retryVoice}
              >
                {busy === "voice" ? "Provisioning…" : "Provision"}
              </button>
            )}
          </span>
        </div>
      ))}

      {/* The two Meta steps can't be automated — they're an approval queue. Record the
          result here once it lands. */}
      {isAdmin && !templatesDone && numberDone && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
            Once Meta approves this brokerage&apos;s WhatsApp sender and templates, paste the
            template SIDs here. Business-initiated WhatsApp can&apos;t send without them.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="First-touch template SID (HX…)"
              value={firstTouch}
              onChange={(e) => setFirstTouch(e.target.value)}
            />
            <input
              placeholder="Re-engagement template SID (HX…) — optional"
              value={reengage}
              onChange={(e) => setReengage(e.target.value)}
            />
            <div>
              <button
                className="btn btn-primary"
                disabled={busy === "templates" || !firstTouch.trim()}
                onClick={saveTemplates}
              >
                {busy === "templates" ? "Saving…" : "Save templates"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
