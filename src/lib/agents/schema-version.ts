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
 *   8 — agent-2 engineering-leadership coverage as a first-class slot
 *       (CTO / VP Eng / founding engineer) + 4-call cap → 5-call cap
 *       to make room without sacrificing existing roles
 *   9 — orchestrator empty-DM resilience: skip Agent 3 when Agent 2
 *       returns zero verifiable decision makers, surface degraded
 *       state to UI instead of letting Agent 3 hallucinate a
 *       recipient from the buyer-persona placeholder
 *  10 — Bundle B: per-DM confidence + sources fields populated by
 *       validateDecisionMakers() — confidence=highestTier across
 *       the verifying URLs (source_url + target pages with name +
 *       linkedin_url). UI renders HIGH/MEDIUM/LOW pills next to
 *       names; old cached rows lack these fields and render no pill
 *
 * Pattern: when in doubt, bump. The cost is one extra ~30s research
 * run on the next visit per domain — far cheaper than serving stale,
 * regression-flavoured output to a recruiter.
 */
export const SCHEMA_VERSION = 10;
