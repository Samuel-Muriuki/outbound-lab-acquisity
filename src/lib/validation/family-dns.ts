import "server-only";
import { Resolver } from "node:dns/promises";

/**
 * Cloudflare Family DNS gate — second layer of hostname moderation
 * (the first is the sync `obscenity` matcher in `profanity.ts`).
 *
 * Cloudflare publishes 1.1.1.3 / 1.0.0.3 as resolvers that block adult
 * and malware content. Blocked hostnames resolve to the sentinel
 * `0.0.0.0`. This catches clean-token brand domains like `onlyfans.com`
 * or `chaturbate.com` that the profanity matcher can't see.
 *
 * Failure policy is *fail open* with a 500 ms timeout: a transient
 * Cloudflare blip should never block a legitimate user, and the agent
 * layer has its own SSRF guards as defence-in-depth.
 *
 * Server-only because `node:dns/promises` is a Node API and would break
 * the client bundle if this were imported anywhere downstream of a
 * client component.
 */

const FAMILY_RESOLVERS = ["1.1.1.3", "1.0.0.3"];
const DNS_TIMEOUT_MS = 500;
const FAMILY_BLOCKED_SENTINEL = "0.0.0.0";

const familyResolver = new Resolver();
familyResolver.setServers(FAMILY_RESOLVERS);

export async function isFamilyDnsBlocked(hostname: string): Promise<boolean> {
  try {
    const result = await Promise.race<string[]>([
      familyResolver.resolve4(hostname),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS)
      ),
    ]);
    return result.includes(FAMILY_BLOCKED_SENTINEL);
  } catch {
    return false;
  }
}
