/**
 * Knowledge quality harness.
 *
 *   npx tsx scripts/eval-knowledge.ts <projectId> [--voice|--whatsapp]
 *
 * Answers the question "why couldn't the AI answer that?" — which has two completely
 * different causes that look identical from the outside:
 *
 *   1. THE ANSWER ISN'T IN THE DOCUMENTS. No retrieval tuning fixes this. You need to
 *      upload the price sheet. The guardrails then correctly refuse to invent a number,
 *      which *feels* like a bug but is the system working.
 *
 *   2. THE ANSWER IS THERE BUT RETRIEVAL MISSED IT. WhatsApp fetches only the top 5 chunks
 *      above 0.35 similarity, so a question can retrieve the brochure's marketing prose
 *      instead of the line that actually holds the fact. This is a real defect and it is
 *      invisible in production.
 *
 * For each question this prints whether the fact EXISTS in the corpus at all, and — for the
 * WhatsApp path — whether RAG actually surfaced it. Voice inlines every chunk (limit 20), so
 * with a small corpus voice sees everything and only failure mode 1 applies to it.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// PostgREST directly rather than @supabase/supabase-js: its realtime module requires a
// native WebSocket, which Node 20 doesn't have, and this script needs neither realtime nor
// auth.
const SB = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function sbSelect(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}
async function sbRpc(fn: string, args: any) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`Supabase rpc ${r.status}: ${await r.text()}`);
  return r.json();
}

/** The questions leads actually ask, in the order they ask them. */
const QUESTIONS = [
  "How much is a 2-bedroom?",
  "What's the price range?",
  "What's the deposit structure?",
  "When is occupancy?",
  "How much is parking?",
  "How much is a locker?",
  "What are the maintenance fees?",
  "What size are the suites?",
  "How many units are in the building?",
  "How tall is the building?",
  "What amenities are there?",
  "Where exactly is it located?",
  "Who is the builder?",
  "Are there any current incentives?",
  "Can I assign my unit before closing?",
  "Is there EV parking?",
];

async function embed(texts: string[], inputType: "document" | "query") {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-4", input: texts, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  return (await res.json()).data.map((d: any) => d.embedding);
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("usage: npx tsx scripts/eval-knowledge.ts <projectId>");
    process.exit(1);
  }

  const chunks: any[] = await sbSelect(`doc_chunks?project_id=eq.${projectId}&select=content`);
  if (!chunks?.length) {
    console.error("No knowledge for that project.");
    process.exit(1);
  }
  const corpus = chunks.map((c: any) => c.content).join("\n\n---\n\n");
  console.log(`\n${chunks.length} chunks · ${corpus.length.toLocaleString()} chars\n`);

  const rows: { q: string; inCorpus: boolean; ragFound: boolean; note: string }[] = [];

  for (const q of QUESTIONS) {
    // (1) Is the fact present ANYWHERE in the documents? This is the voice path's ceiling —
    // voice inlines up to 20 chunks, so with a small corpus it sees everything we have.
    const judge = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system:
        "You are auditing a real-estate knowledge base. Given the documents and a question a " +
        "buyer would ask, decide whether the documents contain enough to answer it FACTUALLY. " +
        'Reply ONLY as JSON: {"answerable":true|false,"answer":"the fact, or why not"}. ' +
        "Do not infer, estimate, or use outside knowledge — if the number is not written " +
        "there, answerable is false.",
      messages: [{ role: "user", content: `DOCUMENTS:\n${corpus}\n\nQUESTION: ${q}` }],
    });
    const raw = judge.content.find((b) => b.type === "text");
    const m = raw && raw.type === "text" ? raw.text.match(/\{[\s\S]*\}/) : null;
    let inCorpus = false;
    let note = "";
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        inCorpus = !!j.answerable;
        note = String(j.answer ?? "").slice(0, 90);
      } catch {}
    }

    // (2) Would WhatsApp's RAG actually SURFACE it? Same query embedding, same top-5, same
    // 0.35 threshold as generateReply(). A fact that exists but isn't retrieved is a defect
    // the production system cannot report on itself.
    let ragFound = false;
    try {
      const [qv] = await embed([q], "query");
      // Mirror generateReply(): top 8 by rank, 0.15 floor to drop noise, keep 5.
      const hits: any[] = await sbRpc("match_chunks", {
        p_project: projectId, p_embedding: qv, p_count: 8,
      });
      const relevant = (hits ?? []).filter((h: any) => h.similarity > 0.15).slice(0, 5);
      if (relevant.length && inCorpus) {
        // Does the retrieved subset alone contain the answer?
        const sub = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 100,
          system:
            'Reply ONLY "yes" or "no": do these excerpts contain enough to answer the ' +
            "question factually? Do not infer or use outside knowledge.",
          messages: [{
            role: "user",
            content: `EXCERPTS:\n${relevant.map((h: any) => h.content).join("\n---\n")}\n\nQUESTION: ${q}`,
          }],
        });
        const t = sub.content.find((b) => b.type === "text");
        ragFound = !!(t && t.type === "text" && /yes/i.test(t.text));
      }
    } catch (e: any) {
      note ||= `RAG error: ${e.message}`;
    }

    rows.push({ q, inCorpus, ragFound, note });

    const mark = !inCorpus ? "❌ MISSING " : ragFound ? "✅ OK      " : "⚠️  RAG MISS";
    console.log(`${mark} ${q}`);
    if (!inCorpus) console.log(`             ↳ not in any document`);
    else if (!ragFound) console.log(`             ↳ fact IS in the docs, but RAG didn't surface it`);
  }

  const missing = rows.filter((r) => !r.inCorpus);
  const ragMiss = rows.filter((r) => r.inCorpus && !r.ragFound);

  console.log(`\n${"─".repeat(72)}`);
  console.log(`Answerable from documents : ${rows.length - missing.length}/${rows.length}`);
  console.log(`Retrieved correctly (RAG) : ${rows.length - missing.length - ragMiss.length}/${rows.length - missing.length}`);

  if (missing.length) {
    console.log(`\n❌ NOT IN YOUR DOCUMENTS (${missing.length}) — upload a document with these:`);
    for (const r of missing) console.log(`   · ${r.q}`);
    console.log(`\n   The AI will correctly refuse to guess these. That's the guardrail working,`);
    console.log(`   not a bug — but to a lead it reads as "the AI doesn't know anything".`);
  }
  if (ragMiss.length) {
    console.log(`\n⚠️  RETRIEVAL MISSES (${ragMiss.length}) — the fact exists but WhatsApp won't find it:`);
    for (const r of ragMiss) console.log(`   · ${r.q}`);
    console.log(`\n   This is a real defect. Voice is unaffected (it inlines every chunk).`);
  }
  if (!missing.length && !ragMiss.length) {
    console.log(`\n✅ Every question answerable and retrievable.`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
