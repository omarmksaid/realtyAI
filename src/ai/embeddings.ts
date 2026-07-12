import { env } from "../lib/env";

/**
 * Embeddings via Voyage AI (Anthropic's recommended embedding partner).
 * voyage-4 defaults to 1024-dim vectors — the same width migration 0004 sized doc_chunks
 * to, so this is a drop-in for the older voyage-3.5. Same price ($0.06/1M), but series-3
 * no longer gets free tokens while voyage-4 includes 200M. Swappable: anything returning
 * number[][] works; keep dims in sync with the schema.
 */
const MODEL = "voyage-4";

/** Retries on 429/5xx with backoff. Voyage rate-limits by tokens-per-minute, so a large
 *  document can trip the limit even on a paid account — a transient 429 shouldn't be
 *  allowed to kill an ingest that would succeed a second later. */
export async function embed(
  texts: string[],
  inputType: "document" | "query",
  attempt = 0
): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts, input_type: inputType }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 4) {
      const waitMs = 2 ** attempt * 1500; // 1.5s, 3s, 6s, 12s
      await new Promise((r) => setTimeout(r, waitMs));
      return embed(texts, inputType, attempt + 1);
    }
  }
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}
