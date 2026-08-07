# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Source: Management API live check + local `supabase/migrations/`
- CLI note: `supabase db dump --linked` failed with `cli_login_postgres` permission denied; use migration files as source of truth.

## Live: `public.notion_connections`

Verified present. Columns:

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
- `created_at` — timestamptz (nullable=NO)
- `updated_at` — timestamptz (nullable=NO)

RLS enabled with no authenticated policies (service-role access only).

## Migration files

- `supabase/migrations/20251204120000_create_panel_edges.sql`
- `supabase/migrations/20251214152553_add_project_tabs_more_menu.sql`
- `supabase/migrations/20251228200000_create_canvas_nodes_table.sql`
- `supabase/migrations/20260806200000_create_notion_connections.sql`
