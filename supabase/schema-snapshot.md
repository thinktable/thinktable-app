# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-09T10:33:53Z`
- Source: local `supabase/migrations/` + `.temp` service versions (linked project)
- CLI note: `supabase db dump --linked` / `projects list` need login token or `SUPABASE_DB_PASSWORD`; migration files remain source of truth.
- Service versions (from `apps/web/supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.184.0`, rest `v13.0.5`, storage `v1.33.0`

## This save

- No DDL. Marker `20260809103353_locked_frame_fit_notion_db_blocks.sql`.
- Locked frame hug: symmetric width — gutter read from the ⋮⋮ handles row (`pm.closest('.relative')`, not the outer `containerRef` → was ~24px too narrow / right-clipped) and right margin mirrors the frame-left→⋮⋮-icon inset; hug HEIGHT to content on lock/relock/type (no longer keeps the taller resize box).
- pageLink open-menu spill clamp scoped to the panel (`panel.contains` the `.overflow-hidden`, else panel) — locked frames were matching the canvas-wide React Flow pane, so the menu escaped the right edge.
- Notion database blocks: `databaseBlock` TipTap atom + NodeView, `migrate-frame` (sole-DB map frame → pageLink), `blocks-to-html` / `import-to-board` updates, Notion mark/color assets, connect/import chrome.
- Schema unchanged.

## Prior: drawable logo personalize / AI badge

- Marker: `20260809084152_logo_draw_personalize_ai_badge.sql`.

## Prior: continuous I-bar typing / empty-frame UX

- Marker: `20260809072420_ibar_typing_empty_frame_ux.sql`.

## Prior: add-block hairline centered

- Marker: `20260809063103_add_block_hairline_centered.sql` — short `w-3` hairline centered with ⋮⋮.

## Prior: between-block insert line

- Marker: `20260809061713_between_block_insert_line.sql` — remove gutter +; grip-width mid-gap hairline.

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

- Marker: `20260809072420_ibar_typing_empty_frame_ux.sql` (I-bar typing / empty-frame UX).
- Marker: `20260809061713_between_block_insert_line.sql` (between-block hairline).
- Marker: `20260809054110_empty_block_backspace.sql` (empty-block Backspace).
- Marker: `20260809053310_page_open_menu_frame_clamp.sql` (page open menu clamp).
- Marker: `20260809011319_thread_style_smooth_sharp_linear.sql` (thread styles).
- Marker: `20260808192038_page_links_title_ui_preview_menu.sql` (pageLink block feature).
