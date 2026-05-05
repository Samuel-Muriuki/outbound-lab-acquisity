-- Add `tone` and `channel` columns so the research-run pipeline can
-- persist the user's tone + outreach-channel choices at POST time, and
-- the SSE stream route can forward both to Agent 3 without round-tripping
-- the values through the client.
--
-- Both default to the existing single-shape behaviour (cold email) so
-- pre-existing rows stay interpretable without a backfill.
ALTER TABLE research_runs
    ADD COLUMN tone TEXT NOT NULL DEFAULT 'cold'
        CHECK (tone IN ('cold', 'warm')),
    ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'
        CHECK (channel IN ('email', 'linkedin', 'x'));
