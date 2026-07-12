"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { demoProjects, isDemo } from "@/lib/data";
import { createClient } from "@/lib/supabase";
import { apiFetch, getCompanyId } from "@/lib/api";

interface Doc { id: string; name: string; source: string; status: string; content?: string }
interface Project {
  id: string; name: string; city: string | null; leads30d: number;
  docs: Doc[];
}

const statusColor: Record<string, string> = { ready: "chip-ai", processing: "chip-warm" };
const sourceIcon: Record<string, string> = { text: "Text", upload: "Upload" };

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>(isDemo ? demoProjects : []);
  const [loading, setLoading] = useState(!isDemo);
  const [open, setOpen] = useState<string | null>(isDemo ? (demoProjects[0]?.id ?? null) : null);
  const [tab, setTab] = useState<"text" | "upload">("text");
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [creating, setCreating] = useState(false);

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

      if (!rows?.length) { setProjects([]); setLoading(false); return; }

      // Fetch documents and their chunks for all projects
      const { data: docs } = await supabase
        .from("documents")
        .select("id, name, source, status, project_id")
        .eq("company_id", companyId);

      // Fetch chunk content grouped by document
      const { data: chunks } = await supabase
        .from("doc_chunks")
        .select("document_id, content")
        .eq("company_id", companyId)
        .order("created_at");
      const chunksByDoc: Record<string, string> = {};
      for (const c of chunks ?? []) {
        chunksByDoc[c.document_id] = (chunksByDoc[c.document_id] ?? "") + (chunksByDoc[c.document_id] ? "\n" : "") + c.content;
      }

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
        docs: (docs ?? [])
          .filter((d: any) => d.project_id === r.id)
          .map((d: any) => ({ id: d.id, name: d.name, source: d.source, status: d.status, content: chunksByDoc[d.id] })),
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

  /** Goes through the API, not Supabase directly: RLS defines no delete policy, so a
   *  browser-issued delete is denied — and the client returns that as `{error}` rather
   *  than throwing, which is why this used to fail silently and leave the row on screen. */
  async function deleteDoc(projectId: string, docId: string) {
    if (isDemo) return;
    if (!confirm("Delete this knowledge source? The AI will no longer use it.")) return;
    setDeletingDoc(docId);
    try {
      const res = await apiFetch(`/agent/projects/${projectId}/knowledge/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("Failed to delete document:", res.status, body);
        alert("Couldn't delete that knowledge source. Please try again.");
        return;
      }
      await fetchProjects();
    } catch (e) {
      console.error("Failed to delete document:", e);
      alert("Couldn't delete that knowledge source. Please try again.");
    } finally {
      setDeletingDoc(null);
    }
  }

  async function createProject() {
    if (!newName.trim()) return;
    if (isDemo) { setShowCreate(false); return; }
    setCreating(true);
    try {
      const supabase = createClient();
      const companyId = await getCompanyId();
      if (!companyId) return;
      const { error } = await supabase.from("projects").insert({
        company_id: companyId,
        name: newName.trim(),
        city: newCity.trim() || null,
      });
      if (error) {
        console.error("Failed to create project:", error);
      } else {
        setNewName("");
        setNewCity("");
        setShowCreate(false);
        fetchProjects();
      }
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <><h1 className="page-title">Projects</h1><p className="page-sub">Loading…</p></>;

  return (
    <>
      <h1 className="page-title">Projects</h1>
      <p className="page-sub">
        Each project’s knowledge is what the AI is allowed to say. It never answers from anything else.
      </p>

      {showCreate ? (
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <p className="section-label">New project</p>
          <input placeholder="Project name (e.g. The Riv — Vaughan)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="City (optional)" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={createProject} disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create project"}
            </button>
            <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <button className="btn" onClick={() => setShowCreate(true)}>+ New project</button>
        </div>
      )}

      {projects.length === 0 && !loading && (
        <div className="card card-pad" style={{ color: "var(--muted)" }}>
          No projects yet. Create one above to start adding knowledge for the AI.
        </div>
      )}

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
                    <div key={d.id}>
                      <div className="doc-row" style={{ cursor: d.content ? "pointer" : "default" }} onClick={() => d.content && setExpandedDoc(expandedDoc === d.id ? null : d.id)}>
                        <span>
                          <span className="chip chip-lang" style={{ marginRight: 10 }}>{sourceIcon[d.source]}</span>
                          {d.name}
                          {d.content && <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{expandedDoc === d.id ? "▾" : "▸"}</span>}
                        </span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span className={`chip ${statusColor[d.status]}`}>
                            {d.status === "ready" ? "Ready" : "Processing…"}
                          </span>
                          {!isDemo && (
                            <button
                              className="btn btn-quiet"
                              style={{ fontSize: 12, padding: "2px 8px", color: "#c33" }}
                              disabled={deletingDoc === d.id}
                              onClick={(e) => { e.stopPropagation(); deleteDoc(p.id, d.id); }}
                            >
                              {deletingDoc === d.id ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </span>
                      </div>
                      {expandedDoc === d.id && d.content && (
                        <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", margin: "4px 0 12px", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink)", maxHeight: 300, overflow: "auto" }}>
                          {d.content}
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ height: 18 }} />
                </>
              )}

              <p className="section-label">Add knowledge</p>
              <div className="tabs">
                <button className={`tab ${tab === "text" ? "active" : ""}`} onClick={() => setTab("text")}>Paste text</button>
                <button className={`tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>Upload files</button>
              </div>

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
