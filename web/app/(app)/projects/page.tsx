"use client";
import { useState } from "react";
import { demoProjects } from "@/lib/data";

const statusColor: Record<string, string> = { ready: "chip-ai", processing: "chip-warm" };
const sourceIcon: Record<string, string> = { drive: "Drive", text: "Text", upload: "Upload" };

export default function Projects() {
  const [open, setOpen] = useState<string | null>("p1");
  const [tab, setTab] = useState<"drive" | "text" | "upload">("drive");

  return (
    <>
      <h1 className="page-title">Projects</h1>
      <p className="page-sub">
        Each project’s knowledge is what the AI is allowed to say. It never answers from anything else.
      </p>

      {demoProjects.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b style={{ fontSize: 16 }}>{p.name}</b>
              <span style={{ color: "var(--muted)", marginLeft: 8 }}>{p.city}</span>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                {p.leads30d} leads · 30 days · {p.docs.length} knowledge source{p.docs.length === 1 ? "" : "s"}
              </div>
            </div>
            <button className="btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
              {open === p.id ? "Close" : "Manage knowledge"}
            </button>
          </div>

          {open === p.id && (
            <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
              {p.docs.length > 0 && (
                <>
                  <p className="section-label">Sources</p>
                  {p.docs.map((d) => (
                    <div className="doc-row" key={d.id}>
                      <span>
                        <span className="chip chip-lang" style={{ marginRight: 10 }}>{sourceIcon[d.source]}</span>
                        {d.name}
                      </span>
                      <span className={`chip ${statusColor[d.status]}`}>
                        {d.status === "ready" ? "Ready" : "Processing…"}
                      </span>
                    </div>
                  ))}
                  <div style={{ height: 18 }} />
                </>
              )}

              <p className="section-label">Add knowledge</p>
              <div className="tabs">
                <button className={`tab ${tab === "drive" ? "active" : ""}`} onClick={() => setTab("drive")}>Link Google Drive folder</button>
                <button className={`tab ${tab === "text" ? "active" : ""}`} onClick={() => setTab("text")}>Paste text</button>
                <button className={`tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>Upload files</button>
              </div>

              {tab === "drive" && (
                <div style={{ display: "flex", gap: 10 }}>
                  <input style={{ flex: 1 }} placeholder="https://drive.google.com/drive/folders/…" defaultValue={p.driveLinked ? "https://drive.google.com/drive/folders/1xK…riv-sales" : ""} />
                  <button className="btn btn-primary">{p.driveLinked ? "Re-sync" : "Link folder"}</button>
                </div>
              )}
              {tab === "drive" && (
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                  Docs, PDFs, and images in the folder sync nightly. Drop the new price sheet in Drive and the AI knows it by the next lead.
                </p>
              )}

              {tab === "text" && (
                <>
                  <textarea rows={5} placeholder={`e.g. "July incentive: 5% in 30 days, 5% in 180 days. Parking $65,000, waived on 2-bed+den and larger. Occupancy Q3 2029."`} />
                  <div style={{ marginTop: 10 }}><button className="btn btn-primary">Add to knowledge</button></div>
                </>
              )}

              {tab === "upload" && (
                <div style={{ border: "1.5px dashed var(--line)", borderRadius: 8, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
                  Drop floor plans, price lists, or renderings here — PDF, DOCX, PNG, JPG
                  <div style={{ marginTop: 12 }}><button className="btn">Choose files</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
