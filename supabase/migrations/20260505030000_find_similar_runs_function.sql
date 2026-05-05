-- ============================================
-- find_similar_runs RPC
-- ============================================
-- Returns the top-N completed runs whose recon-brief embedding is
-- closest (cosine-distance) to the source run's embedding, excluding
-- the source run's own domain (so visitors see *related* companies,
-- not duplicates of the same one).
--
-- Powers the "Related research" panel on /research/[id]. SECURITY
-- DEFINER lets the anon client call the function while still gating
-- which rows it can see — the function itself only ever joins against
-- research_runs (which already has a public read policy) and
-- research_embeddings (server-only — but we expose only the distance,
-- never the vector).

CREATE OR REPLACE FUNCTION find_similar_runs(
    p_run_id    UUID,
    p_limit     INT DEFAULT 3
)
RETURNS TABLE (
    id              UUID,
    target_domain   TEXT,
    target_url      TEXT,
    completed_at    TIMESTAMPTZ,
    company_name    TEXT,
    one_liner       TEXT,
    distance        FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    source_embedding extensions.vector(768);
    source_domain    TEXT;
BEGIN
    SELECT e.embedding, r.target_domain
        INTO source_embedding, source_domain
    FROM research_embeddings e
    JOIN research_runs r ON r.id = e.run_id
    WHERE e.run_id = p_run_id
    LIMIT 1;

    IF source_embedding IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.target_domain,
        r.target_url,
        r.completed_at,
        (r.result->'recon'->>'company_name')::TEXT AS company_name,
        (r.result->'recon'->>'one_liner')::TEXT   AS one_liner,
        (e.embedding <=> source_embedding)::FLOAT  AS distance
    FROM research_embeddings e
    JOIN research_runs r ON r.id = e.run_id
    WHERE e.run_id <> p_run_id
      AND r.target_domain <> source_domain
      AND r.status IN ('done', 'degraded')
      AND r.result IS NOT NULL
    ORDER BY e.embedding <=> source_embedding ASC
    LIMIT p_limit;
END;
$$;

-- Allow anon + authenticated to call (function is SECURITY DEFINER so
-- it executes with the owner's privileges, regardless of caller RLS).
GRANT EXECUTE ON FUNCTION find_similar_runs(UUID, INT) TO anon, authenticated, service_role;
