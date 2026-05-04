import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../llm/types";
import { isPrivateHostname } from "@/lib/validation/research-input";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_CHARS = 4_000;
const USER_AGENT = "OutboundLab/1.0 (research bot; +https://outbound-lab.vercel.app)";

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
    return stripToText(raw).slice(0, MAX_OUTPUT_CHARS);
  },
};

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
