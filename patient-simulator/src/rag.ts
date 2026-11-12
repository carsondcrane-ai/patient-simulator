// ── Vectorize RAG (optional) ────────────────────────────
// If the VECTORIZE binding is present, this module queries the
// indexed material for context relevant to the student's message.
// If the binding is absent, RAG is skipped gracefully.

import type { Env } from "./index";

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

/**
 * Generate an embedding for a text query using Workers AI.
 */
async function embed(env: Env, text: string): Promise<number[]> {
  const resp = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  })) as EmbeddingResponse;
  return resp.data[0];
}

/**
 * Query Vectorize for context relevant to the student's message.
 * Returns a formatted string of top matches, or null if Vectorize
 * is not configured or returns no results.
 */
export async function getRagContext(
  env: Env,
  query: string,
  topK = 3,
): Promise<string | null> {
  if (!env.VECTORIZE) return null;

  try {
    const embedding = await embed(env, query);
    const results = await env.VECTORIZE.query(embedding, { topK });

    if (!results.matches || results.matches.length === 0) return null;

    const chunks = results.matches
      .filter((m) => m.metadata?.text)
      .map((m, i) => `[${i + 1}] ${m.metadata!.text}`)
      .join("\n\n");

    return chunks || null;
  } catch (err) {
    console.error("RAG query failed:", err);
    return null;
  }
}

/**
 * Index a piece of material into Vectorize.
 * Called from the POST /api/index endpoint (instructor only).
 */
export async function indexMaterial(
  env: Env,
  text: string,
  metadata?: Record<string, string>,
): Promise<void> {
  if (!env.VECTORIZE) {
    throw new Error("Vectorize binding is not configured");
  }

  const embedding = await embed(env, text);
  const id = crypto.randomUUID();

  await env.VECTORIZE.upsert([
    {
      id,
      values: embedding,
      metadata: { text, ...metadata },
    },
  ]);
}
