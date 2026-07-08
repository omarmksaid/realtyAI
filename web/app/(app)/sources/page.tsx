"use client";
import { useState, useEffect, useCallback } from "react";
import { isDemo } from "@/lib/data";
import { apiFetch } from "@/lib/api";

const demoProjects = [
  { id: "p1", name: "The Riv — Vaughan" },
  { id: "p2", name: "Union East — Scarborough" },
  { id: "p3", name: "Harbourline — Mississauga" },
  { id: "p4", name: "Lakeview — Pickering" },
];

const seed = {
  unmapped24h: 3,
  meta: {
    label: "Northgate Realty page · webhook subscribed · token healthy",
    forms: [
      { id: "form_887123", name: "The Riv — July 5% Deposit", leads: 61, last: "2h ago", project: "The Riv — Vaughan", project_id: "p1" },
      { id: "form_887124", name: "Union East — Transit Living", leads: 44, last: "38m ago", project: "Union East — Scarborough", project_id: "p2" },
      { id: "form_887125", name: "Harbourline — Waterfront", leads: 29, last: "Yesterday", project: "Harbourline — Mississauga", project_id: "p3" },
      { id: "form_887126", name: "GTA Pre-Con — General", leads: 3, last: "1h ago", project: "", project_id: "" },
    ],
  },
  google: [
    { id: "g1", name: "Lakeview 2-Bed Search", status: "Verified · test received", leads: 12, project: "Lakeview — Pickering", url: "https://api.realtyai.app/webhooks/google?src=8f2a…" },
    { id: "g2", name: "Riv Brand Search", status: "Waiting for test data", leads: 0, project: "The Riv — Vaughan", url: "https://api.realtyai.app/webhooks/google?src=c41b…" },
  ],
};

interface FormRow { id: string; name: string; leads: number; last: string; project: string; project_id: string }
interface SourceRow { id: string; provider: string; label: string; webhook_url: string | null; test_received_at: string | null; forms: FormRow[] }
interface GoogleSourceDisplay { id: string; name: string; status: string; leads: number; project: string; project_id: string; url: string }
interface ProjectOption { id: string; name: string }

