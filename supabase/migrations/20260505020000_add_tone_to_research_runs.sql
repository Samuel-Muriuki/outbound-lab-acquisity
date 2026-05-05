-- Add `tone` column so the research-run pipeline can persist the user's
-- tone choice (cold | warm) at POST time and the SSE stream route can
-- forward it to Agent 3 without round-tripping the value through the
-- client.
--
-- Cold is the default — matches the existing Agent 3 default and keeps
-- pre-existing rows interpretable.
ALTER TABLE research_runs
    ADD COLUMN tone TEXT NOT NULL DEFAULT 'cold'
        CHECK (tone IN ('cold', 'warm'));
