# OutboundLab

**Multi-agent B2B research, on demand.** Paste any company URL → three AI agents research the company, identify decision-makers from public sources, and draft personalised outreach. Built on a free-tier LLM provider chain with structured validation gates between agents to keep hallucinations out of the final email.

- **Live:** https://outbound-lab-acquisity.vercel.app
- **Source:** https://github.com/Samuel-Muriuki/OutBound-Lab-Acquisity
- **Stack:** Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · shadcn/ui · tRPC v11 · Vercel AI SDK · Supabase Postgres · pgvector · Vercel
- **LLM chain:** Groq `llama-3.3-70b-versatile` → Gemini 2.5 Flash → OpenRouter free Llama (free tier across the board, $0/month)

---

## What it is

A working B2B outbound demo. The user pastes a URL like `linear.app`, picks a channel (Email / LinkedIn DM / X DM) and tone (cold / warm), and gets a streaming view of three agents working in sequence — Reconnaissance, People & ICP, Personalisation & Outreach — followed by a copy-pasteable message addressed to a real, verified decision-maker.

The interesting parts aren't the agents themselves. They're the validation gates between them, the source-grounding pass that drops fabricated stats from the brief before they reach the email, the static curated source-tier system that flags how trustworthy each citation is, and the durable cache invalidation that lets prompt changes ship without operator intervention.

---

## Architecture

```
URL paste
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Cache lookup  (exact-domain, 30-day window, schema-versioned)│
└──────────────────────────────────────────────────────────────┘
    │ miss
    ▼
┌─────────────────────────────────┐
│  Agent 1 — Reconnaissance       │   Tools: web_search, web_fetch
│  Llama @ Groq, temp 0.1         │   SPA fallback via Tavily when
│  6-tool-call cap, 2 retries     │   fetched HTML is empty
└─────────────────────────────────┘
    │
    │  Source-grounding pass: drop recent_signals
    │  whose specifics (612%, $50M, Series B,
    │  10x growth) don't appear in cited sources
    ▼
┌─────────────────────────────────┐
│  Agent 2 — People & ICP         │   Tool: web_search only
│  Gemini-first (load split)      │   Coverage: founder, engineering
│  5-tool-call cap, temp 0.2      │   leadership, growth, sales
└─────────────────────────────────┘
    │
    │  Three-tier validation gate:
    │    1. source on target domain → accept
    │    2. name on target's own pages → accept
    │    3. cross-domain body has name + target → accept
    │  Per-DM confidence tier (HIGH / MEDIUM / LOW)
    │  via curated source-tier classifier
    ▼
┌─────────────────────────────────┐
│  Agent 3 — Personalisation      │   No tools, temp 0.7
│  Llama @ Groq                   │   Anti-hallucination regex gate +
│  Single corrective retry        │   forbidden-phrase regex
└─────────────────────────────────┘
    │
    │  If decision_makers empty after Tier-3
    │  validation, skip Agent 3 and surface
    │  "no verifiable DMs found" UI state
    │  with deep-linked LinkedIn People Search
    ▼
Streaming UI · Email | LinkedIn DM | X DM tabs · target picker
```

**Streaming layer:** the orchestrator is a single `async generator<StreamEvent>` that yields events live as agents work. tRPC v11 subscriptions wrap it with SSE on the wire. Re-attach is handled by replaying `agent_done` events from the per-agent message log + polling for new ones, so a visitor who navigates away mid-run lands back on a usable timeline.

---

## Engineering decisions worth reading

**Free-tier provider chain as a first-class constraint.** The cost ceiling is part of the demo. Groq for primary inference (LPU speed feels live in the streaming UI), Gemini as fallback (different infrastructure, different rate-limit pool), OpenRouter as a last-resort safety net. The chain detects 429s and the AI SDK's `AI_RetryError` wrapper, falls through gracefully, and surfaces a per-provider breakdown when all three exhaust simultaneously. Per-agent provider preference lets Agent 2 (the heaviest tool-loop) start on Gemini to spread load away from Groq's TPM ceiling.

