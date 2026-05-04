# OutboundLab — Planning Brief

**Author:** Samuel Muriuki
**Date:** 02 May 2026
**Status:** Awaiting approval before build starts
**Target:** Acquisity application (Sr Full-Stack Engineer — Next.js / AI)
**Live target URL:** `outbound-lab.vercel.app`
**Repo:** `github.com/Samuel-Muriuki/outbound-lab-acquisity` (public)

---

## 0. Read me first — what this document is

This is the master decision document. Everything else (architecture docs, agent prompts, build plan, Claude Code instructions) is **generated from this brief**. If something here is wrong, fix it here first, then regenerate downstream docs. This is the single source of truth.

The brief is structured to be read top-to-bottom in 15 minutes. Section by section it answers:

1. Why this project exists
2. Who the audience is (and what each one needs)
3. What it does in plain English
4. The product surface (pages, flows, screens)
5. The technical architecture
6. The agent design (the heart of the project)
7. The cost budget
8. The phased build plan
9. The risk register
10. The quality bar
11. The success criteria

If you change phase scope, **update this file** and let downstream files re-derive. Do not let phase scope drift across multiple docs.

---

## 1. North Star — one sentence

**OutboundLab takes any company URL, runs a multi-agent research pipeline, and returns a personalised B2B outreach package — company brief, decision-makers, personalisation hooks, and a ready-to-send email — with the agent's reasoning visible in real time.**

That sentence is the elevator pitch, the README opener, the cover-letter line, the Loom intro, and the answer to "what did you build?" in the interview. It does not change.

---

## 2. Why this project exists (the strategic frame)

**Two things must be true simultaneously:**

| Audience | What they need to feel in the first 30 seconds |
|---|---|
| **Tasnim A.** (TA Lead at Acquisity, non-technical) | "Oh — this is the kind of thing our product does. He gets the problem we're solving. Let me forward this to engineering." |
| **CTO** (writes code daily, manages engineers directly) | "He built this on our exact stack. The code is clean. He understands agent architecture at the technical level. This is a hire." |

Most candidate portfolios fail at one or the other. OutboundLab is engineered to land both at once because:

- **The product story** is adjacent to Acquisity's domain (B2B research + outreach) without cloning a named feature
- **The build** is on Acquisity's exact stack: Next.js 15 App Router + tRPC + TypeScript + Tailwind + shadcn/ui + Postgres + Vercel + Vercel AI SDK + pgvector
- **The CTA** ("Run on Acquisity") makes the recruiter the first user — they cannot resist clicking
- **The README** is a decision log, not a sales pitch — appeals to the engineer reviewer

**It is also a real portfolio piece** that survives this single application. Forex Lab. MuriukiDB. TricomHub. **OutboundLab.** Add to portfolio, list on resume, talk about it for years.

---

## 3. Audiences & user journeys

### 3.1 Recruiter journey (Tasnim)

She receives a LinkedIn DM with one link.

1. Clicks `outbound-lab.vercel.app`
2. Lands on a clean dark-themed landing page. Hero CTA: **"Try it on Acquisity."**
3. Clicks that CTA. URL pre-fills as `acquisity.com`.
4. Watches in real time as the agent narrates: *"Researching Acquisity... found their site... reading product page... identifying ICP... finding decision makers..."*
5. After ~30-45 seconds, sees a clean results card with: company brief, ICP summary, top 3 decision makers (one of whom should be Tasnim if the Niche Researcher works), 5 personalisation hooks, and a draft outreach email.
6. The footer says: *"Built by Samuel Muriuki. Read the README →"* (link to GitHub).

**Time to "wow" target: ≤45 seconds.**

She forwards the link to the CTO with: *"Take a look — Senior Full-Stack candidate built a working agent on our stack."*

### 3.2 CTO journey

