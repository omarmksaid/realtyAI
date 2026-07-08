"use client";
import { useState, useRef } from "react";
import { isDemo } from "@/lib/data";
import { apiFetch } from "@/lib/api";

interface Msg { role: "user" | "assistant"; text: string; tools?: string }

const seed: Msg[] = [
  { role: "user", text: "Give me all the leads that came in on June 21st" },
  {
    role: "assistant",
    tools: "search_leads · date 2026-06-21",
    text: "4 leads came in on Saturday, June 21 — all after hours:\n\n• Reza Karimi — The Riv (Vaughan) · 11:47 PM · Hot — asked about deposit structure twice\n• Priya Sharma — Union East (Scarborough) · 11:19 PM · Hot — requested specific floor plans\n• Wei Chen — Harbourline (Mississauga) · 10:02 PM · Warm — occupancy + parking questions\n• Amandeep Gill — Union East · 2:11 AM · Cold — no reply to first touch yet\n\nWant the full transcript for any of them?",
  },
  { role: "user", text: "What did Reza ask about on his call last week?" },
  {
    role: "assistant",
    tools: "search_leads · \"Reza\" → get_conversation",
    text: "On the June 28 call (2m 40s), Reza asked whether the 5% deposit extends past the July allocation, and whether Tower A has any 2-bed units under $780K. The AI confirmed the deposit schedule, said unit pricing would be confirmed by the team, and booked him a 9:00 AM callback — which is on your digest for Monday.",
  },
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>(isDemo ? seed : []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadId = useRef<string | null>(null);

  async function send() {
    if (!draft.trim() || sending) return;
    const userText = draft.trim();
    setMsgs((m) => [...m, { role: "user", text: userText }]);
    setDraft("");

    if (isDemo) {
      setMsgs((m) => [...m, { role: "assistant", text: "Demo mode — connect Supabase and the API to query your real leads." }]);
      return;
    }

    setSending(true);
    try {
      // Create thread on first real message
      if (!threadId.current) {
        const res = await apiFetch("/assistant/threads", {
          method: "POST",
          body: JSON.stringify({ title: userText.slice(0, 80) }),
        });
        if (!res.ok) throw new Error("thread creation failed");
        const data = await res.json();
        threadId.current = data.id;
      }

      const res = await apiFetch(`/assistant/threads/${threadId.current}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: userText }),
      });
      if (!res.ok) throw new Error("assistant call failed");
      const data = await res.json();

      const toolSummary = (data.toolActivity ?? [])
        .map((t: any) => t.name ?? t.tool)
        .filter(Boolean)
        .join(" · ");

      setMsgs((m) => [...m, {
        role: "assistant",
        text: data.answer,
        tools: toolSummary || undefined,
      }]);
    } catch (e) {
      console.error("Assistant error", e);
      setMsgs((m) => [...m, { role: "assistant", text: "Something went wrong — please try again." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Assistant</h1>
      <p className="page-sub">Ask anything about your leads and conversations. Answers come only from your company&apos;s data.</p>
      <div className="card">
        <div className="thread">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="bubble bubble-agent">{m.text}</div>
            ) : (
              <div key={i} className="bubble bubble-lead" style={{ maxWidth: "78%", whiteSpace: "pre-wrap" }}>
                {m.tools && <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>Looked up: {m.tools}</div>}
                {m.text}
              </div>
            )
          )}
        </div>
        <div className="composer">
          <input value={draft} placeholder='Try "how many leads per project last week?"'
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="btn btn-primary" onClick={send} disabled={sending}>{sending ? "…" : "Ask"}</button>
        </div>
      </div>
    </>
  );
}
