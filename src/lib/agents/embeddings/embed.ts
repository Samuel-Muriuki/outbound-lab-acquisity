import "server-only";
import { embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini text embedding model. 768-dim output — matches the
 * `vector(768)` column on `research_embeddings` from the initial
 * migration. Free tier on Google's Generative Language API.
 *
 * Model name is intentionally pinned to `text-embedding-004`. The newer
 * `gemini-embedding-001` defaults to 3072 dims and would require a
 * column-type migration.
 */
const EMBEDDING_MODEL = "text-embedding-004";

/**
 * Compose a semantically-rich string from a recon brief for embedding.
 *
 * What the model "sees" is what we'll cluster on at retrieval time:
 * the company name + one-liner + product + ICP captures the *kind* of
 * company without being polluted by the run-specific people/email
 * fields (which would make two runs of the same company look
 * different).
 */
export function composeEmbeddingInput(input: {
  companyName: string;
  oneLiner: string;
  whatTheySell: string;
  targetMarket: string;
}): string {
  return [
    input.companyName,
    input.oneLiner,
    `Sells: ${input.whatTheySell}`,
    `ICP: ${input.targetMarket}`,
  ].join("\n");
}

/**
 * Embed a string into a 768-dim vector via Gemini text-embedding-004.
 *
 * Returns `null` (not throw) when GEMINI_API_KEY is missing or the
 * embed call fails — embeddings are a non-critical sidecar to the
 * research run, so a Gemini blip should never fail the whole run.
 * Callers must treat the result as optional.
 */
export async function embedText(value: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[embedText] GEMINI_API_KEY missing — skipping embedding write."
    );
    return null;
  }

  try {
    const provider = createGoogleGenerativeAI({ apiKey });
    const result = await embed({
      model: provider.embedding(EMBEDDING_MODEL),
      value,
    });
    return result.embedding;
  } catch (err) {
    console.warn(
      "[embedText] embed call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
