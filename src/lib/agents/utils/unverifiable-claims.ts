/**
 * Anti-hallucination regex check for Agent 3 email body.
 *
 * Why this exists: even with the system prompt explicitly forbidding
 * invented facts, Llama can still emit a confident-sounding specific —
 * "612% growth in 5 months", "$50M raised", "Series B" — that looks
 * researched but is fabricated (or, more often, propagated from a
 * fabricated `recent_signals` entry produced upstream by Agent 1).
 *
 * The cost of one slip-up is high: a recipient who can verify the
 * claim is wrong loses trust in the entire system. So we treat any
 * specific numeric / structural claim as suspect by default and force
 * Agent 3 to rewrite the opener around the public value proposition,
 * which IS in the brief.
 *
 * Patterns intentionally err on the side of false-positives. Better to
 * over-trigger a retry than to send a fabrication.
 */

const UNVERIFIABLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b\d{2,}\s*%/,
    reason: 'multi-digit percentage (e.g. "612%")',
  },
  {
    // Two alternatives: <digit(s)>.<digit(s)><K|M|B> (catches "$1.2B")
    // OR ≥2 leading digits (catches "$50", "$50M") OR single-digit with
    // K/M/B suffix (catches "$5M", "$9B"). Excludes "$5" (one digit, no
    // suffix, no decimal — too low-stakes to be a fabrication tell).
    pattern: /\$\s*(?:\d+\.\d+\s*[KMB]|\d+\s*[KMB]\b|\d{2,})/i,
    reason: 'specific monetary figure (e.g. "$50M")',
  },
  {
    pattern: /\bSeries\s+[A-K]\b/,
    reason: 'funding round name (e.g. "Series B")',
  },
  {
    pattern: /\b(?:raised|secured|closed)\s+\$/i,
    reason: 'fundraising claim (e.g. "raised $X")',
  },
  {
    pattern: /\b\d{2,}x\s+(?:growth|increase|return)\b/i,
    reason: 'multiplier claim (e.g. "10x growth")',
  },
];

export interface UnverifiableClaimHit {
  reason: string;
  match: string;
}

/**
 * Returns the first unverifiable-claim hit, or null if the body is
 * clean. Caller (Agent 3 loop) decides whether to retry or surface
 * a `degraded` run.
 */
export function findUnverifiableClaim(body: string): UnverifiableClaimHit | null {
  for (const { pattern, reason } of UNVERIFIABLE_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      return { reason, match: match[0].trim() };
    }
  }
  return null;
}

/** Test-only export — exposes the pattern table for unit-test coverage. */
export const __testOnly__ = { UNVERIFIABLE_PATTERNS };
