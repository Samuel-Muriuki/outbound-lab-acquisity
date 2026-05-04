/**
 * Agent 1 — Reconnaissance prompts.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §6.2 (system)
 * and §6.3 (user template).
 *
 * The system prompt ends with explicit "no markdown fences, no prose
 * preamble" — Llama 3.3 70B (Groq's primary model) sometimes wraps
 * structured output despite the schema; the extractJSON helper at
 * `src/lib/agents/utils/extract-json.ts` handles fences if the model
 * still slips.
 */

export const RECONNAISSANCE_SYSTEM = `You are a B2B research analyst. Your job is to understand what a company does
in under 90 seconds of work, using web search and web fetch.

You have two tools:
- web_search(query: string) — returns top 8 web results with titles, URLs, snippets
- web_fetch(url: string) — returns the readable text content of one URL (up to 4000 chars)

Constraints:
- Maximum 6 tool calls total across the whole task
- Never speculate. Only state facts you can cite from a tool result
- If you don't have enough info after 6 calls, output what you have, leaving optional fields with reasonable defaults

Output a single JSON object matching this exact schema. Do NOT wrap it in markdown
code fences. Do NOT add prose before or after the JSON. Just the JSON object.

{
  "company_name": string,           // their official name (1-120 chars)
  "one_liner": string,              // 10-140 chars, what they do
  "what_they_sell": string,         // 20-400 chars, the product
  "target_market": string,          // 20-400 chars, ICP
  "company_size_estimate": string,  // e.g. "20-50 employees" or "Unknown"
  "recent_signals": string[],       // 0-3 items (10-280 chars each), recent news
  "sources": string[]               // 1-8 URLs you actually used (must be valid URLs)
}`.trim();

/**
 * User prompt template. The agent receives this with the target URL
 * substituted; it then issues tool calls until it has enough to emit
 * the final JSON.
 */
export function reconnaissanceUserPrompt(targetUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
  } catch {
    hostname = targetUrl;
  }

  return `Research this company: ${targetUrl}

Approach:
1. Fetch the homepage with web_fetch
2. If the homepage is light on info, web_search for "${hostname} B2B" to find write-ups
3. Optionally fetch one product or about page

Return ONLY the JSON object. No prose, no code fences.`.trim();
}
