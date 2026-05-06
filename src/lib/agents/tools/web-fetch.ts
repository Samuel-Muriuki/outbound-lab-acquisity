import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../llm/types";
import { isPrivateHostname } from "@/lib/validation/research-input";

/**
 * Fetch timeout — applies to both the model's web_fetch tool calls
 * AND the post-validation gates in Agent 1 (source-grounding) and
 * Agent 2 (cross-domain DM verification). 8s was too aggressive: many
 * legitimate sources (Wikipedia mirrors, blog hosts, /story pages
 * behind a CDN) complete in 9-12s, and dropping a real source for
 * being a second slow caused valid decision makers to be rejected.
 * 15s leaves enough headroom for the slowest viable corroboration
 * sources without dragging the worst-case run time into the orchestrator's
 * 90s ceiling.
 */
const FETCH_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 4_000;
const USER_AGENT = "OutboundLab/1.0 (research bot; +https://outbound-lab-acquisity.vercel.app)";

/**
 * SPA detection thresholds. When a fetch returns substantial HTML
 * (>= 2KB raw) but the strip-to-text output is tiny (< 300 chars),
 * the page is almost certainly a JS-rendered SPA — `<div id="root">`
 * skeleton plus script tags, no rendered content. Fall back to a
 * Tavily search of the same URL: Tavily crawls with a real browser
 * and returns rendered text.
 *
 * Why the dual threshold: avoids false-positives on legitimate
 * sparse pages (404s, "coming soon" landings) which produce both
 * thin HTML and thin text. Only triggers when there's *enough* HTML
 * to suggest a real page that just hasn't rendered for our fetch.
 */
const SPA_MIN_USEFUL_CHARS = 300;
const SPA_MIN_HTML_BYTES = 2_048;
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const WebFetchInput = z.object({
  url: z
    .string()
    .url()
    .max(500)
    .describe("A full URL with https:// or http:// scheme."),
});

/**
 * Tool definition for the LLM. Agent 1 (Reconnaissance) registers this
 * to fetch the readable text of pages it discovers via web_search.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §6.4.
 *
 * Hardening over the doc's reference code:
 *  - Scheme allowlist (http/https only — rejects file:// / javascript: / data:)
 *  - SSRF guard reuses isPrivateHostname() from the input-validation
 *    module so the public URL gate and the agent's tool path share the
 *    same blocklist (RFC 1918 + IPv6 ::1 + 169.254 link-local + 172.16/12)
 *  - HTTP errors return a string the model can reason about (rather than
 *    throwing), per the doc; network errors throw
 *  - HTML stripping handles <script>, <style>, comments, and entity
 *    decoding for the most common entities
 *  - Hard cap at 4,000 chars on the returned text to keep agent context
 *    tight
 */
export const webFetchTool: ToolDefinition<typeof WebFetchInput> = {
  name: "web_fetch",
  description:
    "Fetch the readable content of a single URL. Returns up to 4,000 chars of cleaned text (HTML tags stripped, scripts/styles removed, whitespace collapsed).",
  parameters: WebFetchInput,
  async execute({ url }) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `Fetch failed: invalid URL "${url}".`;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return `Fetch failed: only http:// and https:// are supported (got ${parsed.protocol}).`;
    }

    if (isPrivateHostname(parsed.hostname)) {
      throw new Error(
        `Cannot fetch private or local addresses (${parsed.hostname}).`
      );
    }

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${parsed.hostname}`
        );
      }
      throw err;
    }

    if (!response.ok) {
      return `Fetch failed: HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!isTextContentType(contentType)) {
      return `Fetch failed: content-type "${contentType}" is not readable text.`;
    }

    const raw = await response.text();
    const stripped = stripToText(raw);

    // SPA detection — substantial HTML payload but the strip-to-text
    // output is thin. Modern B2B targets a recruiter might paste
    // (Linear, Vercel, Supabase, Acquisity itself) ship as SPAs whose
    // SSR-less HTML is just `<div id="root"></div>` plus script tags.
    // Fall back to Tavily's rendered crawl for the same URL.
    if (
      stripped.length < SPA_MIN_USEFUL_CHARS &&
      raw.length >= SPA_MIN_HTML_BYTES
    ) {
      const tavilyContent = await fetchViaTavily(parsed);
      if (tavilyContent) return tavilyContent.slice(0, MAX_OUTPUT_CHARS);
      // Tavily fallback failed (no key, no matching results, fetch
      // error) — fall through and return the thin original; better
      // than throwing. Agent will see how little it got and reason
      // about whether to search more.
    }

    return stripped.slice(0, MAX_OUTPUT_CHARS);
  },
};

interface TavilyRawResult {
  url?: string;
  raw_content?: string;
  content?: string;
}

interface TavilyRawResponse {
  results?: TavilyRawResult[];
}

/**
 * SPA fallback — fetch rendered text via Tavily. Tavily crawls with
 * a real browser, so its `raw_content` field contains the rendered
 * page text even when our direct GET only sees the SSR shell.
 *
 * Filters Tavily's results to those matching the target's hostname
 * (or subdomain) — concatenates their rendered bodies. Returns null
 * on any failure (missing key, network error, no matching results)
 * so callers can gracefully fall through to the thin original.
 */
async function fetchViaTavily(target: URL): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: target.toString(),
        include_raw_content: true,
        max_results: 3,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let body: TavilyRawResponse;
  try {
    body = (await response.json()) as TavilyRawResponse;
  } catch {
    return null;
  }
  if (!body.results || body.results.length === 0) return null;

  const targetHost = target.hostname.replace(/^www\./, "").toLowerCase();
  const bodies: string[] = [];
  for (const r of body.results) {
    if (!r.url) continue;
    let resultHost: string;
    try {
      resultHost = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (
      resultHost !== targetHost &&
      !resultHost.endsWith(`.${targetHost}`)
    ) {
      continue;
    }
    const text = (r.raw_content || r.content || "").trim();
    if (text) bodies.push(text);
  }

  if (bodies.length === 0) return null;
  // Collapse whitespace for parity with the direct-fetch path's
  // strip output — agents shouldn't see formatting differences
  // between fast-path and fallback.
  return bodies.join("\n\n").replace(/\s+/g, " ").trim();
}

function isTextContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith("text/") ||
    lower.includes("application/xhtml") ||
    lower.includes("application/xml") ||
    lower.includes("application/json")
  );
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
};

/**
 * Strip HTML to readable text. Removes scripts, styles, comments, then
 * tags, then collapses whitespace and decodes the most common entities.
 *
 * Not a full HTML parser — DOMs in the wild are wild — but produces
 * model-friendly text from typical marketing / about / blog pages,
 * which is what the agent fetches.
 */
function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (match) => HTML_ENTITIES[match] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}
