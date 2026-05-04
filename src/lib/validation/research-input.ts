/**
 * Research-input validation schema.
 *
 * Imported by both the client (HeroInput form) and the server
 * (`/api/research` route handler) so the contract is single-sourced —
 * eliminates the form-shape ↔ handler-shape contract drift bug class.
 *
 * Mirrors the schema in `.ai/docs/06-agent-system-design.md` §9.1.
 */
import { z } from "zod";

/** Hostnames the agent must never fetch from (SSRF + abuse guard). */
const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

const PRIVATE_IPV4_PREFIXES = ["10.", "192.168.", "169.254."];

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(h)) return true;
  if (PRIVATE_IPV4_PREFIXES.some((p) => h.startsWith(p))) return true;
  // 172.16.0.0 – 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * Normalised, validated research input.
 *
 * Exported transformations:
 *  - Trims input
 *  - Forces protocol to https:// when omitted (e.g. "acquisity.com" → "https://acquisity.com")
 *  - Lowercases hostname (normaliseDomain takes care of www/trailing-slash later)
 *  - Caps total length at 500 characters
 *  - Rejects private addresses to block SSRF / abuse
 *  - Rejects non-http(s) schemes (file://, javascript:, data:, etc.)
 */
export const ResearchInput = z.object({
  url: z
    .string()
    .trim()
    .min(1, { message: "Enter a company URL." })
    .max(500, { message: "URL is too long." })
    .transform((value) => {
      const withScheme = /^https?:\/\//i.test(value)
        ? value
        : `https://${value}`;
      return withScheme;
    })
    .pipe(
      z
        .string()
        .url({ message: "Enter a valid URL like https://acquisity.com." })
    )
    .refine(
      (value) => {
        const u = new URL(value);
        return u.protocol === "https:" || u.protocol === "http:";
      },
      { message: "Only http:// and https:// URLs are supported." }
    )
    .refine(
      (value) => {
        const u = new URL(value);
        return !isPrivateHostname(u.hostname);
      },
      { message: "Cannot research private or local addresses." }
    ),
});

export type ResearchInputT = z.infer<typeof ResearchInput>;

/**
 * Normalise a hostname to the cache-key form: lowercase, no `www.`, no path.
 * Used as `target_domain` in `research_runs`.
 */
export function normaliseDomain(url: string): string {
  const u = new URL(url);
  return u.hostname.toLowerCase().replace(/^www\./, "");
}
