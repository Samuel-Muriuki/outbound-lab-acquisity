# OutboundLab

> Multi-agent B2B research, on demand. Paste any company URL — get a personalised outreach package in under a minute.

**Live demo:** [outbound-lab.vercel.app](https://outbound-lab.vercel.app) — try the **Run on Acquisity** button.

---

## What it does

OutboundLab takes any company URL and runs a three-agent pipeline:

1. **Reconnaissance** — figures out what the company does, who they sell to, recent signals
2. **People & ICP** — identifies up to 3 likely decision makers with verified sources
3. **Personalisation & Outreach** — drafts a cold email opening with a specific observation, plus 5 alternate hooks for variation

The agent reasoning streams to the UI in real time — tool calls, intermediate outputs, and final structured JSON, like watching Cursor's agent panel work.

## Why this exists

Built as a public technical artifact. The goal was to ship something useful on a specific stack (Next.js 15 App Router + tRPC + TypeScript + Tailwind + shadcn/ui + Postgres + pgvector + Vercel AI SDK) end-to-end in a few days, with the README as a decision log rather than a sales page.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router | Server Components keep the streaming UI lean |
| Language | TypeScript strict | Catches contract drift between agents |
| API | Server Actions → tRPC v11 | Started fast, migrated for type-safety |
| LLM | Groq Llama 3.3 70B Versatile | Best agent reasoning of the available models |
| Orchestration | Vercel AI SDK | Cleanest streaming-tool-call protocol in Next.js |
| DB | Supabase Postgres + pgvector | One DB, transactional writes alongside cache |
| Embeddings | Gemini text-embedding-004 | Industry default, low cost, 1,536 dims |
| Search | Tavily Search API | Built for LLM agents, returns clean markdown |
| Hosting | Vercel | Edge functions for streaming routes |

## Architecture

```
USER (browser)
  ↓
NEXT.JS 15 (Vercel)
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

Detailed design: [`/.ai/docs/06-agent-system-design.md`](./.ai/docs/06-agent-system-design.md) — but the `.ai/` folder is gitignored, so for the public version see the [PLANNING-BRIEF.md](./PLANNING-BRIEF.md) at the repo root.

## Decision log

A few non-obvious calls worth knowing:

**Why three separate Anthropic calls instead of one big prompt with role separation?**
Each agent has a different optimal temperature and a different optimal toolset. Agent 3 has zero tools — it's pure reasoning over prior outputs. Splitting them lets each agent be tuned independently and produces tighter outputs at the cost of ~30% more tokens.

**Why Server Actions in Phase 1, then tRPC v11 in Phase 3?**
Server Actions ship faster. tRPC's value (end-to-end types) didn't pay off until the surface area justified it. The migration is one PR per route handler — ~3 PRs total, schemas unchanged.

**Why pgvector instead of a managed vector DB (Pinecone, Weaviate)?**
Same Postgres I'm already running. One connection pool, one billing target, transactional writes alongside the business data. HNSW with cosine distance is fine at this scale (well under a million rows).

**Why Tavily over SerpAPI / Brave Search?**
Tavily is built for LLM agents — returns cleaned markdown with snippets, not raw HTML. Free tier is 1,000 searches/month, more than enough for a demo. Fallback in code is DuckDuckGo HTML scrape.

**Why a 7-day exact-domain cache instead of always-fresh?**
The "Run on Acquisity" CTA needs to be near-instant after the first run. Vector similarity (Phase 2) handles typos and similar domains. Stale data after 7 days falls through to a fresh run.

**Why dark mode by default?**
The product audience uses agent products that all default dark. Light mode is a toggle, not a fight.

## Cost

Per fresh research run: ~$0.04 (Anthropic) + negligible embedding cost. Per cache hit: $0.

100 demo runs ≈ $4. Hard cap at $20/month via Anthropic budget alert.

## Run locally

```bash
git clone git@github.com:Samuel-Muriuki/outbound-lab.git
cd outbound-lab
bash bootstrap.sh

# Fill in real keys
cp .env.example .env.local
# edit .env.local

npm run dev
# Open http://localhost:3000
```

You'll need accounts at:
- [Supabase](https://supabase.com) — free tier, Singapore region recommended
- [Anthropic](https://console.anthropic.com) — set a $20/month budget alert
- [OpenAI](https://platform.openai.com) — for embeddings only (~$0.02/M tokens)
- [Tavily](https://tavily.com) — free 1k searches/month

Run the schema migration in Supabase SQL Editor: [`supabase/migrations/20260502000000_initial.sql`](./supabase/migrations/20260502000000_initial.sql)

## Tests

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run test              # Vitest unit + integration (mocked)
npm run test:e2e          # Playwright against E2E_BASE_URL
```

The Playwright spec runs against the production URL by default. Set `E2E_BASE_URL` to override.

## What's intentionally out of scope

- Bulk research (one URL at a time — keep the demo simple)
- Email sending (drafts only — sending is the user's responsibility)
- Multi-language (English only)
- Authentication (Phase 3 adds optional magic-link)
- Mobile native app (web PWA only)

## Author

[Samuel Muriuki](https://github.com/Samuel-Muriuki) · [samuel-muriuki.vercel.app](https://samuel-muriuki.vercel.app) · [LinkedIn](https://linkedin.com/in/El-Samm)

Built in Nairobi.

## License

MIT

---

## Stack

Fully free-tier — $0/month, resilient by design.

| Layer | Choice | Why |
|---|---|---|
| LLM (primary) | **Groq** `llama-3.3-70b-versatile` | Fastest inference (~500 tok/s); native function calling |
| LLM (fallback) | **Google Gemini 2.5 Flash** | Different infra; 1,500 req/day free |
| LLM (last resort) | **OpenRouter** free Llama | Routes to whichever free host is up |
| Embeddings | **Gemini `text-embedding-004`** | Free, 768d, sufficient for cache lookup |
| Search | **Tavily** | Built for LLM agents; 1k/mo free |
| Database | **Supabase** Postgres + pgvector | Free tier, Singapore region |
| Hosting | **Vercel** Hobby | Edge functions for streaming |
| UI | Next.js 15 · TypeScript strict · Tailwind v4 · shadcn/ui · Geist | |

**Architectural decision:** the LLM provider chain is abstracted behind a single `chat()` function. Agents don't know which provider served them. Fallback is invisible at the agent layer.

This is the same pattern that runs in production at companies paying real API bills — but here it runs on $0/month free tiers. Swap the `providers` array order to put paid models first; nothing else changes.

## Decision log

A few decisions worth surfacing:

1. **Three agents, not one big one.** Independent reasoning per role; clean handoffs via Zod-validated JSON. Easier to debug, easier to swap, easier to evolve.

2. **Cache by exact domain (Phase 1) → vector similarity (Phase 2).** Most demo traffic re-researches the same companies; exact-domain hits are sub-200ms. Vector cache catches "same company, different URL" cases.

3. **Server-side validation gates between agents.** Agent 2 outputs are verified (each name must appear in the cited source URL) before Agent 3 runs. No hallucinated decision-makers reach the email.

4. **Forbidden-phrase regex on Agent 3 output.** "Hope this email finds you well", "amazing", "game-changing" → automatic retry. Sounds like a templated blast = doesn't ship.

5. **Dark-default UI.** This is a developer tool first. Light mode is toggleable but the canonical aesthetic is dark.

Built for the [Acquisity](https://acquisity.com) Senior Full-Stack Engineer (Next.js / AI) application — May 2026.
