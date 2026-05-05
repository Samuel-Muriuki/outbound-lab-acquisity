-- Add cookie-derived session id to research_runs so users can delete
-- their own runs without needing to log in.
--
-- The cookie is set on first POST /api/research and stored on the row.
-- The DELETE /api/research/[id] handler compares the request cookie
-- against this column; only matching sessions can delete.
--
-- Existing rows have NULL creator_session_id (they predate this feature)
-- and therefore cannot be deleted by anyone via the public flow — that's
-- intentional. Server-side scripts can still purge if needed.

ALTER TABLE public.research_runs
  ADD COLUMN IF NOT EXISTS creator_session_id text;

-- Partial index keeps it cheap — only the rows with a session id are
-- relevant to ownership checks. Existing/null rows aren't indexed.
CREATE INDEX IF NOT EXISTS research_runs_creator_session_id_idx
  ON public.research_runs (creator_session_id)
  WHERE creator_session_id IS NOT NULL;
