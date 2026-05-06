import "server-only";
import { webFetchTool } from "../tools/web-fetch";
import type { EmitFn } from "../stream-events";

/**
 * Source-grounding verification for `recon.recent_signals`.
 *
 * The "612% growth" regression was Agent 1 inventing a confident-
 * sounding stat that didn't exist in any cited source. The downstream
 * Agent 3 anti-hallucination regex catches the leak in email bodies,
 * but the brief itself still carries the fabrication.
 *
 * This module re-fetches the cited sources after Agent 1 returns, then
 * drops any `recent_signals` entry that contains a verifiable specific
 * (number, percentage, dollar figure, "Series X") which CANNOT be
 * found in any of the cited source bodies. Soft claims with no
 * specifics pass through — they're harder to fabricate harmfully.
 *
 * Conservative trade-off: we'd rather drop a real-but-poorly-cited
 * signal than ship a fabricated one. If Agent 1 returns 3 signals and
 * 1 fails verification, we ship 2.
 */

/**
 * Extract the verifiable specifics from a signal — numbers (with
 * optional unit/suffix), monetary figures, fundraising round names.
 * Returns lowercase strings so callers can substring-match against
 * lowercased page bodies.
 */
export function extractSpecifics(signal: string): string[] {
  const tokens: string[] = [];

  // Multi-digit numbers, optionally with %, K, M, B, x suffix or
  // currency prefix. Matches "612%", "$50M", "10x", "1.2B", "30%".
  // Letter-boundary lookarounds prevent matching the "2B" inside
  // "B2B" or the "10x" inside "10xRunway".
  const numberRe =
    /(?<![a-zA-Z])\$?\s*\d+(?:[.,]\d+)?\s*(?:%|x|K|M|B)?(?![a-zA-Z])/gi;
  for (const m of signal.matchAll(numberRe)) {
    const trimmed = m[0].trim();
    // Skip standalone single digits (too noisy — "5 hires" matches
    // every page with a "5" anywhere). Require either ≥2 digits OR
    // a suffix/prefix to make it identifying.
    const numericPart = trimmed.replace(/[^\d]/g, "");
    if (numericPart.length === 0) continue;
    if (numericPart.length === 1 && /^\d$/.test(trimmed)) continue;
    // Skip plain 4-digit years (1900-2099) — these are timestamps in
    // dates / job postings ("May 2026"), not the fabrication-prone
    // metric we're verifying. Years on their own rarely fail to
    // appear in company pages anyway, but we'd rather not bounce a
    // legitimate hiring-date signal because the about page doesn't
    // happen to repeat the year.
    if (/^(?:19|20)\d{2}$/.test(trimmed)) continue;
    tokens.push(trimmed.toLowerCase());
  }

  // Funding-round names — "Series A" through "Series K".
  for (const m of signal.matchAll(/\bSeries\s+[A-K]\b/g)) {
    tokens.push(m[0].toLowerCase());
  }

  return tokens;
}

/**
 * True if the signal has at least one verifiable specific that we
 * could check against a source. False means "soft claim, accept".
 */
export function hasVerifiableSpecific(signal: string): boolean {
  return extractSpecifics(signal).length > 0;
}

/**
 * Fetch the cited sources once, then filter the signals: drop any
 * with verifiable specifics that don't appear in any source body.
 * Best-effort: a fetch failure leaves that source out of the corpus
 * but doesn't fail the verification — other sources may still ground
 * the signal.
 */
export async function verifySignalsAgainstSources(
  signals: string[],
  sources: string[],
  emit: EmitFn
): Promise<string[]> {
  if (signals.length === 0 || sources.length === 0) return signals;

  const bodies = await Promise.all(
    sources.map(async (url) => {
      try {
        const body = await webFetchTool.execute({ url });
        return body.toLowerCase();
      } catch {
        return "";
      }
    })
  );
  const corpus = bodies.join("\n\n");
  if (corpus.length === 0) {
    // All fetches failed (rare, e.g. all sources behind walls). Don't
    // drop signals — we have no evidence either way, and the agent
    // already cited these sources so it had access at the time.
    return signals;
  }

  return signals.filter((signal) => {
    const specifics = extractSpecifics(signal);
    if (specifics.length === 0) return true;
    const grounded = specifics.some((s) => corpus.includes(s));
    if (!grounded) {
      emit({
        type: "agent_thinking",
        agent: 1,
        delta: `Dropping signal — specifics ${JSON.stringify(specifics)} not found in cited sources: "${signal.slice(0, 80)}…"`,
      });
    }
    return grounded;
  });
}
