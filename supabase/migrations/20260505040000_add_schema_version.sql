-- ============================================
-- Add schema_version to research_runs
-- ============================================
-- Durable cache invalidation. Whenever Agent 1 / Agent 2 / Agent 3
-- prompts or validators change in a way that should make prior cached
-- runs untrustworthy, bump the SCHEMA_VERSION constant in code. The
-- cache lookup query filters on schema_version = CURRENT, so older
-- rows are silently ignored — no manual DELETE needed, no operator
-- intervention.
--
-- Default 1 for the existing rows. The TS-side bump after each
-- meaningful agent change increments this so every prior run is
-- invalidated (and a fresh one with the new logic is computed on
-- next visit).

ALTER TABLE research_runs
    ADD COLUMN schema_version INT NOT NULL DEFAULT 1;

CREATE INDEX research_runs_schema_version_idx
    ON research_runs(schema_version);
