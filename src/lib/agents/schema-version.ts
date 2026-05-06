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
 *   5 — agent-2 trusted-corpus fallback (DMs whose name appears on the
 *       target's own brief.sources are accepted even when the cited
 *       source is LinkedIn / unfetchable) + web_fetch timeout bump
 *       8s → 15s for legitimate slow corroboration sources
 *   6 — web_fetch SPA fallback via Tavily (rendered text for SPAs;
 *       changes what Agent 1 sees from JS-heavy targets like
 *       acquisity.ai itself, Linear, Vercel, Supabase)
 *   7 — agent-2 trusted-corpus seed-path probe (/about, /team,
 *       /leadership, /people, /story, /company, /our-team) on the
 *       target domain in addition to brief.sources — broadens
 *       the founder/leader-name detection surface
 *
 * Pattern: when in doubt, bump. The cost is one extra ~30s research
 * run on the next visit per domain — far cheaper than serving stale,
 * regression-flavoured output to a recruiter.
 */
export const SCHEMA_VERSION = 7;