export default function Sources() {
  const [metaSources, setMetaSources] = useState<SourceRow[]>([]);
  const [googleSources, setGoogleSources] = useState<SourceRow[]>([]);
  const [projects, setProjectsList] = useState<ProjectOption[]>(isDemo ? demoProjects : []);
  const [unmapped24h, setUnmapped24h] = useState(isDemo ? seed.unmapped24h : 0);
  const [forms, setForms] = useState(isDemo ? seed.meta.forms : []);
  const [googleDisplay, setGoogleDisplay] = useState<GoogleSourceDisplay[]>(
    isDemo ? seed.google.map(g => ({ ...g, project_id: "" })) : []
  );
  const [loading, setLoading] = useState(!isDemo);
  const [live, setLive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFormName, setNewFormName] = useState("");
  const [newFormProject, setNewFormProject] = useState("");
  const [addingForm, setAddingForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    if (isDemo) return;
    try {
      const res = await apiFetch("/sources");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const meta: SourceRow[] = [];
      const google: SourceRow[] = [];
      for (const src of data.sources ?? []) {
        const mapped: SourceRow = {
          id: src.id,
          provider: src.provider,
          label: src.label,
          webhook_url: src.webhook_url,
          test_received_at: src.test_received_at,
          forms: (src.forms ?? []).map((f: any) => ({
            id: f.form_id,
            name: f.name ?? f.form_id,
            leads: f.leads_30d ?? 0,
            last: f.last_lead_at ? timeAgo(f.last_lead_at) : "—",
            project: f.project_id ? (data.projects ?? []).find((p: any) => p.id === f.project_id)?.name ?? "" : "",
            project_id: f.project_id ?? "",
          })),
        };
        if (src.provider === "meta") meta.push(mapped);
        else google.push(mapped);
      }
      setMetaSources(meta);
      setGoogleSources(google);
      setProjectsList((data.projects ?? []).map((p: any) => ({ id: p.id, name: `${p.name}${p.city ? ` — ${p.city}` : ""}` })));
      setUnmapped24h(data.unmapped_24h ?? 0);
      // Flatten meta forms for the table
      if (meta.length > 0) {
        setForms(meta.flatMap((s) => s.forms));
      }
      // Map google sources for display
      if (google.length > 0) {
        setGoogleDisplay(google.map((s) => ({
          id: s.id,
          name: s.label,
          status: s.test_received_at ? "Verified · test received" : "Waiting for test data",
          leads: s.forms.reduce((acc, f) => acc + f.leads, 0),
          project: s.forms[0]?.project ?? "",
          project_id: s.forms[0]?.project_id ?? "",
          url: s.webhook_url ?? "",
        })));
      }
      setLive(true);
    } catch (e) {
      console.error("Failed to fetch sources, using demo data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return "Yesterday";
  }

  async function setMapping(formId: string, projectId: string) {
    // Optimistic update
    const projectName = projects.find((p) => p.id === projectId)?.name ?? "";
    setForms((fs) => fs.map((f) => (f.id === formId ? { ...f, project: projectName, project_id: projectId } : f)));

    if (isDemo || !live) return;

    // Find which source owns this form
    const source = metaSources.find((s) => s.forms.some((f) => f.id === formId));
    if (!source) return;

    try {
      await apiFetch(`/sources/${source.id}/mapping`, {
        method: "PATCH",
        body: JSON.stringify({ form_id: formId, project_id: projectId || null }),
      });
    } catch (e) {
      console.error("Failed to update mapping", e);
    }
  }

  async function handleAddGoogleForm() {
    if (!newFormName.trim()) return;
    setAddingForm(true);
    try {
      if (!isDemo && live) {
        const res = await apiFetch("/sources", {
          method: "POST",
          body: JSON.stringify({ provider: "google", label: newFormName, project_id: newFormProject || null }),
        });
        if (!res.ok) { console.error("Failed to add source"); setAddingForm(false); return; }
        await fetchSources();
      } else {
        // Demo mode: add locally
        const newId = `g${Date.now()}`;
        const url = `https://api.realtyai.app/webhooks/google?src=${newId.slice(0, 4)}...`;
        setGoogleDisplay((prev) => [...prev, {
          id: newId, name: newFormName, status: "Waiting for test data",
          leads: 0, project: projects.find(p => p.id === newFormProject)?.name ?? "", project_id: newFormProject, url,
        }]);
      }
      setNewFormName("");
      setNewFormProject("");
      setShowAddForm(false);
    } catch (e) {
      console.error("Failed to add Google form", e);
    } finally {
      setAddingForm(false);
    }
  }

  async function handleCopy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  }

  async function handleGoogleProjectChange(sourceId: string, projectId: string) {
    const projectName = projects.find((p) => p.id === projectId)?.name ?? "";
    setGoogleDisplay((prev) => prev.map(g => g.id === sourceId ? { ...g, project: projectName, project_id: projectId } : g));

    if (isDemo || !live) return;

    try {
      await apiFetch(`/sources/${sourceId}/mapping`, {
        method: "PATCH",
        body: JSON.stringify({ project_id: projectId || null }),
      });
    } catch (e) {
      console.error("Failed to update Google source mapping", e);
    }
  }

  const unmappedNow = forms.filter((f) => !f.project).length;

  return (
    <>
      <h1 className="page-title">Sources</h1>
      <p className="page-sub">Connected ad accounts, and which project each form&apos;s leads belong to.</p>

      {unmappedNow > 0 && (
        <div style={{ background: "var(--warm-wash, #f7f1e2)", border: "1px solid #b8912f", borderRadius: 8, padding: "12px 18px", marginBottom: 16, color: "#854f0b", fontWeight: 600, fontSize: 14 }}>
          {unmapped24h} leads arrived from an unmapped form in the last 24 hours — they received generic responses. Map the form below.
        </div>
      )}

      <div className="card">
        <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <b style={{ fontSize: 16 }}>Meta Lead Ads</b>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{seed.meta.label}</div>
          </div>
          <span className="chip chip-ai">Connected</span>
        </div>
        <table>
          <thead><tr><th>Form</th><th>Leads · 30d</th><th>Last lead</th><th>Project</th></tr></thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id}>
                <td><b>{f.name}</b><div style={{ color: "var(--muted)", fontSize: 12.5 }}>{f.id}</div></td>
                <td>{f.leads}</td>
                <td style={{ color: "var(--muted)" }}>{f.last}</td>
                <td>
                  {!f.project && <span className="chip chip-hot" style={{ marginRight: 8 }}>Unmapped</span>}
                  <select
                    value={f.project_id}
                    onChange={(e) => setMapping(f.id, e.target.value)}
                    style={!f.project ? { borderColor: "#b8912f", borderWidth: 2 } : undefined}>
                    <option value="">Choose project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 22px 16px" }}>
          Forms are discovered automatically from the connected page. New forms appear here unmapped.
        </p>
      </div>

      <div className="card">
        <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <b style={{ fontSize: 16 }}>Google Ads lead forms</b>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Each form posts to its own webhook URL — paste it into the form&apos;s webhook field.</div>
          </div>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => setShowAddForm(true)}>Add form</button>
        </div>
        {showAddForm && (
          <div className="card-pad" style={{ paddingTop: 0, paddingBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Form name, e.g. Brand Search"
              value={newFormName}
              onChange={(e) => setNewFormName(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <select value={newFormProject} onChange={(e) => setNewFormProject(e.target.value)}>
              <option value="">Project (optional)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={handleAddGoogleForm} disabled={addingForm}>
              {addingForm ? "Adding…" : "Create"}
            </button>
            <button className="btn" style={{ fontSize: 13 }} onClick={() => { setShowAddForm(false); setNewFormName(""); setNewFormProject(""); }}>Cancel</button>
          </div>
        )}
        <div className="card-pad" style={{ paddingTop: 0 }}>
          {googleDisplay.map((g) => (
            <div key={g.id} style={{ borderTop: "1px solid var(--line)", padding: "14px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span>
                  <b>{g.name}</b>
                  <div style={{ fontSize: 12.5, color: g.status.startsWith("Verified") ? "var(--accent-deep)" : "#b8912f" }}>{g.status}</div>
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{g.leads} leads · 30d</span>
                  <select value={g.project_id} onChange={(e) => handleGoogleProjectChange(g.id, e.target.value)}>
                    <option value="">Choose project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <code style={{ flex: 1, fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.url}</code>
                <button className="btn" style={{ fontSize: 13 }} onClick={() => handleCopy(g.url, g.id)}>
                  {copied === g.id ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