**Validation gates between agents, not creative trust.** Agent 2's output is post-validated server-side: each decision-maker is accepted if the source URL is on the target's own domain, OR if the name appears on any of the target's own pages, OR if a cross-domain source body contains both the name and the target company name. This is the single most important correctness fix shipped — it kills the "right name, wrong company" failure mode (e.g. surfacing Leila Hormozi of Acquisition.com when researching Acquisity, because the names are similar). Confidence scoring is additive metadata on top, not a hard filter.

**Source-grounding for Agent 1's recent_signals.** Models confidently invent specific-sounding stats ("612% growth in 5 months", "$50M Series B"). After Agent 1 returns its brief, a verifier re-fetches each cited source and drops any signal whose verifiable specifics — multi-digit percentages, monetary figures with K/M/B suffixes, funding round names, multiplier claims — can't be found anywhere in the cited corpus. Plus a downstream regex gate forces Agent 3 to fall back to the public value proposition if it tries to use one anyway.

**Static curated source tiers, not learned scoring.** Each verified decision-maker carries a `confidence` field — HIGH / MEDIUM / LOW — surfaced as a small pill next to their name. HIGH = first-party (target's own domain) + LinkedIn / Crunchbase / mainstream business press. MEDIUM = curated developer/industry platforms (Medium, dev.to, GitHub, Substack). LOW = anything else, including AI-generated wikis and SEO content farms. Tiers are versioned with the code, transparent, a code change to update. The alternative — learned tiers, logging-based ranking — drifts silently as the corpus changes; explicit lists don't.

**SPA-aware web fetching.** Many B2B targets a recruiter might paste — Linear, Vercel, Supabase — ship as JS-rendered SPAs. Direct HTTP GET returns 2-4 KB of script tags and an empty `<div id="root">`. The fetcher detects this (heavy raw HTML + thin stripped text) and falls back to a Tavily search of the same URL, where the rendered body is actually available. Combined with seed-path probing of conventional team-page paths (`/about`, `/team`, `/leadership`, `/people`, `/story`), this widens the demoable target pool sharply.

**Durable cache invalidation via SCHEMA_VERSION.** A single integer constant in the codebase. Every prompt or validator change that should invalidate prior runs increments it. The cache lookup filters on `schema_version = current` — older rows are silently bypassed and the next visit triggers a fresh execution. No manual SQL `DELETE`, no operator step. Currently at version 10 after this session's correctness work.

**Anti-fabrication gate on Agent 3 specifically.** Even with explicit prompt instructions, Llama on Groq sometimes leaks a confident-sounding number into the email body. A regex gate runs after Agent 3's output and triggers a corrective retry if the body contains any verifiable specific (multi-digit percentage, dollar figure, Series A-K, funding verb, multiplier). The retry instruction tells the model to fall back to the public value proposition — which IS in the brief — instead of citing any specific stat at all. Better a clean factual opener than a confident fabrication.

**Empty-DM resilience.** When Agent 2's validation gate drops every candidate (small startup, only the founder is publicly named anywhere), the orchestrator skips Agent 3 entirely instead of letting it hallucinate a recipient out of the buyer-persona placeholder. The Outreach tab surfaces a clear "no verifiable decision makers found" panel with a deep-linked **Open LinkedIn People Search** button pre-filled with the company name. The tool refuses to invent a recipient and points the user at the right manual path.

**Per-IP cooldown to protect free-tier quota.** A 60-second debounce keyed by `(ip, normalised_domain)`. When the same IP fires another fresh request for the same domain inside the window AND a recent cached run exists, the create endpoint returns the cached `run_id` directly instead of spinning up a new orchestrator pass. Implemented as an in-memory Map (no migration, no Redis) — sufficient for the demo period; documented limitation is per-Lambda-instance state.

---

## Stack — and why each piece

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, RSC by default, TypeScript strict | Server components carry the static surface (landing, /runs, brief shell). Streaming view is a single thin client island. |
| API | tRPC v11 with `httpSubscriptionLink` (SSE) | Procedure-typed end-to-end. The streaming agent pipeline is a single subscription returning `AsyncGenerator<StreamEvent>`. |
| LLM | Vercel AI SDK with `@ai-sdk/groq` + `@ai-sdk/google` + `@ai-sdk/openai-compatible` | Provider-agnostic typed surface. `chat.ts` is the single entry point every agent uses. |
| DB | Supabase Postgres + pgvector | Singapore region. RLS enabled. Vector(768) column with HNSW index for "Related research" similarity lookup. |
| Embeddings | Gemini `text-embedding-004` (768d) | Free tier. Written per successful run. Powers the related-runs panel. |
| Search | Tavily (1k req/mo free tier) | Used as Agent 1+2's web_search tool AND as the SPA fallback for web_fetch. |
| UI | Tailwind v4 + shadcn/ui (zinc, dark-default) + next-themes (system default) | Brand-tuned with custom CSS variables for agent colours, gradients, and motion easing. |
| Tests | Vitest (170 unit tests) + Playwright | Mocks the LLM chain at the boundary; live integration test against acquisity.ai runs on a daily GitHub Actions cron. |
| Hosting | Vercel Hobby | Edge for streaming routes; auto-deploy on push to main. |
| Errors | Sentry-ready (env vars wired, deferred for Phase 3) | — |

Every dependency was chosen with the free-tier story in mind. **No paid LLM provider. No paid data API (Crunchbase / Clearbit / Hunter / Apollo are out of scope forever).** The cost ceiling is part of the engineering value, not a compromise.

---

## What it deliberately doesn't try to be

- **Not a CRM.** No saved contacts, no campaigns, no analytics dashboard. One paste → one outreach package.
- **Not a LinkedIn auto-sender.** The tool drafts; the human pastes. Automated DMs violate LinkedIn's TOS, and there's no useful product without human gatekeeping anyway.
- **Not an email enricher.** No scraped recipient addresses. The "Recipient email not auto-populated — find via LinkedIn or the company's contact page" caption is intentional, not a gap.
- **Not a triangulation filter.** Source confidence is shown to the visitor as metadata. A LOW-tier DM is still surfaced; the visitor decides whether to trust the citation. Filtering on tier would silently drop real people whose only public mention happens to be on a non-curated host.

---

## By the numbers

| | |
|---|---|
| Lines of code (TS / TSX / SQL) | ~14,000 |
| Unit tests (Vitest) | 170 (1 skipped) |
| GitHub PRs merged | 100+ across the project lifecycle |
| Schema version (cache invalidation) | 10 |
| Agents in pipeline | 3 |
| Provider chain | 3-tier with structured fallback |
| Confidence tiers | 3 (HIGH / MEDIUM / LOW) |
| Validation tiers per decision-maker | 3 (target-domain / target-corpus / cross-domain co-occurrence) |
| LLM cost per run on free tier | $0 |

---

## What I'd build next

If extending this in production, the priority list:

1. **Triangulation requirements per tier.** Require ≥2 sources for HIGH, ≥1 for MEDIUM. Currently a single curated source sets the tier; with real-volume data this could be tightened.
2. **Logging-based source tier learning.** Currently static curated lists. With production traffic, sources that consistently fail downstream verification could be auto-demoted from MEDIUM → LOW. Out of scope for the demo because it needs the curated baseline to work first.
3. **Server-side cancellation.** Right now if a visitor navigates away mid-run the orchestrator keeps churning to completion. Wiring an `AbortSignal` through the agent runners would save quota.
4. **Daily IP-rate limit (10 runs/IP/day).** Distinct from the 60s same-domain cooldown; this would gate against single-IP abuse on a public free-tier demo.
5. **Magic-link auth (Supabase) + saved-runs dashboard.** Optional. Lets visitors come back to past research without remembering URLs.

None of these are blocking the demo's intended value; they're production hardening for the case where this becomes more than a portfolio piece.

---

## Author

Samuel Muriuki — built this to ship end-to-end on a specific stack in a few days, with the README as a decision log rather than a sales page.
