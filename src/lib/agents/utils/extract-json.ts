/**
 * Llama-tolerant JSON extraction.
 *
 * Llama 3.3 70B (Groq's primary model) sometimes wraps JSON output in
 * markdown code fences or prepends a sentence of preamble despite the
 * system prompt forbidding it. This helper finds the first balanced
 * `{...}` object in the text and parses it.
 *
 * Returns the parsed `unknown` — the caller is expected to run it
 * through a Zod schema for type-safety.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §6.6.
 */
export function extractJSON(text: string): unknown {
  if (!text || typeof text !== "string") {
    throw new Error("Empty model response — no text to parse.");
  }

  let cleaned = text.trim();

  // Strip leading/trailing markdown fences (```json ... ```)
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```\s*$/i, "");

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `No JSON object found in model output: ${truncate(text, 200)}`
    );
  }

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse JSON from model output (${message}): ${truncate(candidate, 200)}`
    );
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
