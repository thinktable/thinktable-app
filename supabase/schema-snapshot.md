# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-07T05:28:08Z`
- Source: Management API live check + local `supabase/migrations/`
- CLI note: `supabase db dump --linked` failed with `cli_login_postgres` permission denied; use migration files as source of truth.

## Live: `public.notion_connections`

Verified: `notion_connections`

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
- `user_preferences`

## Local migration files

- `supabase/migrations/20251203111351_schema_documentation.md`
- `supabase/migrations/20251204120000_create_panel_edges.sql`
- `supabase/migrations/20251204120000_schema_snapshot.md`
- `supabase/migrations/20251214152553_add_project_tabs_more_menu.sql`
- `supabase/migrations/20251224163818_schema_snapshot.sql`
- `supabase/migrations/20251224180000_add_flashcard_tag_button.md`
- `supabase/migrations/20251228200000_create_canvas_nodes_table.sql`
- `supabase/migrations/20251230235042_save_current_state.sql`
- `supabase/migrations/20251231001007_save_current_state.sql`
- `supabase/migrations/20251231004542_nodetoolbar_frontend_only.sql`
- `supabase/migrations/20251231005556_toolbar_map_object_fix.sql`
- `supabase/migrations/20251231093255_padding_standardization.sql`
- `supabase/migrations/20260102220857_selection_clear_fix.sql`
- `supabase/migrations/20260102224915_auto_focus_flashcard.sql`
- `supabase/migrations/20260103013031_panel_selection_fix.sql`
- `supabase/migrations/20260103020000_resize_persistence_metadata.md`
- `supabase/migrations/20260806200000_create_notion_connections.sql`
