-- Move the `vector` extension out of the `public` schema and into a
-- dedicated `extensions` schema. Addresses Supabase advisor lint 0014
-- (`extension_in_public`) — extensions in `public` get tangled with
-- application objects and pollute autocomplete / dump output.
--
-- Safe migration: ALTER EXTENSION ... SET SCHEMA preserves all existing
-- column types and indexes (Postgres tracks dependencies by OID, not by
-- schema-qualified name). The `vector(768)` column on
-- `research_embeddings` and the HNSW index on it continue to work
-- unchanged.

-- 1. Ensure the dedicated schema exists.
CREATE SCHEMA IF NOT EXISTS extensions;

-- 2. Move the extension.
ALTER EXTENSION vector SET SCHEMA extensions;

-- 3. Make sure the service_role and authenticated roles can still see
--    the extension's types when querying.
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
