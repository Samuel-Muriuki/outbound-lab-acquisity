import "server-only";

/**
 * Extract a usable client IP from request headers.
 *
 * Vercel sets `x-forwarded-for` (the first IP in the comma-separated
 * list is the original client). Cloudflare sets `cf-connecting-ip`.
 * Fall back to `x-real-ip` and finally `"unknown"` when nothing is
 * available (local dev with no proxy).
 *
 * The "unknown" fallback means everyone on a no-proxy origin shares
 * one cooldown bucket — acceptable for local dev / preview, never
 * reached in production.
 */
export function getClientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}
