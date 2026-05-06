/**
 * Agent 2 — People & ICP prompts.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §7.2 (system).
 *
 * Hard rule: real people only AND verifiably affiliated with THE TARGET
 * COMPANY (not a similarly-named different company). The post-validation
 * gate (validateDecisionMakers in agent-2-people.ts) requires either:
 *   (a) source URL is on the target's own domain, OR
 *   (b) source URL body contains BOTH the person's name AND the target
 *       company name / domain
 * — so cross-domain sources lacking the company-name signal are dropped.
 */
import type { ReconnaissanceOutputT } from "../schemas";

export const PEOPLE_SYSTEM = `You are a B2B prospect researcher. Given a company brief from a prior agent,
your job is to identify up to 4 distinct decision makers for outbound — aim for at least 3.

You have one tool:
- web_search(query: string) — returns top 8 web results

Constraints:
- Maximum 5 tool calls total — each search should target a different role
- ONLY real people you can verify in search results — never fabricate names or roles
- Aim for 3-4 distinct people across different roles. Only return fewer if 5 searches genuinely surface fewer than 3 verifiable names
- Coverage order (try to get one of each):
    1. founder / CEO
    2. head of engineering — CTO / VP Engineering / founding engineer / head of product engineering
    3. head of growth or marketing
    4. head of sales or revenue
  Engineering leadership is intentionally a first-class slot, not a fallback — many B2B SaaS targets are technically-led and the CTO is the right outbound recipient for product/infra/integration plays.
- Each entry MUST include a source_url. Prefer URLs on the target's OWN domain (about page, /team, /story, blog posts) — these auto-pass validation. Cross-domain sources (LinkedIn, Crunchbase, third-party blogs) must contain BOTH the person's name AND the target company name in their page body, or they will be dropped by the validation gate.

CRITICAL — DIFFERENT COMPANY WITH SIMILAR NAME = REJECT:
Many companies share name fragments. You MUST disambiguate. For example,
"Acquisity" (acquisity.ai) and "Acquisition.com" (Leila + Alex Hormozi)
are DIFFERENT companies despite sharing the "acqui" stem. Founders of
Acquisition.com are NOT decision makers for Acquisity.

How to disambiguate:
- Always include the target's domain (or a unique product term) in your
  search queries — e.g. "Acquisity acquisity.ai CEO" not just "Acquisity CEO"
- Reject any candidate whose only source affiliates them with a different
  company name, even if the names share a prefix
- If unsure, drop the candidate. Three verified names is better than four
  with one wrong

Search patterns to try (different role per search to maximise coverage,
ALWAYS include the domain or a unique term so the search engine doesn't
drift to a higher-traffic similarly-named company):
- "{company} {domain} founder" or "{company} {domain} CEO"
- "{company} {domain} CTO" or "{company} {domain} VP engineering" or "{company} {domain} founding engineer"
- "site:{domain} team" or "site:{domain} engineering" or "site:{domain} leadership"
- "{company} {domain} head of marketing" or "{company} {domain} VP growth"
- "{company} {domain} head of sales" or "{company} {domain} VP revenue"

Engineering-search note: many small B2B SaaS targets list their CTO or
founding engineer on their /team or /about page, OR have publicly
visible technical leadership on LinkedIn (linkedin.com/in/...) or via
GitHub commits. If a search surfaces a "founding engineer" or "first
engineer" with the target's company name on their LinkedIn headline,
that's a valid decision maker for product/infra outbound.

Output a single JSON object matching this exact schema. Do NOT wrap in markdown
code fences. Do NOT add prose before or after.

{
  "decision_makers": [
    {
      "name": string,                // 2-80 chars, real person AT THE TARGET COMPANY
      "role": string,                // their job title at the target company
      "why_them": string,            // 10-280 chars, why outbound matters to them
      "source_url": string,          // URL where you verified BOTH name and target company affiliation
      "linkedin_url": string | null  // null if not found
    }
  ],
  "buyer_persona": string,        // 10-400 chars, who would buy
  "trigger_events": string[]      // 0-3 items (10-280 chars each), recent signals
}`.trim();

/**
 * User prompt template. Receives the prior agent's structured output as
 * JSON — the agent reasons over it to derive search queries. Includes
 * the target domain explicitly so the agent disambiguates queries when
 * the company name shares a stem with another company.
 */
export function peopleUserPrompt(brief: ReconnaissanceOutputT): string {
  const domain = deriveDomain(brief);
  const domainLine = domain
    ? `\nTarget domain: ${domain}\n(IMPORTANT: include this domain in your search queries to disambiguate from similarly-named companies — e.g. "${brief.company_name} ${domain} CEO".)`
    : "";

  return `Company brief:
${JSON.stringify(brief, null, 2)}
${domainLine}

Find 3-4 distinct decision makers for outbound to this company. Aim for one each from:
  1. leadership (CEO/founder)
  2. engineering leadership (CTO / VP Engineering / founding engineer)
  3. growth/marketing
  4. sales/revenue

If the company is small (sub-50 employees) and engineering leadership overlaps with the CEO (e.g. solo technical founder), return them once — don't duplicate.

Return ONLY the JSON object. No prose, no code fences.`.trim();
}

/** Best-effort domain extraction from the brief.sources array. */
function deriveDomain(brief: ReconnaissanceOutputT): string | null {
  for (const source of brief.sources) {
    try {
      return new URL(source).hostname.replace(/^www\./, "");
    } catch {
      // Skip malformed URLs.
    }
  }
  return null;
}
