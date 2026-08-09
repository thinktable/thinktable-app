# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-09T05:41:10Z`
- Source: local `supabase/migrations/` + `.temp` service versions (linked project)
- CLI note: `supabase db dump --linked` failed without `SUPABASE_DB_PASSWORD` (cli_login_postgres permission). Access token works for `projects list` + Management SQL API; migration files remain source of truth.
- Service versions (from `supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.195.0`, rest `v13.0.5`, storage `v1.68.1`

## This save

- No DDL. Marker `20260809054110_empty_block_backspace.sql`.
- App: empty TipTap block Backspace deletes that block only (not the frame) and moves the I-bar to the previous line; fresh frame sole empty block is a no-op; RF `deleteKeyCode` is Delete-only; ProseMirror/`pageLink` use `nokey` so RF does not steal Backspace while typing.
- Schema unchanged.

## Prior: `panel_edges.metadata`

- Migration: `20260808160000_panel_edges_thread_metadata.sql` (applied + registered remotely)
- Column: `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` — thread path points / dotted / algorithm
- RLS: `Users can update their own edges` (UPDATE) for reconnect + path persist

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

## Prior saves

- Marker: `20260809053310_page_open_menu_frame_clamp.sql` (page open menu clamp).
- Marker: `20260809011319_thread_style_smooth_sharp_linear.sql` (thread styles).
- Marker: `20260808192038_page_links_title_ui_preview_menu.sql` (pageLink block feature).
