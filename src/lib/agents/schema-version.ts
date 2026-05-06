import "server-only";

/**
 * Cache invalidation key. Bump whenever an agent prompt, validator, or
 * tool semantically changes in a way that should make prior cached
 * runs untrustworthy. The cache lookup (`findCachedRun`) filters on
 * this version — older rows are silently ignored, so older runs get
 * a fresh execution automatically.
 *
 * Bump log:
 *   1 — initial (all runs prior to 2026-05-05 16:00Z)
 *   2 — agent-3 anti-hallucination gate (PR #88)
 *   3 — agent-2 cross-domain co-occurrence validation gate (PR #90)
 *   4 — agent-1 source-grounding for recent_signals
 *
 * Pattern: when in doubt, bump. The cost is one extra ~30s research
 * run on the next visit per domain — far cheaper than serving stale,
 * regression-flavoured output to a recruiter.
 */
export const SCHEMA_VERSION = 4;
