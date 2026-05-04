/**
 * Forbidden-phrase regex check for Agent 3 email output.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §9.3.
 *
 * The system prompt forbids these phrases up front. The model usually
 * obeys, but Llama-on-Groq sometimes leaks one — especially the
 * "hope this email finds you well" / "amazing" cliches that show up
 * heavily in pretraining data. This gate runs after the agent emits
 * its JSON; if any pattern matches, the agent retries once.
 *
 * Detected matches surface to the orchestrator (Session 4 PR L) so the
 * run can be marked `degraded` if the second attempt also fails.
 */

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bnoticed\s+your\s+company\s+is\s+doing\s+amazing\b/i,
    reason: '"noticed your company is doing amazing" cliche',
  },
  {
    pattern: /\b(?:I['’]ve|I\s+have|I)\s+been\s+following\s+your\s+journey\b/i,
    reason: '"following your journey" cliche',
  },
  {
    pattern: /\bhope\s+(?:this\s+(?:email\s+)?finds?\s+you\s+well|you\s+are\s+well)\b/i,
    reason: '"hope this email finds you well" cliche',
  },
  {
    pattern: /\b(?:incredible|amazing|game[-\s]?changing|revolutionary|next[-\s]?gen)\b/i,
    reason: "marketing-speak hyperbole",
  },
];

export interface ForbiddenPhraseHit {
  reason: string;
  match: string;
}

/**
 * Returns the first forbidden-phrase hit, or null if the body is clean.
 * Caller decides whether to retry or surface a `degraded` run.
 */
export function findForbiddenPhrase(body: string): ForbiddenPhraseHit | null {
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      return { reason, match: match[0] };
    }
  }
  return null;
}

/** Convenience wrapper for boolean checks. */
export function isEmailAcceptable(body: string): boolean {
  return findForbiddenPhrase(body) === null;
}

/** Test-only export — exposes the pattern table for unit-test coverage. */
export const __testOnly__ = { FORBIDDEN_PATTERNS };
