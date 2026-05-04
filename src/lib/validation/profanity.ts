import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

/**
 * Sync profanity gate for hostnames, isomorphic so both the HeroInput
 * client component and the `/api/research` route handler share one
 * source of truth via `ResearchInput.safeParse`.
 *
 * Wraps the `obscenity` package's english dataset + recommended
 * transformers (handles confusables like `p0rn`, `f@ck`, etc.). The
 * library bundles its own word list inside `node_modules` — nothing
 * offensive ever touches our git history.
 *
 * Hyphens are flattened to spaces before matching so domain segments
 * tokenise into real words. `porn-tube.com` becomes `porn tube com`,
 * which is what `obscenity`'s word-boundary detection expects, while
 * `popcorn.com` stays `popcorn.com` and never trips the matcher.
 *
 * The `onlyfans.com` / `chaturbate.com` class of clean-token brand
 * domains is intentionally not handled here — that's the Cloudflare
 * Family DNS layer's job in `family-dns.ts`.
 */

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** Single brand-voice user-facing message. Same string client + server. */
export const BLOCKED_MESSAGE =
  "That URL isn't allowed. This is a professional demo — try a real company URL.";

/** True if the hostname tokenises into anything `obscenity` flags. */
export function containsProfanity(hostname: string): boolean {
  const tokenised = hostname.toLowerCase().replace(/-/g, " ");
  return matcher.hasMatch(tokenised);
}
