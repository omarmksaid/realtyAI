import { env } from "../lib/env";

/**
 * Embeddings via Voyage AI (Anthropic's recommended embedding partner).
 * voyage-3.5 returns 1024-dim vectors — migration 0004 sizes doc_chunks to match.
 * Swappable: anything that returns number[][] works; keep dims in sync with the schema.
 */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5", input: texts, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}
