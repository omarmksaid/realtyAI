import Anthropic from "@anthropic-ai/sdk";
import PgBoss from "pg-boss";
import { supabaseAdmin } from "../lib/supabase";
import { embed } from "../ai/embeddings";
import { env } from "../lib/env";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/** Paragraph-aware chunking: ~3200 chars (~800 tokens) with 300-char overlap. */
export function chunkText(text: string, size = 3200, overlap = 300): string[] {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length + 2 > size && cur) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + "\n\n" + p; // carry tail for continuity
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

async function downloadUpload(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from("knowledge").download(storagePath);
  if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Extract text from a document based on its type. */
async function extractText(doc: any, rawText?: string): Promise<string> {
  if (doc.source === "text") return rawText ?? "";

  const buf = await downloadUpload(doc.storage_path);
  const name: string = doc.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdf = (await import("pdf-parse")).default;
    const parsed = await pdf(buf);
    if (parsed.text.trim().length > 50) return parsed.text;
    // Scanned / image-only PDF: fall through to vision below
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (/\.(png|jpe?g|webp|pdf)$/.test(name)) {
    // Floor plans, renderings, price-sheet photos: Claude reads the image and
    // writes a factual description the RAG layer can retrieve. This is what makes
    // "upload the floor plan" actually answer "does Tower A have a 2-bed under 700sqft".
    const mediaType = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    if (name.endsWith(".pdf")) throw new Error("scanned PDF OCR: convert pages to images first (add pdftoppm step)");
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
          { type: "text", text: "This is a real-estate project document (floor plan, price list, rendering, or brochure page). Extract every fact into plain text: unit types, square footages, room dimensions, prices, dates, amenities, orientations. Be exhaustive and literal; do not editorialize. If it's a rendering with no data, describe what it depicts in 2-3 sentences." },
        ],
      }],
    });
    return resp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
  }
  // Fallback: treat as UTF-8 text (md, txt, csv)
  return buf.toString("utf-8");
}

export function registerIngest(boss: PgBoss) {
  return boss.work("ingest", { batchSize: 1 }, async ([job]) => {
    const { documentId, rawText } = job.data as { documentId: string; rawText?: string };

    const { data: doc } = await supabaseAdmin.from("documents").select("*").eq("id", documentId).single();
    if (!doc) return;

    try {
      const text = await extractText(doc, rawText);
      if (!text.trim()) throw new Error("no extractable text");

      const chunks = chunkText(text);
      // Voyage batch limit is generous; embed in slices of 64 to stay safe
      const rows: any[] = [];
      for (let i = 0; i < chunks.length; i += 64) {
        const slice = chunks.slice(i, i + 64);
        const vectors = await embed(slice, "document");
        slice.forEach((content, j) => rows.push({
          company_id: doc.company_id, document_id: doc.id, project_id: doc.project_id,
          content, embedding: vectors[j],
        }));
      }
      // Re-ingest = replace: drop old chunks for this document first
      await supabaseAdmin.from("doc_chunks").delete().eq("document_id", doc.id);
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabaseAdmin.from("doc_chunks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }
      await supabaseAdmin.from("documents").update({ status: "ready" }).eq("id", doc.id);
    } catch (e: any) {
      await supabaseAdmin.from("documents").update({ status: "failed" }).eq("id", doc.id);
      throw e; // pg-boss retries with backoff; stays 'failed' if retries exhaust
    }
  });
}
