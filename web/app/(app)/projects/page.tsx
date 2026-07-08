"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { demoProjects, isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { apiFetch, getCompanyId } from "@/lib/api";

interface Doc { id: string; name: string; source: string; status: string }
interface Project {
  id: string; name: string; city: string | null; leads30d: number;
  driveLinked: boolean; docs: Doc[];
}

const statusColor: Record<string, string> = { ready: "chip-ai", processing: "chip-warm" };
const sourceIcon: Record<string, string> = { drive: "Drive", text: "Text", upload: "Upload" };

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>(demoProjects);
  const [loading, setLoading] = useState(!isDemo);
  const [open, setOpen] = useState<string | null>(demoProjects[0]?.id ?? null);
  const [tab, setTab] = useState<"drive" | "text" | "upload">("drive");
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [driveFolderUrls, setDriveFolderUrls] = useState<Record<string, string>>({});
  const [linkingSaving, setLinkingSaving] = useState(false);

  const fetchProjects = useCallback(async () => {
    if (isDemo) return;
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;

      const { data: rows } = await supabase
        .from("projects")
        .select("id, name, city, status")
        .eq("company_id", companyId)
        .neq("status", "archived");

      if (!rows?.length) return;

      // Fetch documents for all projects
      const { data: docs } = await supabase
        .from("documents")
        .select("id, name, source, status, project_id")
        .eq("company_id", companyId);

      // Fetch lead counts per project (last 30 days)
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: leads } = await supabase
        .from("leads")
        .select("project_id")
        .eq("company_id", companyId)
        .gte("created_at", since);

      const leadCounts: Record<string, number> = {};
      for (const l of leads ?? []) {
        if (l.project_id) leadCounts[l.project_id] = (leadCounts[l.project_id] ?? 0) + 1;
      }

      const mapped: Project[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        leads30d: leadCounts[r.id] ?? 0,
        driveLinked: false, // TODO: check projects.drive_folder_url
        docs: (docs ?? [])
          .filter((d: any) => d.project_id === r.id)
          .map((d: any) => ({ id: d.id, name: d.name, source: d.source, status: d.status })),
      }));
      setProjects(mapped);
      if (!open || !mapped.find((p) => p.id === open)) setOpen(mapped[0]?.id ?? null);
    } catch (e) {
      console.error("Failed to fetch projects, using demo data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  async function addTextKnowledge(projectId: string) {
    if (!pasteText.trim() || isDemo) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/agent/projects/${projectId}/knowledge/text`, {
        method: "POST",
        body: JSON.stringify({ name: "Pasted text", content: pasteText.trim() }),
      });
      if (res.ok) {
        setPasteText("");
        fetchProjects(); // refresh docs list
      }
    } catch (e) {
      console.error("Failed to add knowledge", e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileUpload(projectId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    if (isDemo) { alert("File upload requires Supabase connection"); return; }
    setUploading(true);
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) throw new Error("No company");

      for (const file of Array.from(files)) {
        const path = `${companyId}/${projectId}/${Date.now()}-${file.name}`;
        const { error: uploadErr } = await supabase.storage.from("knowledge").upload(path, file);
        if (uploadErr) { console.error("Upload error", uploadErr); continue; }

        // Trigger ingestion by creating a document record via API
        await apiFetch(`/agent/projects/${projectId}/knowledge/upload`, {
          method: "POST",
          body: JSON.stringify({ name: file.name, storage_path: path }),
        });
      }
      fetchProjects();
    } catch (e) {
      console.error("Failed to upload files", e);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveDriveFolder(projectId: string) {
    const url = driveFolderUrls[projectId]?.trim();
    if (!url) { alert("Please enter a Google Drive folder URL"); return; }
    if (isDemo) { alert("Drive sync requires backend setup"); return; }
    setLinkingSaving(true);
    try {
      await apiFetch(`/agent/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ drive_folder_url: url }),
      });
      // Update local state to show "Re-sync" next time
      setProjects((ps) => ps.map((p) => p.id === projectId ? { ...p, driveLinked: true } : p));
      alert("Drive folder saved. Sync will run overnight once the handler is configured.");
    } catch (e) {
      console.error("Failed to save drive folder", e);
    } finally {
      setLinkingSaving(false);
    }
  }

  if (loading) return <><h1 className="page-title">Projects</h1><p className="page-sub">Loading…</p></>;

  return (
    <>
      <h1 className="page-title">Projects</h1>
      <p className="page-sub">
        Each project’s knowledge is what the AI is allowed to say. It never answers from anything else.
      </p>

      {projects.map((p) => (
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
                  <input style={{ flex: 1 }} placeholder="https://drive.google.com/drive/folders/…" value={driveFolderUrls[p.id] ?? (p.driveLinked ? "https://drive.google.com/drive/folders/1xK…riv-sales" : "")} onChange={(e) => setDriveFolderUrls((prev) => ({ ...prev, [p.id]: e.target.value }))} />
                  <button className="btn btn-primary" disabled={linkingSaving} onClick={() => saveDriveFolder(p.id)}>{p.driveLinked ? "Re-sync" : "Link folder"}</button>
                </div>
              )}
              {tab === "drive" && (
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                  Docs, PDFs, and images in the folder sync nightly. Drop the new price sheet in Drive and the AI knows it by the next lead.
                </p>
              )}

              {tab === "text" && (
                <>
                  <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={`e.g. "July incentive: 5% in 30 days, 5% in 180 days. Parking $65,000, waived on 2-bed+den and larger. Occupancy Q3 2029."`} />
                  <div style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={submitting} onClick={() => addTextKnowledge(p.id)}>{submitting ? "Adding…" : "Add to knowledge"}</button></div>
                </>
              )}

              {tab === "upload" && (
                <div style={{ border: "1.5px dashed var(--line)", borderRadius: 8, padding: "34px 20px", textAlign: "center", color: "var(--muted)" }}>
                  {uploading ? "Uploading…" : "Drop floor plans, price lists, or renderings here — PDF, DOCX, PNG, JPG"}
                  <input type="file" multiple accept=".pdf,.docx,.png,.jpg,.jpeg" ref={fileInputRef} style={{ display: "none" }} onChange={(e) => handleFileUpload(p.id, e.target.files)} />
                  <div style={{ marginTop: 12 }}><button className="btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>Choose files</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
