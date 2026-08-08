# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-08T19:20:38Z`
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

- Marker: `20260808192038_page_links_title_ui_preview_menu.sql`
- App: pageLink block feature — new TipTap `pageLink` node (inline + title variants) + React NodeView + `PageLinkProvider` bridge (`lib/tiptap/page-link.ts`, `components/page-link-view.tsx`, `lib/page-link-context.tsx`); any block/frame → linked child page (`lib/tiptap/page-blocks.ts`, `lib/blocks/turn-into.ts`). Title UI: icon left of an underlined title; single-click places the caret to edit (no accidental open) and hides the open-page menu while editing; the semi-transparent icon-only preview menu ([preview] + [↗ open full page]) slides just right of the title when the frame has room, else overlaps. Multi-block ⋮⋮ selection + "+" add-below (`components/tiptap-block-handles.tsx`, `lib/tiptap/block-selection.ts`). Snapshot-to-page (`lib/blocks/snapshot.ts`). Stability: chat-panel content sync via `doc.eq()` (pageLink loop fix) + stable RF keycode consts; dev-only `[LOOP-DIAG]` render-storm detector in `board-flow.tsx`.
- Schema: no DDL (child pages reuse `conversations`; block/page state in `messages.metadata`).
