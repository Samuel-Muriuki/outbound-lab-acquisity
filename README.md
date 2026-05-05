# OutboundLab

<a href="https://www.buymeacoffee.com/elsamm"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me a Coffee" /></a>

> Multi-agent B2B research, on demand. Paste any company URL — get a personalised outreach package in under a minute.

**Live demo:** [outbound-lab-acquisity.vercel.app](https://outbound-lab-acquisity.vercel.app) — try the **Try it on Acquisity** button.

---

## What it does

OutboundLab takes any company URL and runs a three-agent pipeline:

1. **Reconnaissance** — figures out what the company does, who they sell to, recent signals
2. **People & ICP** — identifies up to 3 likely decision makers with verified sources
3. **Personalisation & Outreach** — drafts a cold email opening with a specific observation, plus 5 alternate hooks for variation

The agent reasoning streams to the UI in real time — tool calls, intermediate outputs, and final structured JSON, like watching Cursor's agent panel work.

## Why this exists

Built as a public technical artifact. The goal was to ship something useful end-to-end on a specific stack — Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + Postgres + pgvector + Vercel — in a few days, with the README as a decision log rather than a sales page.

## Stack

Fully free-tier — **$0/month**, resilient by design.

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js** (App Router, RSC by default) | Server Components keep the streaming UI lean |
| Language | **TypeScript strict** | Catches contract drift between agents |
| API | Route handlers + native SSE (Phase 1) → tRPC v11 (Phase 3) | Ship fast, migrate when the type-safety pays off |
| LLM (primary) | **Groq** `llama-3.3-70b-versatile` | Fastest inference (~500 tok/s); native function calling |
| LLM (fallback) | **Google Gemini 2.5 Flash** | Different infra; 1,500 req/day free |
| LLM (last resort) | **OpenRouter** free Llama | Routes to whichever free host is up |
| Orchestration | Vercel AI SDK (Phase 2+) | Cleanest streaming-tool-call protocol in Next.js |
| Embeddings | **Gemini `text-embedding-004`** | Free, 768d, sufficient for cache lookup |
| Search | **Tavily Search API** | Built for LLM agents; 1k/mo free |
| Database | **Supabase** Postgres + pgvector | One DB, transactional writes alongside cache |
| Hosting | **Vercel** Hobby | Edge functions for streaming routes |
| UI | Tailwind v4, shadcn/ui (zinc, dark default), Geist Sans + Mono | |

**Architectural decision:** the LLM provider chain is abstracted behind a single `chat()` function. Agents don't know which provider served them — fallback is invisible at the agent layer. The same pattern would work in production with paid tiers as the primary; the abstraction is provider-agnostic.

## Architecture

```
USER (browser)
  ↓
NEXT.JS (Vercel)
  ↓
ORCHESTRATOR (async generator, server-side)
  ├── Cache check → Postgres + pgvector (7-day exact match)
  ├── Agent 1 — Reconnaissance (tools: web_search, web_fetch)
  ├── Agent 2 — People & ICP (tools: web_search)
  └── Agent 3 — Personalisation (no tools — pure reasoning)
  ↓
SSE stream of events → client UI
  ↓
Persist final result + embedding for future cache hits
```

Detailed design lives in [`PLANNING-BRIEF.md`](./PLANNING-BRIEF.md) at the repo root.

## Decision log

Non-obvious calls worth surfacing:

**Why three separate agents instead of one big prompt with role separation?**
Each agent has a different optimal temperature and a different optimal toolset. Agent 3 has zero tools — it's pure reasoning over prior outputs. Splitting them lets each agent be tuned independently and produces tighter outputs at the cost of ~30% more tokens.

**Why a free-tier provider chain (Groq → Gemini → OpenRouter)?**
Demonstrates production-engineering thinking (graceful degradation, multi-provider abstraction, no single point of failure) without a paid API anywhere. Groq leads because ~500 tok/s makes the streaming UI feel instant. Gemini handles Groq rate-limits without missing a beat (different infra). OpenRouter routes to whatever free Llama host is up if both upstream providers are degraded.

**Why route handlers + native SSE for Phase 1 (then tRPC v11 in Phase 3)?**
Server Actions can't natively stream SSE, and route handlers ship fast. tRPC's value (end-to-end types) doesn't pay off until the surface area justifies it; the migration is a few PRs, schemas unchanged.

**Why pgvector instead of a managed vector DB (Pinecone, Weaviate)?**
Same Postgres I'm already running. One connection pool, transactional writes alongside business data. HNSW with cosine distance is fine at this scale (well under a million rows).

**Why Tavily over SerpAPI / Brave Search?**
Built for LLM agents — returns cleaned markdown with snippets, not raw HTML. Free tier is 1,000 searches/month, more than enough for a demo.

**Why a 7-day exact-domain cache instead of always-fresh?**
The "Run on Acquisity" CTA needs to be near-instant after the first run. Vector similarity (Phase 2) handles typos and similar domains. Stale data after 7 days falls through to a fresh run.

**Why server-side validation gates between agents?**
Agent 2 outputs are post-validated — each decision-maker name must appear in the cited source URL or it's dropped. No hallucinated people reach the email. Agent 3 output is regex-checked for forbidden phrases ("hope this email finds you well", "amazing", "game-changing") and retried if violated.

**Why dark mode by default?**
The audience uses agent products (Cursor, Linear, Vercel) that default dark. Light mode is a toggle, not a fight.

## Run locally

```bash
git clone git@github.com:Samuel-Muriuki/outbound-lab-acquisity.git
cd outbound-lab-acquisity
bash bootstrap.sh

# Fill in real keys
cp .env.example .env.local
# edit .env.local

pnpm dev
# Open http://localhost:3000
```

You'll need free accounts at:

- [Groq](https://console.groq.com) — primary LLM, 14,400 req/day free
- [Google AI Studio](https://aistudio.google.com/app/apikey) — Gemini fallback + embeddings
- [OpenRouter](https://openrouter.ai) — last-resort fallback
- [Tavily](https://tavily.com) — search tool, 1k/mo free
- [Supabase](https://supabase.com) — Postgres + pgvector, free tier, Singapore region recommended

Run the initial schema migrations in the Supabase SQL Editor (or via `supabase db push`):
- `supabase/migrations/20260502000000_initial.sql` — four tables + RLS + HNSW index
- `supabase/migrations/20260504000000_index_cache_source_id.sql` — covering index for the FK

## Tests

```bash
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint
pnpm test            # Vitest unit + integration (mocked)
pnpm test:e2e        # Playwright against E2E_BASE_URL
```

The Playwright spec runs against the production URL by default. Set `E2E_BASE_URL` to override.

Current state: **76 unit tests pass** in ~700 ms (LLM provider chain, both tools, all three agents, orchestrator, forbidden-phrase gate, hostname moderation). 1 integration test against `acquisity.com` runs end-to-end on real Groq + Tavily and is auto-skipped without keys.

## Project status

Phase 1 (MVP) is **live in production**. Cumulative shape:

- 28 PRs merged on `develop`, all via merge commits (no squash, no rebase)
- 76 unit tests passing (`pnpm test`), 1 integration test gated on API keys
- Backend: provider abstraction chain (Groq → Gemini → OpenRouter), web_search + web_fetch tools with SSRF guards, three agents with retry / cap / post-validation / forbidden-phrase gates, async-generator orchestrator with cache lookup, SSE route handler, two-layer hostname moderation (`obscenity` + Cloudflare Family DNS)
- Frontend: dark-default brand tokens, Geist Sans + Mono, hero + URL input + "Try it on Acquisity" preset, streaming agent timeline, 4-tab result card with copy-to-clipboard, recent runs preview, branded 404, skip-to-content link, focus management, `/` keyboard shortcut, site footer with portfolio + GitHub links

Phase 2 (cache via vector similarity, Vercel AI SDK migration, regenerate-warmer button) and Phase 3 (tRPC v11, PWA, rate limiting, Sentry) are tracked in [`BUILD-PLAN.md`](./BUILD-PLAN.md).

## What's intentionally out of scope

- Bulk research (one URL at a time — keep the demo simple)
- Email sending (drafts only — sending is the user's responsibility)
- Multi-language (English only)
- Authentication (Phase 3 adds optional magic-link)
- Mobile native app (web PWA only)

## 💖 Support

If you find this project useful, please consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting new features

## Author

[Samuel Muriuki](https://github.com/Samuel-Muriuki) · [samuel-muriuki.vercel.app](https://samuel-muriuki.vercel.app) · [LinkedIn](https://linkedin.com/in/El-Samm)

Built in Nairobi.

## License

MIT

---

Built for the [Acquisity](https://acquisity.com) Senior Full-Stack Engineer (Next.js / AI) application — May 2026.

<a href="https://www.buymeacoffee.com/elsamm"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me a Coffee" /></a>
