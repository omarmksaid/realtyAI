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

/** What Claude is told to pull out of a project document, whatever its format. */
const EXTRACTION_PROMPT =
  "This is a real-estate project document (floor plan, price list, rendering, or brochure page). " +
  "Extract every fact into plain text: unit types, square footages, room dimensions, prices, deposit " +
  "structures, occupancy dates, amenities, orientations. Preserve tables as readable rows — a price " +
  "sheet must keep each unit tied to its own price and size. Be exhaustive and literal; do not " +
  "editorialize. If it's a rendering with no data, describe what it depicts in 2-3 sentences.";

const textFrom = (resp: any) =>
  resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");

/** Claude reads the PDF directly — text layer and visual layout both. This is what makes a
 *  scanned brochure work: there's no text to parse, so pdf-parse returns nothing and only a
 *  model that can see the page can read it. Limits: 32MB request, 600 pages. */
async function readPdfWithClaude(buf: Buffer): Promise<string> {
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: EXTRACTION_PROMPT },
      ],
    }] as any,
  });
  return textFrom(resp);
}

/** Extract text from a document based on its type. */
async function extractText(doc: any, rawText?: string): Promise<string> {
  if (doc.source === "text") return rawText ?? "";

  const buf = await downloadUpload(doc.storage_path);
  const name: string = doc.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    // Try the embedded text layer first — free and instant when the PDF has one.
    // A scanned page has no text layer, so this comes back empty and we hand the
    // whole PDF to Claude, which reads it visually. Price sheets go to Claude either
    // way: pdf-parse flattens a table into orphaned numbers with no rows.
    try {
      const pdf = (await import("pdf-parse")).default;
      const parsed = await pdf(buf);
      if (parsed.text.trim().length > 200) return parsed.text;
    } catch {
      // Malformed or encrypted text layer — Claude gets a shot at it anyway.
    }
    return readPdfWithClaude(buf);
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (/\.(png|jpe?g|webp)$/.test(name)) {
    // Floor plans, renderings, price-sheet photos: Claude reads the image and
    // writes a factual description the RAG layer can retrieve. This is what makes
    // "upload the floor plan" actually answer "does Tower A have a 2-bed under 700sqft".
    const mediaType = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }],
    });
    return textFrom(resp);
  }
  // Fallback: treat as UTF-8 text (md, txt, csv)
  return buf.toString("utf-8");
}

export async function registerIngest(boss: PgBoss) {
  await boss.createQueue("ingest");
  return boss.work("ingest", { batchSize: 1 }, async ([job]) => {
    const { documentId, rawText } = job.data as { documentId: string; rawText?: string };

    const { data: doc } = await supabaseAdmin.from("documents").select("*").eq("id", documentId).single();
    if (!doc) return;

    try {
      const text = await extractText(doc, rawText);
      if (!text.trim()) throw new Error("no extractable text");

      const chunks = chunkText(text);

      // Write the text FIRST, embed after. Embedding used to come first, so a Voyage rate
      // limit threw away a document whose text had extracted perfectly — and voice reads
      // doc_chunks.content directly, never the vector, so it lost knowledge over an API it
      // doesn't even use. Text is the thing we can't recreate; a vector we can backfill.
      await supabaseAdmin.from("doc_chunks").delete().eq("document_id", doc.id);
      const rows = chunks.map((content) => ({
        company_id: doc.company_id, document_id: doc.id, project_id: doc.project_id,
        content, embedding: null as number[] | null,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabaseAdmin.from("doc_chunks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }

      // Now embed. A failure here degrades WhatsApp from semantic retrieval to none — it
      // does not cost us the document. Mark it so a backfill can find it later.
      let embedded = true;
      try {
        const { data: stored } = await supabaseAdmin
          .from("doc_chunks").select("id, content").eq("document_id", doc.id).order("id");
        for (let i = 0; i < (stored?.length ?? 0); i += 32) {
          const slice = (stored ?? []).slice(i, i + 32);
          const vectors = await embed(slice.map((s: any) => s.content), "document");
          await Promise.all(
            slice.map((s: any, j: number) =>
              supabaseAdmin.from("doc_chunks").update({ embedding: vectors[j] }).eq("id", s.id)
            )
          );
        }
      } catch (e) {
        embedded = false;
        console.error(`Embedding failed for document ${doc.id} — text is stored and usable on ` +
          `calls; WhatsApp retrieval will be degraded until re-embedded.`, e);
      }

      // 'ready' either way: the document IS usable — voice reads doc_chunks.content and
      // never touches the vector. (status is CHECK-constrained to processing|ready|failed,
      // so there's no 'partial' to use without a migration.) The unembedded chunks are
      // findable with `embedding is null`, which is what a backfill keys off.
      await supabaseAdmin.from("documents").update({ status: "ready" }).eq("id", doc.id);
      if (!embedded) {
        await boss.send("embed-backfill", { documentId: doc.id }, { startAfter: 120 });
      }
    } catch (e: any) {
      await supabaseAdmin.from("documents").update({ status: "failed" }).eq("id", doc.id);
      throw e; // pg-boss retries with backoff; stays 'failed' if retries exhaust
    }
  });

  /* Re-embed chunks that were stored with text but no vector (a Voyage outage or rate
     limit during ingest). Until this runs, the document works on calls but is invisible to
     WhatsApp's semantic retrieval. Idempotent: it only ever touches `embedding is null`. */
  await boss.createQueue("embed-backfill");
  await boss.work("embed-backfill", { batchSize: 1 }, async ([job]) => {
    const { documentId } = job.data as { documentId?: string };

    let q = supabaseAdmin.from("doc_chunks").select("id, content").is("embedding", null).limit(200);
    if (documentId) q = q.eq("document_id", documentId);
    const { data: pending } = await q;
    if (!pending?.length) return;

    for (let i = 0; i < pending.length; i += 32) {
      const slice = pending.slice(i, i + 32);
      const vectors = await embed(slice.map((s: any) => s.content), "document");
      await Promise.all(
        slice.map((s: any, j: number) =>
          supabaseAdmin.from("doc_chunks").update({ embedding: vectors[j] }).eq("id", s.id)
        )
      );
    }
    console.log(`Backfilled embeddings for ${pending.length} chunk(s)`);
  });
}
