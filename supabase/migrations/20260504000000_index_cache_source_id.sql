-- ============================================
-- Add covering index for research_runs.cache_source_id FK
-- ============================================
-- Addresses Supabase performance advisor lint 0001 (unindexed_foreign_keys).
-- Without this index, cascade-style queries on cache_source_id (e.g. "find
-- all runs that re-served this cached source") trigger a sequential scan.

CREATE INDEX IF NOT EXISTS research_runs_cache_source_id_idx
    ON research_runs(cache_source_id);
