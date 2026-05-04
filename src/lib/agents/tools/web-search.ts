import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../llm/types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 10_000;
const MAX_SNIPPET_CHARS = 280;
const DEFAULT_MAX_RESULTS = 8;

const TavilyResult = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().optional().default(""),
});

const TavilyResponse = z.object({
  results: z.array(TavilyResult),
});

const WebSearchInput = z.object({
  query: z
    .string()
    .min(2, "Query must be at least 2 characters.")
    .max(300, "Query must be at most 300 characters.")
    .describe("A short, focused search query (3-10 words)."),
});

/**
 * Tool definition for the LLM. Agent 1 (Reconnaissance) and Agent 2
 * (People & ICP) both register this tool with the chat() layer; the
 * model decides when to call it.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §6.4.
 */
export const webSearchTool: ToolDefinition<typeof WebSearchInput> = {
  name: "web_search",
  description:
    "Search the web for up to 8 results. Returns title, URL, and snippet for each. Use focused queries (3-10 words) — not full sentences.",
  parameters: WebSearchInput,
  async execute({ query }) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing TAVILY_API_KEY. Set it in .env.local before running agents."
      );
    }

    let response: Response;
    try {
      response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: DEFAULT_MAX_RESULTS,
          search_depth: "basic",
          include_answer: false,
        }),
        signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Tavily search timed out after ${TAVILY_TIMEOUT_MS}ms.`);
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(
        `Tavily search failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as unknown;
    const parsed = TavilyResponse.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Tavily returned an unexpected response shape: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }

    const results = parsed.data.results;
    if (results.length === 0) {
      return `No results for "${query}".`;
    }

    return results
      .map((r, i) => {
        const snippet = r.content.slice(0, MAX_SNIPPET_CHARS).trim();
        return `${i + 1}. ${r.title}\n   ${r.url}\n   ${snippet}`;
      })
      .join("\n\n");
  },
};
