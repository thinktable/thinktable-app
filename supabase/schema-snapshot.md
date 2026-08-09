# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-09T13:05:53Z`
- Source: local `supabase/migrations/` + `.temp` service versions (linked project)
- CLI note: `supabase db dump --linked` / `projects list` need login token or `SUPABASE_DB_PASSWORD`; migration files remain source of truth.
- Service versions (from `apps/web/supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.184.0`, rest `v13.0.5`, storage `v1.33.0`

## This save

- No DDL. Marker `20260809130553_frame_unlock_return_remove_caret.sql`.
- Removed the overflow expand/collapse **caret** (`handleToggleOverflow` / `contentOverflows` / `frameExpanded` gone). New model: **lock = fit-to-content, unlock = your saved shape**.
- **Unlock returns to the saved unlocked shape** via `metadata.unlockedFrameSize {width,height}` + `metadata.unlockedFrameScale`, captured at lock time and refreshed on every unlocked resize-end → reversible even after a locked proportional resize (first-ever unlock falls back to the current box).
- **`metadata.collapsedFrameSize` fully removed** (state, load, all persist keys) — it was a transient pre-expand box for the deleted caret; stale key on old rows is simply ignored (no migration needed).
- Right-click frame menu (`BlockActionsMenu`) gains a **Frame shape automations** beta stub (`frameShapeAutomations`) — closes the menu for now; entry point for saved frame-shape rules later.
- Persisted via existing `messages.metadata` jsonb — schema unchanged.

## Prior: locked wrap column width

- Marker: `20260809123351_locked_wrap_column_width.sql`.

## Prior: locked frame fit / Notion database blocks

- Marker: `20260809103353_locked_frame_fit_notion_db_blocks.sql`.

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