1. Opens the link.
2. Clicks "Run on Acquisity" — sees the agent stream, watches tool calls render with their inputs and outputs (like Cursor's agent panel).
3. Notes the URL doesn't say `localhost`, the page loads under 2 seconds, the streaming is smooth.
4. Opens DevTools — checks the network tab. Sees streamed SSE responses. Sees tRPC procedure calls.
5. Opens the GitHub repo from the footer link.
6. Reads the README — sees the decision log: *why pgvector over a managed vector DB, why role-separated single calls in v1, why Vercel AI SDK over raw provider SDKs for v2, why a free-tier provider chain (Groq → Gemini → OpenRouter) instead of a paid primary.*
7. Skims `git log` — sees 30+ atomic gitmoji commits, no AI attribution, professional history.
8. Skims `.ai/docs/06-agent-system-design.md` — sees the agent prompts laid out, the handoff protocol, the JSON schemas.
9. Adds Samuel to the "yes" pile.

**Time to "yes" target: ≤3 minutes.**

### 3.3 Sales lead journey (the bonus persona)

If a sales/growth lead at Acquisity opens the link, they should think: *"I would actually use this tool."* That requires:

- The output must be **genuinely useful** (not a Lorem-Ipsum demo)
- The personalisation hooks must be **specific** (not "your company is great")
- The email must be **realistic** (not robotic, not over-warm)

This is the test — if a real salesperson finds the email good enough to send, the agent works.

---

## 4. What it does — the product surface

### 4.1 Pages

| Path | Purpose | Phase |
|---|---|---|
| `/` | Landing — hero, "Run on Acquisity" CTA, URL input, recent runs gallery | 1 |
| `/research/[id]` | Single research run — streaming view, results card, share link | 1 |
| `/runs` | Past research gallery (publicly visible, anonymous) | 2 |
| `/about` | What this is, why it exists, link to GitHub & resume | 2 |
| `/api/research` | Server endpoint (Server Action in v1, tRPC procedure in v3) | 1 |

### 4.2 Hero landing — the 30-second pitch

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  OutboundLab                                             │
│  Multi-agent B2B research, on demand.                    │
│                                                          │
│  Paste any company URL. Get a personalised outreach     │
│  package in under a minute — researched by AI, not       │
│  templated.                                              │
│                                                          │
│  ┌─────────────────────────────┐ ┌──────────────────┐    │
│  │ https://acquisity.com       │ │   Research →     │    │
│  └─────────────────────────────┘ └──────────────────┘    │
│                                                          │
│  ▸ Try it on Acquisity     ▸ See past runs               │
│                                                          │
│  Built by Samuel Muriuki. Read the code →                │
└──────────────────────────────────────────────────────────┘
```

### 4.3 Streaming research view — the moment that wins the job

This is the screen the CTO will spend the most time on. It must look like Cursor's agent panel, not a chat:

```
┌──────────────────────────────────────────────────────────┐
│ ← Back     OutboundLab                          Share ⤴  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Researching: acquisity.com                              │
│  ─────────────────────────────────────────               │
│                                                          │
│  ▸ AGENT 1 — Reconnaissance              ✓ 4.2s          │
│     ↪ web_search("acquisity B2B AI growth platform")    │
│       returned 8 results                                 │
│     ↪ web_fetch("https://acquisity.com/about")          │
│       returned 1,247 words                               │
│     ↪ Decision: B2B SaaS, ~20 employees, AI agents for  │
│       sales and marketing automation.                    │
│                                                          │
│  ▸ AGENT 2 — People & ICP                ✓ 6.1s          │
│     ↪ web_search("Acquisity team LinkedIn")             │
│     ↪ Identified 3 likely decision makers (see below)   │
│                                                          │
│  ▸ AGENT 3 — Personalisation & Outreach  ⏳ streaming... │
│     Drafting email for: Tasnim A.                        │
│     "Hi Tasnim — saw that Acquisity is scaling its..."  │
│     ▌                                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4.4 Results card — what the recruiter actually sees

After agents finish:

- **Company brief** (3-4 sentences): what they do, who they sell to, recent signals
- **Top 3 decision makers**: name, role, source link, why they matter
- **5 personalisation hooks**: specific facts the email could open with
- **Draft email**: subject + body, copy button, "Regenerate (warmer tone)" button
- **Sources**: every URL the agent fetched, expandable
- **Run metadata**: model used, total tokens, total cost, time elapsed

---

## 5. Technical architecture

### 5.1 Stack — locked decisions with rationale

| Layer | Choice | Rationale (defendable in interview) |
|---|---|---|
| **Framework** | Next.js 15 App Router | Acquisity's stack. Server Components reduce hydration cost on streaming UI. |
| **Language** | TypeScript strict | Acquisity's stack. Strict mode catches the kinds of contract bugs that killed my Crossover assessment. |
| **API layer (Phase 1-2)** | Route handlers + native SSE | Server Actions can't natively stream SSE; route handlers ship fast and give clean control over the event taxonomy in §5.3. tRPC migration in Phase 3 demonstrates planned evolution. |
| **API layer (Phase 3)** | tRPC v11 | Acquisity's stack. End-to-end type safety; eliminates the API-contract drift class of bugs. |
| **Styling** | Tailwind + shadcn/ui | Acquisity's stack. shadcn over a heavier component library — own the component code. |
| **Theme** | Dark by default, light toggle | Matches Acquisity's product UI tone. Modern. |
| **LLM** | Groq Llama 3.3 70B Versatile (model: `llama-3.3-70b-versatile`) | Best at tool-use reasoning. Acquisity is building agents — pick the agent-best model. |
| **AI orchestration (Phase 1)** | Direct OpenAI SDK (Groq compatible) + Gemini SDK | Simpler for Phase 1; one fewer dependency to debug while shipping fast. |
| **AI orchestration (Phase 2+)** | Vercel AI SDK | Acquisity's stack. `streamText` + `tool` + `useChat` is the cleanest streaming-tool-call protocol in Next.js. |
| **Database** | Supabase Postgres + pgvector | Acquisity's stack. Free tier sufficient. pgvector for cache + embeddings. |
| **Vector embeddings** | Gemini `text-embedding-004` | Free tier. 768 dims — sufficient for cache lookup; smaller HNSW index than 1,536d alternatives. (Note: OpenAI's embedding model is `text-embedding-3-small`; `text-embedding-004` is exclusively a Gemini name.) |
| **Search tool** | Tavily Search API (free tier 1,000/mo) | Built for LLM agents. Returns clean markdown. Falls back to DuckDuckGo HTML scrape if quota hit. |
| **Scrape tool** | `web_fetch` (custom: native `fetch` + HTML strip, capped at 4 KB) | Reading specific URLs the agent picks; provider-agnostic. SSRF guards block localhost/private IPs. |
| **Deploy** | Vercel | Acquisity's stack. Edge functions for streaming. |
| **DB hosting** | Supabase (Singapore region, lowest latency from Nairobi) | Free tier; 500MB enough for the demo. |
| **Auth (Phase 3)** | Supabase Auth, magic-link only | 5-minute setup. Just gates the demo from abuse. Optional; landing page still works without login. |
| **Rate limiting (Phase 3)** | Upstash Redis (free tier) | Edge-compatible. 10 runs per IP per day. |
| **Errors** | Sentry (free tier) | Industry default. Acquisity almost certainly uses it. |
| **Analytics** | Vercel Web Analytics | Free, zero-config, GDPR-compliant. |
| **Testing** | Playwright (one full-flow E2E spec) | Matches my TricomHub workflow. One test, run before every PR. |
| **CI** | GitHub Actions | Lints, type-checks, runs the Playwright spec on every push to `develop`. |

### 5.2 System diagram (in words)

```
USER (browser)
  │
  ▼
NEXT.JS 15 APP ROUTER (Vercel Edge)
  ├── / (landing page, RSC)
  ├── /research/[id] (streaming UI, client component)
  └── /api/research (Server Action → orchestrator)
              │
              ▼
       AGENT ORCHESTRATOR (server-side, Vercel function)
              │
              ├── Cache check ─────────────► Supabase Postgres + pgvector
              │                                 (research_runs table,
              │                                  embeddings table with HNSW)
              │   (if cache hit, stream cached result + return early)
              │
              ├── AGENT 1: Reconnaissance ──► Tavily search ─► chat() — Groq Llama 3.3 70B
              │                                    │              (fallback: Gemini → OpenRouter)
              │                                    ▼
              │                               web_fetch (specific URLs)
              │
              ├── AGENT 2: People & ICP ────► Tavily search ─► chat() — Groq Llama 3.3 70B
              │                                                  (fallback: Gemini → OpenRouter)
              │
              └── AGENT 3: Personalisation ─► (no tools) ─────► chat() — Groq Llama 3.3 70B
                                                                (fallback: Gemini → OpenRouter)
                          │
                          ▼
              Final structured JSON output
                          │
                          ▼
              Embed + cache to Postgres
                          │
                          ▼
              Stream final result back to client (SSE / Vercel AI SDK)
```

### 5.3 Streaming protocol

Every event is sent as Server-Sent Event from the Server Action. Event types:

| Event type | When | Payload |
|---|---|---|
| `agent_start` | Agent N begins | `{ agent: 1, name: "Reconnaissance" }` |
| `tool_call` | Agent invokes a tool | `{ agent: 1, tool: "web_search", input: { query: "..." } }` |
| `tool_result` | Tool returns | `{ agent: 1, tool: "web_search", result_summary: "8 results returned" }` |
| `agent_thinking` | Agent emits a token of natural language | `{ agent: 1, delta: "Looking at the about page..." }` |
| `agent_done` | Agent finishes | `{ agent: 1, duration_ms: 4200 }` |
| `final_result` | All agents done, structured output ready | `{ ...full result schema... }` |
| `error` | Anything fails | `{ stage: "agent_2", message: "..." }` |

This event taxonomy is what makes the UI look professional. Every event has a visual representation.

---

## 6. Database schema

### 6.1 Tables

```sql
-- Research runs (one per "Research" click)
CREATE TABLE research_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url      TEXT NOT NULL,
    target_domain   TEXT NOT NULL,                      -- normalised: lowercased, no www, no trailing slash
    status          TEXT NOT NULL DEFAULT 'pending',    -- pending | running | done | error
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INT,
    model           TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
    total_tokens    INT,
    total_cost_usd  NUMERIC(10, 6),
    result          JSONB,                              -- the final structured output
    error_message   TEXT,
    cache_hit       BOOLEAN NOT NULL DEFAULT FALSE,
    cache_source_id UUID REFERENCES research_runs(id),  -- if this run was served from cache, link to source
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_runs_target_domain_idx ON research_runs(target_domain);
CREATE INDEX research_runs_created_at_idx ON research_runs(created_at DESC);

-- Cached embeddings for cache lookups
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE research_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    target_domain   TEXT NOT NULL,
    embedding       vector(768) NOT NULL,              -- text-embedding-004
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_embeddings_hnsw_idx
    ON research_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Per-agent message log (for the streaming view + debugging)
CREATE TABLE research_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    agent_index     INT NOT NULL,                       -- 1, 2, 3
    agent_name      TEXT NOT NULL,
    role            TEXT NOT NULL,                      -- system | user | assistant | tool
    content         JSONB NOT NULL,
    tokens_in       INT,
    tokens_out      INT,
    duration_ms     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_messages_run_id_idx ON research_messages(run_id);

-- Rate limiting (Phase 3 — could also be Upstash Redis, choose one)
CREATE TABLE rate_limits (
    ip              TEXT NOT NULL,
    day             DATE NOT NULL,
    request_count   INT NOT NULL DEFAULT 1,
    PRIMARY KEY (ip, day)
);
```

### 6.2 RLS

Phase 1 — public read on `research_runs`, no writes from client (all writes via service role from server). Phase 3 — add per-user filtering if auth is added.

```sql
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_runs_public_read ON research_runs FOR SELECT USING (true);

ALTER TABLE research_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_messages_public_read ON research_messages FOR SELECT USING (true);

-- research_embeddings has no public policy — server-only access via service role
ALTER TABLE research_embeddings ENABLE ROW LEVEL SECURITY;
```

### 6.3 Cache lookup logic

```typescript
async function findCachedRun(domain: string): Promise<ResearchRun | null> {
    // 1. Exact domain match within last 7 days
    const { data: exact } = await supabase
        .from('research_runs')
        .select('*')
        .eq('target_domain', domain)
        .eq('status', 'done')
        .gte('completed_at', new Date(Date.now() - 7 * 86400_000).toISOString())
        .order('completed_at', { ascending: false })
        .limit(1);
    if (exact && exact.length > 0) return exact[0];

    // 2. Vector similarity match (for typos / similar domains)
    // Skipped in v1 — exact match only. Phase 2 enables this.
    return null;
}
```

---

## 7. Agent system design (the heart)

### 7.1 Why three agents

| Agent | Role | Why separate it |
|---|---|---|
| **Agent 1: Reconnaissance** | What does this company do? | Independent task with bounded scope. Cheap to prompt-engineer. Output feeds the next two. |
| **Agent 2: People & ICP** | Who are the decision makers? Who do they sell to? | Different tool-use pattern (LinkedIn search vs site fetch). Output is structured list. |
| **Agent 3: Personalisation & Outreach** | Given (1) and (2), what should the email say? | No tools needed — pure reasoning. Different model temperature (0.7 vs 0.2). |

**Each agent is a separate API call** (in Phase 2+; Phase 1 is one large prompt with role separation). This is what "real multi-agent" means: agents pass structured output to each other, not raw history.

### 7.2 Agent 1: Reconnaissance

**System prompt:**

```
You are a B2B research analyst. Your job is to understand what a company does in
under 90 seconds of work.

You have two tools:
- `web_search(query: string)` — returns top 8 web results with snippets
- `web_fetch(url: string)` — returns the readable text content of one URL

Your output must be a JSON object matching this schema:
{
  "company_name": string,
  "one_liner": string,        // ≤ 20 words, what they do
  "what_they_sell": string,   // ≤ 50 words, the product
  "target_market": string,    // ≤ 50 words, ICP
  "company_size_estimate": string,  // e.g. "20-50 employees"
  "recent_signals": string[], // 0-3 newsworthy facts (funding, launches, hires)
  "sources": string[]         // URLs you actually used
}

Constraints:
- Maximum 6 tool calls total
- If you don't have enough info after 6 calls, output what you have with empty fields
- Never speculate — only state what you can cite
```

**User prompt:**

```
Research this company: {target_url}

Approach:
1. Fetch their homepage
2. Search for their company name + "B2B" + "what they do"
3. Fetch their about/product page if found
4. Output the JSON.
```

### 7.3 Agent 2: People & ICP

**System prompt:**

```
You are a B2B prospect researcher. Given a company brief from a prior agent, your
job is to identify the 3 most likely decision makers for an outbound conversation.

You have one tool:
- `web_search(query: string)` — returns top 8 web results

Your output must be a JSON object matching this schema:
{
  "decision_makers": [
    {
      "name": string,
      "role": string,
      "why_them": string,         // ≤ 30 words, why they matter for outbound
      "source_url": string,       // where you found them
      "linkedin_url": string | null
    }
  ],          // exactly 3 entries
  "buyer_persona": string,        // ≤ 50 words, who would buy this
  "trigger_events": string[]      // 0-3 hiring/funding signals worth opening with
}

Constraints:
- Maximum 4 tool calls
- Search patterns to try: "{company} CEO", "{company} VP marketing", "{company} head of growth", "{company} hiring"
- Real people only — never fabricate
- If you can't find 3 real people, return fewer
```

**User prompt:**

```
Company brief:
{agent_1_output_json}

Find 3 likely decision makers for outbound to this company.
```

### 7.4 Agent 3: Personalisation & Outreach

**System prompt:**

```
You are a B2B outbound copywriter. Given a company brief and a list of decision
makers, draft a single personalised cold email to the FIRST decision maker.

The email must:
- Open with a SPECIFIC observation from the company brief (not a generic compliment)
- Include exactly ONE clear ask (a 15-min call, a reply, a demo)
- Be ≤ 120 words in the body
- Have a subject line ≤ 50 characters
- Sound like a human who did 5 minutes of research, not a template

You also output 5 "personalisation hooks" — short factual observations from the
brief that could open similar emails for variation.

Output schema:
{
  "to": { "name": string, "role": string },
  "subject": string,
  "body": string,
  "personalisation_hooks": string[],   // 5 items, each ≤ 25 words
  "tone": "cold" | "warm"
}

Constraints:
- No tools available — pure reasoning
- Never invent facts — every observation must trace back to the brief
- No hyperbole, no superlatives, no "I noticed your company is doing amazing things"
```

**User prompt:**

```
Company brief:
{agent_1_output_json}

Decision makers:
{agent_2_output_json}

Draft the email to the first decision maker. Target tone: cold (we have not
spoken before).
```

### 7.5 Orchestrator pseudocode

```typescript
async function* runResearch(targetUrl: string): AsyncIterable<StreamEvent> {
  const domain = normalizeDomain(targetUrl);

  // Cache check
  const cached = await findCachedRun(domain);
  if (cached) {
    yield { type: 'cache_hit', source_id: cached.id };
    yield { type: 'final_result', payload: cached.result };
    return;
  }

  // Create run record
  const run = await createRun({ target_url: targetUrl, target_domain: domain });
  yield { type: 'run_created', run_id: run.id };

  try {
    // Agent 1
    yield { type: 'agent_start', agent: 1, name: 'Reconnaissance' };
    const recon = await runAgent1(targetUrl, (event) => yield event);
    yield { type: 'agent_done', agent: 1 };

    // Agent 2
    yield { type: 'agent_start', agent: 2, name: 'People & ICP' };
    const people = await runAgent2(recon, (event) => yield event);
    yield { type: 'agent_done', agent: 2 };

    // Agent 3
    yield { type: 'agent_start', agent: 3, name: 'Personalisation & Outreach' };
    const email = await runAgent3(recon, people, (event) => yield event);
    yield { type: 'agent_done', agent: 3 };

    const result = { recon, people, email };
    await completeRun(run.id, result);
    await cacheEmbedding(run.id, domain, JSON.stringify(result));

    yield { type: 'final_result', payload: result };
  } catch (err) {
    await failRun(run.id, err.message);
    yield { type: 'error', stage: 'orchestrator', message: err.message };
  }
}
```

(Implementation note: the orchestrator runs inside a `POST` route handler at `/api/research/[id]/stream` that returns a `ReadableStream` with `Content-Type: text/event-stream`. Server Actions can't natively stream SSE, which is why route handlers are the locked Phase 1 choice — see §5.1.)

---

## 8. Cost budget

This must be free or near-free. The whole project should run on free tiers.

| Service | Free tier | Worst-case demo cost |
|---|---|---|
| Vercel hosting | Hobby plan free | $0 |
| Supabase | 500 MB DB, 50K MAUs free | $0 |
| Groq Llama 3.3 70B Versatile | $3/M input, $15/M output | ~$0.04 per research run |
| OpenAI embeddings | $0.02/M tokens | ~$0.0002 per run |
| Tavily Search | 1,000 free searches/mo | $0 (cap at ~6 searches per run = 167 runs/mo) |
| Upstash Redis | 10K commands/day free | $0 |
| Sentry | 5K errors/mo free | $0 |
| GitHub Actions | 2,000 min/mo free | $0 |

**Per-run cost estimate (no cache):** **$0.00** — Groq Llama 3.3 70B free tier (14,400 req/day), Gemini 2.5 Flash fallback (1,500 req/day), OpenRouter free Llama as last resort, Gemini `text-embedding-004` (free).

**100 demo runs ≈ $0.** Cache strategy further reduces upstream calls.

**Free-tier guard**: if all three providers are simultaneously degraded (extremely rare — they share no infrastructure), the app returns a polite "demo capacity reached. Try again in an hour." message rather than failing silently.

---

## 9. The phased build plan

### Phase 1 — Tight MVP (target: 8–12 hours)

**Goal:** A live, working, single-flow demo on Acquisity's stack.

| Task | Acceptance criterion | Commit |
|---|---|---|
| Bootstrap repo | `bootstrap.sh` runs, repo on GitHub, Vercel deploys empty page | 🎉 chore: initial project setup |
| Next.js 15 + TypeScript strict + Tailwind + shadcn install | `npm run dev` shows shadcn button | 🔧 build: scaffold Next.js 15 + Tailwind + shadcn/ui |
| Supabase project + schema migration | Tables created, RLS enabled | 🗃️ db: add research_runs, research_messages, research_embeddings |
| `.env.example` populated | Every secret documented with comment | 📝 docs: complete .env.example |
| Landing page UI | Loads in <2s, hero CTA visible | ✨ feat(landing): hero with URL input and Run-on-Acquisity CTA |
| Server Action `/api/research` | Validates URL, creates run row, returns run_id | ✨ feat(api): research Server Action with URL validation |
| OpenAI SDK (Groq compatible) + Gemini SDK integration | One test call returns sample response | ✨ feat(ai): OpenAI SDK (Groq compatible) + Gemini SDK client and tool-use harness |
| Tavily search tool | Tool function returns structured results | ✨ feat(tools): Tavily search wrapper with typed results |
| Agent 1 (Reconnaissance) | Returns valid JSON for `acquisity.com` | ✨ feat(agents): Reconnaissance agent with web_search and web_fetch tools |
| Agent 2 (People & ICP) | Returns 3 decision makers for `acquisity.com` | ✨ feat(agents): People and ICP agent |
| Agent 3 (Personalisation) | Returns valid email JSON | ✨ feat(agents): Personalisation and outreach agent |
| Orchestrator | Runs all 3 agents in sequence, persists results | ✨ feat(orchestrator): sequential agent execution with persistence |
| Streaming UI | Shows progress as agents run | ✨ feat(streaming): server-sent events for agent progress |
| Results card UI | Renders the final JSON cleanly | ✨ feat(results): research result card with sources and email |
| Error states | "Couldn't reach that URL" graceful handling | 🐛 fix(api): graceful error handling for invalid URLs |
| One Playwright E2E test | `npm run test:e2e` passes against production URL | 🧪 test(e2e): full research flow on production |
| Vercel deploy + custom subdomain | Live at outbound-lab.vercel.app | 🚀 deploy: production Vercel configuration |
| README v1 | What / why / stack / how to run / decision log | 📝 docs: README v1 with decision log |

**Phase 1 quality gate:** Run the Playwright test on production. If green, Phase 1 ships. Send link to Tasnim.

### Phase 2 — Differentiator layer (target: +6-10 hours)

**Goal:** Migrate to Vercel AI SDK, add caching, polish streaming.

| Task | Acceptance criterion |
|---|---|
| Migrate provider chain to Vercel AI SDK | `streamText` + `tool` working with Groq → Gemini → OpenRouter fallback intact |
| Add OpenAI embeddings + pgvector cache | "Run on Acquisity" second time → <300ms response from cache |
| Visible tool-call UI | Tool calls render with input/output expandable |
| Past Runs page | `/runs` shows last 10 public runs |
| Email regenerate (warmer tone) | Button calls Agent 3 again with `tone: "warm"` |
| Sentry integration | Errors flow into dashboard |
| OG image | Social share preview shows OutboundLab branding |

**Phase 2 quality gate:** Cache hit on Acquisity is genuinely <300ms. Tool-call UI is genuinely useful.

### Phase 3 — Production polish (target: +4-6 hours)

**Goal:** Show the production-engineering side.

| Task | Acceptance criterion |
|---|---|
| Migrate Server Actions → tRPC v11 | Type-safe end-to-end |
| PWA: manifest, service worker, install prompt | Lighthouse PWA score >90 |
| Rate limiting | 10 runs per IP per day |
| Optional Supabase magic-link auth | Log in to remove rate limit |
| Loom video embedded | 60-90 sec walkthrough on landing page |
| README v2 with architecture diagram | One image, one decision log section |
| Sentry + Vercel Web Analytics live | Dashboards have data |

**Phase 3 quality gate:** Lighthouse score on `/` is ≥90 across all four categories.

### Phase 4 — Stop

**Hard stop after Phase 3 ships.** Switch to interview prep, Loom recording, README polish, and the resume update.

---

## 10. Risk register

| ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Tavily quota exhausted before recruiter clicks | Medium | High | Cache aggressively. After Acquisity is researched once, all subsequent clicks hit cache. Add second-tier fallback (DuckDuckGo HTML scrape). |
| R2 | Groq API key leaks in client bundle | Low | Catastrophic | All Claude calls server-side only. Pre-deploy script greps for `ANTHROPIC` in client output. |
| R3 | Streaming feels janky on slow connections | Medium | Medium | Progressive skeletons, never empty spinners. Test on throttled 3G in Chrome DevTools. |
| R4 | Build for 30 hours, ship something half-baked | High | High | Phase 1 hard contract: deploy a working v1 before starting v2. Set a calendar timer. |
| R5 | Coding gap re-emerges as bugs | Medium | Medium | Spend first hour writing one Playwright test. Run it before every PR. |
| R6 | README slips into desperate tone | Medium | Medium | Treat the README as a technical decision log. Read aloud — if any sentence sounds like a sales pitch, delete it. |
| R7 | Agent 2 returns fabricated people | High | Catastrophic | Hard rule in system prompt: real people only. Validate every name against at least one source URL before showing. |
| R8 | "Run on Acquisity" returns embarrassing output | High | High | Test on Acquisity in development before deploying. If output is bad, iterate prompts before shipping the public link. |
| R9 | Free-tier quotas (Groq 14.4k/day, Gemini 1.5k/day, OpenRouter ~50/day) all exhausted simultaneously | Low | Medium | Three-provider fallback chain keeps the demo running until at least one tier remains. Rate limit by IP from Phase 1. If all three tiers go red, app shows "demo capacity reached. Try again in an hour." rather than erroring. No paid provider is added — free-tier resilience is part of the demo's value proposition. |
| R10 | Domain `outbound-lab.vercel.app` not memorable | Low | Low | Acceptable for v1. Buy `outbound-lab.com` ($12) only if the project keeps gaining traction. |

---

## 11. Quality bar — the stoplight

If ANY of these are red, do not link to it yet:

- [ ] Loads in under 2.5s on mobile (test on actual phone, not laptop simulation)
- [ ] Works on first try in incognito window from a fresh device
- [ ] Has favicon, OG image, real `<title>`, real meta description
- [ ] Mobile-responsive — no horizontal scroll, no broken touch targets
- [ ] At least one graceful error state (bad URL, rate-limited, model error)
- [ ] No console errors in production
- [ ] No `console.log` in production code (lint rule)
- [ ] No leaked API keys (grep production bundle for `ANTHROPIC`, `OPENAI`, `SUPABASE_SERVICE`)
- [ ] No dead links anywhere
- [ ] Domain doesn't say `localhost:3000` in any screenshot or social share
- [ ] README under 200 lines, with: what / why / stack / decision log / how to run locally
- [ ] GitHub repo public, with at least 30 atomic gitmoji commits — never a single 4000-line "init"
- [ ] No AI attribution anywhere in the repo (commits, PRs, README)
- [ ] Run on Acquisity returns output Samuel would actually send to Tasnim

---

## 12. Success criteria (how we know it worked)

| Metric | Target |
|---|---|
| Tasnim accepts LinkedIn connection | Within 48 hours |
| Tasnim or someone at Acquisity opens the live demo | Within 7 days (track via Vercel Analytics) |
| Technical conversation invite | Within 14 days |
| Project receives positive reaction in interview | "We saw your demo" mentioned unprompted |
| Project survives the application | Stays in portfolio, listed on resume, gets updated periodically |

If we hit (1), (2), and (3), the project worked.

---

## 13. What happens after the application

This project is **not throwaway**. Roadmap if Acquisity does not move forward:

- **For PostHog application:** repurpose with PostHog instrumentation
- **For Pearl Talent Step 5:** demo as portfolio
- **For future product engineer roles:** the canonical demo
- **As a product:** if it gets traction, expand to a free tool with paid tiers

---

## 14. Approval gate

**Read this brief end-to-end. If you approve, the bootstrap kit is ready to drop into a new repo and start building tonight.**

If anything in here is wrong — name, scope, agent design, stack, phases — fix it here first. Do not let downstream docs drift from this brief.

— End of Planning Brief —

---

## STACK LOCK — 2026-05-02 update (Path B: Free-Tier)

The LLM stack is **fully free-tier** by design. This is the official cost budget and provider chain:

### Cost budget
| Item | Monthly cost |
|---|---|
| LLM inference (Groq + Gemini + OpenRouter) | **$0** |
| Embeddings (Gemini `text-embedding-004`, Phase 2) | **$0** |
| Search (Tavily, 1k/mo free) | **$0** |
| Database (Supabase free tier) | **$0** |
| Hosting (Vercel Hobby) | **$0** |
| Monitoring (Sentry free) | **$0** |
| **TOTAL** | **$0/month** |

### Provider chain (`src/lib/agents/llm/chat.ts`)
1. **Groq** `llama-3.3-70b-versatile` — primary, ~500 tok/s, 14,400 req/day
2. **Gemini** `gemini-2.5-flash` — fallback, 1,500 req/day
3. **OpenRouter** `meta-llama/llama-3.3-70b-instruct:free` — last resort

### The interview narrative
> "I built it on a fully free-tier provider chain — Groq Llama 3.3 70B primary, Gemini 2.5 Flash fallback, OpenRouter as last resort. It's $0/month, handles thousands of demos per day, and the fallback chain means if Groq has an incident the demo doesn't go down. The same pattern would work in production with paid tiers as the primary — the abstraction is provider-agnostic."

### New supporting docs (added in this update)
- `.ai/design/brand-decision-2026-05.md` — full visual identity, palette, typography, voice
- `.ai/docs/12-ux-flows.md` — every screen, state, and animation specified
- `.ai/design/preview/wordmark.svg`, `favicon.svg`, `og-image.svg` — brand assets

### Branding TL;DR
- **Aesthetic:** dark-default, electric blue + cyan gradient accent, Geist Sans typography
- **Reference bar:** Linear, Vercel, Cursor, Anthropic — not generic SaaS dashboards
- **Logo:** `●  OutboundLab` — gradient dot + Geist Sans Medium wordmark
- **Voice:** precise, confident, quiet — never marketing-speak

