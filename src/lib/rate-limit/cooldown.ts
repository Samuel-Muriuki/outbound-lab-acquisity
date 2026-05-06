import "server-only";

/**
 * Per-IP per-domain debounce / cooldown.
 *
 * Protects free-tier provider quotas from debug-iteration loops:
 * if the same IP submits a fresh research request for the same
 * normalised domain within COOLDOWN_MS of a previous one, we skip
 * the orchestrator entirely and reuse the most-recent cached run
 * (looked up by the caller via findCachedRun).
 *
 * In-memory Map by design — sufficient for the demo period:
 *  - Per-process state on Vercel (each Lambda instance has its own
 *    Map); on a single warm instance the dedupe works perfectly,
 *    on cold-start the worst case is "we run once more than we
 *    needed" — same as no cooldown
 *  - No migration, no Redis, no Postgres write per request
 *  - Auto-evicts entries older than 5× the cooldown window so the
 *    Map can't grow unbounded
 *
 * The existing `rate_limits` Postgres table is intentionally left
 * for the eventual daily-IP-quota work (Phase 3); they solve
 * different problems.
 */

const COOLDOWN_MS = 60_000; // 60 seconds — per the spec
const EVICT_OLDER_THAN_MS = COOLDOWN_MS * 5;

interface Entry {
  lastSeen: number;
}

const map: Map<string, Entry> = new Map();

function key(ip: string, domain: string): string {
  return `${ip.toLowerCase()}|${domain.toLowerCase()}`;
}

function evictStale(now: number): void {
  // Cheap eviction loop — only runs on writes. With < ~thousands of
  // active demo visitors per process this is well under 1ms.
  const cutoff = now - EVICT_OLDER_THAN_MS;
  for (const [k, v] of map) {
    if (v.lastSeen < cutoff) map.delete(k);
  }
}

/**
 * True when (ip, domain) was last touched within COOLDOWN_MS. Pure
 * read — does NOT update the lastSeen timestamp. Pair with
 * `markTriggered()` on the path that actually consumes the cooldown.
 */
export function isOnCooldown(ip: string, domain: string): boolean {
  const entry = map.get(key(ip, domain));
  if (!entry) return false;
  return Date.now() - entry.lastSeen < COOLDOWN_MS;
}

/**
 * Record that (ip, domain) just triggered a research request. Bumps
 * the lastSeen to now so subsequent requests within the next
 * COOLDOWN_MS will see isOnCooldown(...) === true.
 */
export function markTriggered(ip: string, domain: string): void {
  const now = Date.now();
  map.set(key(ip, domain), { lastSeen: now });
  evictStale(now);
}

/**
 * Test-only helper — wipes the in-memory Map between tests. Not part
 * of the public surface.
 */
export const __testOnly__ = {
  reset: () => map.clear(),
  size: () => map.size,
  cooldownMs: COOLDOWN_MS,
};
