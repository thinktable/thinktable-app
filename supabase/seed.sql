-- Local-dev seed: role grants for the local Supabase stack.
-- Why: the repo migrations never GRANT table privileges to the PostgREST roles
-- (the remote project has them from historical setup that predates these migrations).
-- On a clean local DB, PostgREST connects as `anon`/`authenticated` and gets
-- "permission denied" until these grants exist. Row-Level Security still governs
-- which rows each role can see; these grants only open the tables to the roles.
-- seed.sql runs after migrations on `supabase db reset`/`start` and is NOT applied
-- to remote by `supabase db push`, so it is a safe local-only fix.

-- Schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Existing tables (base schema + all incremental migrations)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Future tables created in public keep the same grants (mirrors Supabase defaults)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
