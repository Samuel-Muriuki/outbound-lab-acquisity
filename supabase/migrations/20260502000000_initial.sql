-- ============================================
-- OutboundLab — Initial Schema
-- ============================================
-- Tables: research_runs, research_embeddings, research_messages, rate_limits
-- RLS: enabled on all tables; public read on research_runs + research_messages;
--      research_embeddings + rate_limits are server-only via service role.
-- Embedding model: Gemini text-embedding-004 (768d, free tier).

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- TABLE: research_runs
-- One row per "Research" click. Status lifecycle: pending → running → done | error | degraded.
-- ============================================
CREATE TABLE research_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url      TEXT NOT NULL,
    target_domain   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'done', 'error', 'degraded')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INT,
    -- Default model reflects the locked free-tier primary (Groq).
    -- Orchestrator overrides per run with the actual provider that served the request
    -- (e.g. 'gemini-2.5-flash' on Groq fallback, 'meta-llama/llama-3.3-70b-instruct:free' on OpenRouter).
    model           TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
    total_tokens    INT,
    total_cost_usd  NUMERIC(10, 6),
    result          JSONB,
    error_message   TEXT,
    cache_hit       BOOLEAN NOT NULL DEFAULT FALSE,
    cache_source_id UUID REFERENCES research_runs(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_runs_target_domain_idx ON research_runs(target_domain);
CREATE INDEX research_runs_status_idx        ON research_runs(status);
CREATE INDEX research_runs_created_at_idx    ON research_runs(created_at DESC);
CREATE INDEX research_runs_completed_at_idx  ON research_runs(completed_at DESC);

-- ============================================
-- TABLE: research_embeddings
-- 768-dim vectors from Gemini text-embedding-004. HNSW index with cosine distance.
-- Phase 2 enables vector-similarity cache lookup; Phase 1 only writes here.
-- ============================================
CREATE TABLE research_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    target_domain   TEXT NOT NULL,
    embedding       vector(768) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_embeddings_run_id_idx ON research_embeddings(run_id);
CREATE INDEX research_embeddings_hnsw_idx
    ON research_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- TABLE: research_messages
-- Per-agent message log. Powers the streaming-view replay and debugging.
-- ============================================
CREATE TABLE research_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    agent_index     INT NOT NULL CHECK (agent_index BETWEEN 1 AND 3),
    agent_name      TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content         JSONB NOT NULL,
    tokens_in       INT,
    tokens_out      INT,
    duration_ms     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX research_messages_run_id_idx     ON research_messages(run_id);
CREATE INDEX research_messages_created_at_idx ON research_messages(created_at);

-- ============================================
-- TABLE: rate_limits
-- Phase 3 IP-based rate limiter (10 runs / IP / day). Postgres path; Upstash Redis is the alternative.
-- ============================================
CREATE TABLE rate_limits (
    ip              TEXT NOT NULL,
    day             DATE NOT NULL,
    request_count   INT NOT NULL DEFAULT 1,
    PRIMARY KEY (ip, day)
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE research_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits         ENABLE ROW LEVEL SECURITY;

-- research_runs: public read, no public write (server writes via service role)
CREATE POLICY research_runs_public_read
    ON research_runs FOR SELECT USING (true);

-- research_messages: public read for transparency (streaming view replays)
CREATE POLICY research_messages_public_read
    ON research_messages FOR SELECT USING (true);

-- research_embeddings + rate_limits: server-only. No public policies — RLS deny-by-default.
