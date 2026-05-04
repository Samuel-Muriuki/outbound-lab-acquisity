# OutboundLab — Build Plan

**Read this in order. Execute one phase at a time. Do NOT skip ahead.**

This is the file you open in Claude Code each day. Each section is a self-contained prompt you paste to start a session.

---

## Pre-flight (do once, ~30 minutes)

Before any code:

1. **Sign up for accounts** (all free — no payment method required):
   - Groq (https://console.groq.com) → primary LLM, 14,400 req/day free
   - Google AI Studio (https://aistudio.google.com/app/apikey) → Gemini fallback + embeddings, 1,500 req/day free
   - OpenRouter (https://openrouter.ai) → last-resort fallback, ~50 req/day free
   - Tavily (https://tavily.com) → search tool, 1k/mo free
   - Supabase (https://supabase.com) → create project in **Singapore** region, get URL + anon key + service-role key
   - GitHub → ensure `gh` is logged in (`gh auth status`)
   - Vercel → connect to GitHub (deferred until end of Session 1)
   - Sentry (defer to Phase 3)
   - Upstash (defer to Phase 3)

   At least one of GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY must be
   set; all three is recommended for resilience. No paid LLM provider — that's
   part of the demo's value proposition.

2. **Run the bootstrap script** from repo root:
   ```bash
   bash bootstrap.sh
   ```

3. **Copy `.env.example` → `.env.local`** and fill in real keys.

4. **Verify the empty Vercel deploy works**: push to GitHub, watch the deploy, open the URL. You should see the default Next.js page.

5. **Read `PLANNING-BRIEF.md` end to end.** This is non-negotiable.

---

## SESSION 1 — Foundation (target: 2–3 hours)

**Prompt to start the session in Claude Code:**

```
We're building OutboundLab. Read these files first, in order:

1. PLANNING-BRIEF.md (master spec)
2. .claude/INSTRUCTIONS.md (how we work)
3. .claude/memory/MEMORY.md (project memory)
4. .ai/docs/01-product-overview.md
5. .ai/docs/02-tech-stack.md
6. .ai/docs/06-agent-system-design.md
7. BUILD-PLAN.md (this file)

Today's session is SESSION 1 — Foundation. Your goal is to land 4 PRs:

PR 1: 🔧 build(scaffold): Next.js 15 + TypeScript strict + Tailwind + shadcn/ui
- Initialize Next.js 15 with App Router, TypeScript strict, Tailwind
- Install shadcn/ui (theme: zinc, dark default)
- Add: Button, Input, Card, Badge, Tooltip, Dialog primitives
- Verify `pnpm dev` shows a working shadcn Button

PR 2: 📝 docs(env): complete .env.example with all required keys
- Match the schema in PLANNING-BRIEF.md section 5.1
- Add comments linking to each service's dashboard

PR 3: 🗃️ db(schema): initial migration — research_runs, research_messages, research_embeddings, rate_limits
- Use the exact SQL from .ai/docs/04-database-schema.md
- Apply via Supabase migration tool — confirm with me before running

PR 4: 🎨 ui(theme): design tokens and base layout
- Implement tokens from .ai/docs/07-theme-system.md
- Set up RootLayout with next-themes (dark default)
- Add fonts via next/font

Atomic commits within each PR. Branch from develop. Merge with --merge, never --squash. No AI attribution anywhere.

After PR 4 lands, update .ai/assessments/PROJECT_STATUS.md to "Foundation: 100%, Phase 1: 25%". End session by writing today's session notes.
```

---

## SESSION 2 — Landing page + URL input (target: 2 hours)

**Prompt:**

```
We're continuing OutboundLab — SESSION 2: Landing page and input.

Files to read first:
- PLANNING-BRIEF.md sections 4.2 and 4.3 (hero design)
- .ai/docs/06-agent-system-design.md section 8.1 (input validation)
- .ai/docs/08-page-structure.md

PRs for this session:

PR 5: ✨ feat(landing): hero section with URL input
- /src/app/page.tsx — full landing page
- Hero copy from PLANNING-BRIEF section 4.2
- URL input with shadcn Input + Button
- Client component with useState for input value
- Validation: zod URL schema, show inline error
- Mobile responsive (test in Chrome DevTools at 375px width)

PR 6: ✨ feat(landing): "Run on Acquisity" preset button
- Below the input, a secondary action: "Try it on Acquisity"
- Pre-fills the input with https://acquisity.com when clicked
- Smaller button, ghost variant

PR 7: ✨ feat(api): research route handler with input validation
- /src/app/api/research/route.ts
- POST: { url: string } — validate, return { run_id }
- For now, just create a research_runs row and return the id
- Use Supabase service role from server only

PR 8: ✨ feat(landing): wire input to navigate to /research/[id]
- On submit, POST to /api/research, then router.push(/research/${run_id})
- Show loading state during the POST

After PR 8: visit production URL → submit acquisity.com → land on /research/[id] page (which is empty for now). Test on real phone, not just laptop. Update PROJECT_STATUS to "Phase 1: 40%". Write session notes.
```

---

## SESSION 3 — Agent 1 + Tools (target: 3 hours)

**Prompt:**

```
SESSION 3: Implement Agent 1 (Reconnaissance) end-to-end.

Files to read:
- .ai/docs/06-agent-system-design.md sections 4 and 11 (agent design + tests)

PRs:

PR 9: ✨ feat(agents): web_search tool with Tavily integration
- /src/lib/agents/tools/web-search.ts
- Use exact code from agent-system-design.md section 4.4
- Add unit test in /tests/tools/web-search.test.ts (mock fetch)

PR 10: ✨ feat(agents): web_fetch tool with SSRF guards
- /src/lib/agents/tools/web-fetch.ts
- Block localhost, 127.x, 0.0.0.0
- Strip HTML to plain text, cap at 4000 chars

PR 11: ✨ feat(agents): Reconnaissance agent with tool-use loop
- /src/lib/agents/agent-1-reconnaissance.ts
- /src/lib/agents/prompts/reconnaissance.ts (prompts as constants)
- /src/lib/agents/schemas.ts (Zod ReconnaissanceOutput)
- Use exact code from section 4.5
- Unit test: mock the chat() provider layer, verify Zod validation works on agent output

PR 12: 🧪 test(agents): integration test for Agent 1 against acquisity.com
- /tests/integration/agent-1.test.ts
- Calls real Groq API (skipped on CI)
- Asserts Zod-valid output for acquisity.com input

After PR 12: run the integration test locally. The agent must return a valid ReconnaissanceOutput for acquisity.com. If it doesn't, iterate the prompt before proceeding. PR 12 SHIPS only after the agent works. Update PROJECT_STATUS to "Phase 1: 60%".
```

---

## SESSION 4 — Agents 2 & 3 + Orchestrator (target: 3 hours)

**Prompt:**

```
SESSION 4: Agents 2 and 3, plus the orchestrator.

Files to read:
- .ai/docs/06-agent-system-design.md sections 5, 6, 2 (agents + orchestration)

PRs:

PR 13: ✨ feat(agents): People & ICP agent
- /src/lib/agents/agent-2-people.ts
- /src/lib/agents/prompts/people.ts
- Tool: web_search only
- Post-validation: drop names not appearing on source page

PR 14: ✨ feat(agents): Personalisation agent (no tools)
- /src/lib/agents/agent-3-email.ts
- /src/lib/agents/prompts/email.ts
- Forbidden phrase check, retry once if violated

PR 15: ✨ feat(orchestrator): sequential agent execution with persistence
- /src/lib/agents/orchestrator.ts
- AsyncIterable yielding StreamEvents
- Writes to research_messages on every step

PR 16: ✨ feat(api): SSE streaming on /api/research/[id]/stream
- New route handler GET /api/research/[id]/stream
- Streams orchestrator events as SSE
- On completion, persists final result to research_runs.result

After PR 16: visit production URL, submit acquisity.com, watch the network tab — you should see SSE events streaming. Frontend doesn't render them yet, that's session 5. Update PROJECT_STATUS to "Phase 1: 80%".
```

---

## SESSION 5 — Streaming UI + Results card (target: 2.5 hours)

**Prompt:**

```
SESSION 5: The UI that wins the job.

Files to read:
- PLANNING-BRIEF.md section 4.3 (streaming view design)
- PLANNING-BRIEF.md section 4.4 (results card)
- .ai/docs/07-theme-system.md
- .ai/docs/08-page-structure.md

PRs:

PR 17: ✨ feat(streaming): EventSource hook + agent timeline component
- /src/components/AgentTimeline.tsx — renders agent_start, tool_call, tool_result, agent_done events
- /src/hooks/useResearchStream.ts — wraps EventSource, returns events array

PR 18: ✨ feat(results): result card with company brief, decision makers, email
- /src/components/ResultCard.tsx — final structured output rendering
- Tabs: Brief | People | Email | Sources
- Copy-to-clipboard button on email body

PR 19: 🎨 ui(streaming): skeleton states and progress indicators
- Each agent shows a pulsing skeleton while running
- Tool calls expand to show input/output (collapsed by default)
- Smooth transitions, no jarring flashes

PR 20: ♿️ a11y: keyboard navigation and ARIA roles on streaming view
- All interactive elements keyboard-accessible
- Live regions for stream updates
- Reduced-motion support

After PR 20: production end-to-end test. Submit acquisity.com, watch the agents stream, verify the result card renders correctly. SCREENSHOT THE RESULT — you'll need it for the resume. PROJECT_STATUS = "Phase 1: 100%".
```

---

## ✅ PHASE 1 GATE — Ship the demo

Before starting Phase 2:

1. Run Playwright spec on production: `pnpm test:e2e -- --grep "@phase1"`
2. Manual checklist (PLANNING-BRIEF section 11):
   - [ ] Loads in <2.5s on mobile (real device, not laptop)
   - [ ] Works on first try in incognito
   - [ ] No console errors in production
   - [ ] No leaked secrets in bundle: `grep -r "ANTHROPIC\|OPENAI_API\|SUPABASE_SERVICE" .next/static`
   - [ ] OG image, favicon, real `<title>`
   - [ ] README v1 written
3. Test "Run on Acquisity" 5 times. Output should be:
   - Genuinely useful (not generic)
   - No fabricated people
   - Email Samuel would actually send

If all green: send LinkedIn message to Tasnim with the live link. Phase 2 starts the next day.

---

## SESSION 6 — Vercel AI SDK migration (Phase 2, target: 3 hours)

**Prompt:**

```
SESSION 6: Migrate from raw provider SDKs (openai for Groq + OpenRouter, @google/generative-ai for Gemini) to Vercel AI SDK. Acquisity's job description explicitly lists Vercel AI SDK — this is a high-value signal. The provider chain order (Groq → Gemini → OpenRouter) is preserved through Vercel AI SDK's `@ai-sdk/*` providers.

Files to read:
- .ai/docs/06-agent-system-design.md section 10 (migration plan)

One agent per PR (3 PRs total):

PR 21: ♻️ refactor(agents): migrate Agent 1 to Vercel AI SDK
- Replace raw `openai` + `@google/generative-ai` calls with `streamText` + `tool` from `ai`
- Use `@ai-sdk/groq` (primary), `@ai-sdk/google` (fallback), `@ai-sdk/openrouter` (last resort)
- Provider order locked: Groq → Gemini → OpenRouter
- Schemas and prompts unchanged
- Existing tests should still pass

PR 22: ♻️ refactor(agents): migrate Agent 2 to Vercel AI SDK

PR 23: ♻️ refactor(agents): migrate Agent 3 to Vercel AI SDK

After PR 23: all 3 agents use Vercel AI SDK. The streaming protocol now uses the SDK's native `fullStream` rather than custom SSE. UI may need minor adjustments for new event shapes — handle in PR 24 if needed.

PROJECT_STATUS = "Phase 2: 30%".
```

---

## SESSION 7 — pgvector cache (target: 2 hours)

**Prompt:**

```
SESSION 7: pgvector caching — the "Run on Acquisity" smoothness layer.

Files to read:
- .ai/docs/04-database-schema.md (research_embeddings table)
- .ai/docs/06-agent-system-design.md section 7 (caching strategy)

PRs:

PR 24: ✨ feat(cache): exact-domain match within 7 days
- Before orchestrator runs: query research_runs where target_domain = ? and completed_at > now() - 7d
- If hit: emit cache_hit event, return cached result, return early

PR 25: ✨ feat(cache): embed and persist on completion
- On run completion: generate embedding via Gemini text-embedding-004
- Insert into research_embeddings with HNSW index

PR 26: 🎨 ui(cache): "served from cache" badge on result card
- Show cache age ("3 days ago")
- "Re-run fresh →" button forces cache: false

After PR 26: click "Run on Acquisity" twice. Second click should be near-instant. PROJECT_STATUS = "Phase 2: 70%".
```

---

## SESSION 8 — Tool-call UI + Past runs gallery (target: 2.5 hours)

**Prompt:**

```
SESSION 8: Polish the streaming view + add /runs page.

PRs:

PR 27: 🎨 ui(streaming): expandable tool-call cards
- Each tool_call event renders as a collapsible card
- Shows input (formatted JSON) and result_summary
- Click to expand for full result text
- Inspired by Cursor's agent panel

PR 28: ✨ feat(runs): /runs page with last 10 public runs
- Grid of result cards
- Click to view full run at /research/[id]
- Anonymous (no user info)

PR 29: 🎨 ui(landing): "Recent runs" preview on landing page
- Below the input, show 3 most recent successful runs
- Each is a small card with company name + one-liner

PR 30: 🎨 ui(theme): final visual polish pass
- Spacing, font weights, hover states, focus rings
- Verify against .ai/docs/07-theme-system.md

PROJECT_STATUS = "Phase 2: 100%".
```

---

## ✅ PHASE 2 GATE

- [ ] Cache hit on Acquisity is <300ms after first run
- [ ] Tool-call UI expands and shows useful info
- [ ] /runs page loads and shows real runs
- [ ] All Phase 1 quality bars still hold

---

## SESSION 9 — tRPC migration (Phase 3, target: 3 hours)

**Prompt:**

```
SESSION 9: tRPC v11 migration — Acquisity's stack, type-safe end-to-end.

Files to read:
- .ai/docs/06-agent-system-design.md section 10 (tRPC migration)

PRs:

PR 31: 🔧 build(trpc): scaffold tRPC v11 + react-query
- /src/server/trpc.ts (init)
- /src/server/routers/_app.ts (root router)
- /src/lib/trpc/client.tsx (client wrapper)
- Provider in RootLayout

PR 32: ♻️ refactor(api): migrate /api/research POST to research.start mutation

PR 33: ♻️ refactor(api): migrate /api/research/[id]/stream to research.stream subscription

PR 34: 🔥 remove: delete legacy route handlers
- After confirming nothing references them

PROJECT_STATUS = "Phase 3: 30%".
```

---

## SESSION 10 — PWA + rate limiting + Sentry (target: 2.5 hours)

**Prompt:**

```
SESSION 10: Production polish — PWA, rate limit, monitoring.

PRs:

PR 35: 📱 pwa: manifest and service worker
- /public/manifest.json
- next-pwa plugin (or manual SW)
- Verify Lighthouse PWA score ≥90

PR 36: 🔒️ security: rate limiting (10 runs per IP per day)
- Use Postgres rate_limits table OR Upstash Redis
- Reject with 429 + clear error message
- Show "Daily limit reached. Try again tomorrow." in UI

PR 37: 👷 ci(sentry): Sentry integration
- @sentry/nextjs
- Capture errors from orchestrator
- Redact secrets before sending

PR 38: 🔧 build(analytics): Vercel Web Analytics
- @vercel/analytics
- Track pageviews and "Research" button clicks

PROJECT_STATUS = "Phase 3: 80%".
```

---

## SESSION 11 — README v2 + Loom + final QA (target: 3 hours)

**Prompt:**

```
SESSION 11: The finish line.

PRs:

PR 39: 📝 docs(readme): comprehensive README with architecture diagram
- Hero: "OutboundLab — multi-agent B2B research, on demand."
- Live link, GitHub link, screenshot
- "Why this exists" section (one paragraph)
- Stack table (one line per layer with rationale)
- Architecture diagram (mermaid or PNG)
- Decision log (5-7 key decisions with rationale)
- "Run locally" section
- License: MIT

PR 40: 🎨 ui(landing): embed Loom video
- After Loom is recorded, embed on landing page below the hero
- Lazy-load to keep page fast

PR 41: 📝 docs(security): SECURITY.md
- How to report a vulnerability
- What's in scope, what's out

PR 42: 🚀 deploy(prod): final production checklist
- Run full quality gate (PLANNING-BRIEF section 11)
- Verify Lighthouse scores
- Test on 3 real devices

PROJECT_STATUS = "Phase 3: 100%". 🎉
```

---

## ✅ PHASE 3 GATE — Stop and ship

When all of these are green:

- [ ] Lighthouse: Performance ≥90, Accessibility ≥95, Best Practices ≥95, SEO ≥95
- [ ] PWA installable
- [ ] Rate limit working (test by spamming)
- [ ] Sentry receiving real events
- [ ] README has architecture diagram
- [ ] Loom video embedded and working

**STOP CODING.** Switch to:

1. Re-record Loom if needed
2. Update resume with the bullet
3. Update LinkedIn message to Tasnim with the live link
4. Send the message
5. Submit (or re-submit) Workable form with the link
6. Switch to interview prep

---

## SESSION 12+ — Maintenance only

If recruiter responds: spend time on interview prep, not on Phase 4 features.

If no response by day 14: send polite follow-up DM. Continue applying to other roles. Do not over-invest in this single project past Phase 3.

---

*This build plan is the only plan. If you find yourself building something not in this file, stop and update this file first.*

---

## Session 1 supplement — Brand + UX setup (run BEFORE writing any feature code)

After scaffolding the Next.js app but before building any feature, prime Claude Code with the design system. These prompts are short and load the brand identity into memory before component work begins.

### Prompt 1.6 — Read the brand decision file

```
@.ai/design/brand-decision-2026-05.md @.ai/docs/07-theme-system.md @.ai/docs/12-ux-flows.md

Read all three files end-to-end. They are the authoritative source for OutboundLab's visual identity, theme tokens, and UX flows. Confirm you understand:

1. The dark-default aesthetic and reference bar (Linear, Vercel, Cursor, Anthropic)
2. The exact color tokens (zinc-950 bg, blue/cyan gradient brand, three agent colors)
3. The Geist Sans + Geist Mono typography
4. The logo: gradient dot + "OutboundLab" wordmark
5. The 11 UX flows and the 30-second recruiter test in 12-ux-flows.md
6. The voice/tone rules (no marketing-speak, no emoji in UI strings)

Reply with a one-paragraph summary so I can verify alignment before we start building.
```

### Prompt 1.7 — Install Geist + theme tokens

```
Set up the typography and theme system per .ai/docs/07-theme-system.md:

1. pnpm add geist
2. Update app/layout.tsx to import GeistSans and GeistMono with the variable names shown in section 3 of the theme doc
3. Replace app/globals.css with the full content from section 2 of the theme doc — the @theme inline block, dark/light variables, gradient utility classes, agent-glow classes, pulse-agent keyframe, and prefers-reduced-motion media query

Verify with: pnpm dev → check the page background is true zinc-950 (#09090B), and the body font is Geist Sans (look at the lowercase "a" — distinctive cut).
```

### Prompt 1.8 — Install brand assets

```
Copy the brand assets from .ai/design/preview/ to the public app:

1. Copy .ai/design/preview/wordmark.svg to public/logo.svg
2. Copy .ai/design/preview/favicon.svg to app/icon.svg
3. Copy .ai/design/preview/og-image.svg to public/og-image.svg
4. Update app/layout.tsx metadata to reference these (title: "OutboundLab — Multi-agent B2B research", description: "Paste any company URL. Get a personalised outreach package in under a minute.", openGraph.images: ["/og-image.svg"])

Confirm the favicon renders by opening localhost:3000 and checking the browser tab.
```

After these three prompts run, the visual foundation is locked and every subsequent component can reference theme tokens by name. Now you can run the original Session 1 → 11 feature prompts.

