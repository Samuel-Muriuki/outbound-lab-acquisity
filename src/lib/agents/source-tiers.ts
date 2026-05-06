import "server-only";

/**
 * Static curated source-tier classifier.
 *
 * Source-tier confidence is additive metadata on each verified
 * decision maker — NOT a hard filter (validation already gates whether
 * the DM is surfaced at all). The tier signals to the visitor how
 * credible the corroboration trail is: a name found on the target's
 * own /team page + LinkedIn is trustworthy; a name found only on a
 * generic SEO blog isn't.
 *
 * Three tiers:
 *   HIGH   — first-party (target's own domain) or curated authoritative
 *            third parties (LinkedIn, Crunchbase, mainstream business
 *            press)
 *   MEDIUM — semi-curated developer/industry platforms (GitHub, Medium,
 *            dev.to, Substack)
 *   LOW    — anything else, including AI-generated wikis, content
 *            farms, generic SEO blogs (default)
 *
 * No learned scoring, no logging-based ranking, no ML. Curated lists,
 * versioned with the code, transparent to readers of the README. If
 * the lists need to evolve, that's a code change.
 *
 * The target's own domain is HIGH — passed in by the caller because
 * it varies per run.
 */

export type ConfidenceTier = "high" | "medium" | "low";

const HIGH_HOSTS: ReadonlySet<string> = new Set([
  "linkedin.com",
  "crunchbase.com",
  "bloomberg.com",
  "reuters.com",
  "techcrunch.com",
  "forbes.com",
  "wsj.com",
  "nytimes.com",
  "ft.com",
  "businesswire.com",
  "prnewswire.com",
  "ycombinator.com",
]);

const MEDIUM_HOSTS: ReadonlySet<string> = new Set([
  "medium.com",
  "dev.to",
  "github.com",
  "substack.com",
  "hashnode.dev",
  "stackoverflow.com",
  "producthunt.com",
  "indiehackers.com",
  "hn.algolia.com",
  "news.ycombinator.com",
  "newsletter.pragmaticengineer.com",
]);

/**
 * Normalise a hostname for set comparison: lowercase, strip leading
 * `www.`, and treat any subdomain of a registered host as the same
 * host (so `blog.medium.com` and `medium.com` both classify as MEDIUM).
 */
function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * True when `candidate` matches `target` exactly OR is a subdomain.
 * `target` is assumed already lowercased and non-www.
 */
function matchesHostOrSubdomain(candidate: string, target: string): boolean {
  return candidate === target || candidate.endsWith(`.${target}`);
}

export interface ClassifyOptions {
  /**
   * The target company's normalised domain (lowercase, no www). When
   * the source URL is on this domain or any of its subdomains, the
   * tier is automatically HIGH — the company's own pages are the
   * canonical first-party source.
   */
  targetDomain?: string;
}

/**
 * Classify a URL into a confidence tier. Returns "low" for any input
 * that isn't a parseable URL, isn't on the target's own domain, and
 * doesn't match the curated HIGH or MEDIUM lists.
 */
export function classifyTier(
  url: string,
  options: ClassifyOptions = {}
): ConfidenceTier {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "low";
  }
  const host = normaliseHost(parsed.hostname);

  // First-party (target's own domain) is HIGH regardless of curated
  // lists — the company is the authority on its own people.
  if (
    options.targetDomain &&
    matchesHostOrSubdomain(host, options.targetDomain.toLowerCase())
  ) {
    return "high";
  }

  for (const h of HIGH_HOSTS) {
    if (matchesHostOrSubdomain(host, h)) return "high";
  }
  for (const m of MEDIUM_HOSTS) {
    if (matchesHostOrSubdomain(host, m)) return "medium";
  }
  return "low";
}

/**
 * Pick the highest-confidence tier across a list of URLs. Used when
 * a decision maker is corroborated by multiple sources — the maker is
 * as credible as their best citation.
 */
export function highestTier(
  urls: ReadonlyArray<string>,
  options: ClassifyOptions = {}
): ConfidenceTier {
  let best: ConfidenceTier = "low";
  for (const url of urls) {
    const t = classifyTier(url, options);
    if (t === "high") return "high";
    if (t === "medium") best = "medium";
  }
  return best;
}

/** Test-only export — exposes the lists for unit tests. */
export const __testOnly__ = {
  HIGH_HOSTS,
  MEDIUM_HOSTS,
};
