"use client";

// Live: GET /agent/company -> { plan, billing_status, trial_days_left, automation_active }
const demo = { plan: "trial", trial_days_left: 9, automation_active: true, clock_started: true };

export default function TrialBanner() {
  if (demo.plan !== "trial") return null;

  if (!demo.automation_active) {
    return (
      <div style={{ background: "var(--hot-wash)", border: "1px solid var(--hot)", borderRadius: 8, padding: "10px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, color: "#712b13" }}>
          <b>Trial ended.</b> Leads are still arriving and your data is safe — automated responses are paused.
        </span>
        <a href="mailto:hello@realtyai.app" className="btn btn-primary" style={{ fontSize: 13, padding: "7px 14px" }}>Pick a plan</a>
      </div>
    );
  }
  return (
    <div style={{ background: "var(--accent-wash)", borderRadius: 8, padding: "9px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5, color: "var(--accent-deep)" }}>
        <b>Trial — {demo.clock_started ? `${demo.trial_days_left} days left` : "starts with your first lead"}.</b> Everything is on: calls, WhatsApp, digest, the works.
      </span>
    </div>
  );
}
