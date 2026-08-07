# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-07T23:24:50Z`
- Source: local `supabase/migrations/` + `.temp` service versions (linked project)
- CLI note: `supabase db dump --linked` failed without `SUPABASE_DB_PASSWORD` (cli_login_postgres permission). Access token works for `projects list`; migration files remain source of truth.
- Service versions (from `supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.184.0`, rest `v13.0.5`, storage `v1.33.0`

## Live: `public.notion_connections`

Verified previously on project (unchanged this save — no new schema migrations).

Columns:

- `id` — uuid (nullable=NO)
- `user_id` — uuid (nullable=NO)
- `access_token` — text (nullable=NO)
- `refresh_token` — text (nullable=YES)
- `workspace_id` — text (nullable=YES)
- `workspace_name` — text (nullable=YES)
- `workspace_icon` — text (nullable=YES)
- `bot_id` — text (nullable=YES)
- `duplicated_template_id` — text (nullable=YES)
- `owner` — jsonb (nullable=YES)
- `raw_token_response` — jsonb (nullable=YES)
- `created_at` — timestamp with time zone (nullable=NO)
- `updated_at` — timestamp with time zone (nullable=NO)

## Live public tables

- `canvas_nodes`
- `conversations`
- `embeddings`
- `messages`
- `notion_connections`
- `panel_edges`
- `profiles`
- `projects`
- `subscriptions`
- `usage`

## This save

- Marker: `20260807232450_blocks_model_frontend_only.sql`
- App: items → blocks model, TipTap content-block handles / turn-into, block groups, React Flow Pro examples vault under `React Flow copy/`.
- Schema: no DDL; block/group state lives in `messages.metadata` JSON.
