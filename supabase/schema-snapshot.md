# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-09T19:44:48Z`
- Source: local `supabase/migrations/` + `.temp` service versions (linked project)
- CLI note: `supabase db dump --linked` / `projects list` need login token or `SUPABASE_DB_PASSWORD`; migration files remain source of truth.
- Service versions (from `apps/web/supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.184.0`, rest `v13.0.5`, storage `v1.33.0`
- CLI: `supabase` `2.90.0` (remote `projects list` needs login token — marker migration used)

## This save

- No DDL. Marker `20260809194448_notion_mindmap_structured_database.sql`.
- **Generate mindmap**: walk Notion `child_page` + `child_database` (incl. under headings); resolve `block_id` parents; parent→child `panel_edges` threads; pages → title `pageLink` + Pages menu nesting; databases → one map `databaseBlock` with live Notion-like table (`/api/notion/database/[id]`, property columns + typed cells) — not one frame per row.
- **Open menu**: Preview/Open/Notion on pageLink + DB title; DB frames skip sole-`databaseBlock`→pageLink migration when `notionObject=database`.
- Persisted via existing tables — schema unchanged.

## Prior: thread actions menu + sidebar pin

- No DDL. Marker `20260809190614_thread_actions_menu_sidebar_pin.sql`.
- **Thread click menu** (`thread-actions-menu.tsx` + `board-flow` `onEdgeClick`): Notion-style chrome matching ⋮⋮ / text-select menus; wired Delete, Insert frame, Collapse/Expand, Dotted/Solid, Arrange→Smooth/Sharp/Linear, Copy/Paste style; other rows stubs.
- **Pages nav pin** (`sidebar-context` / top-bar menu / `app-sidebar`): click pins open across leave + page switch; hover still temporary.
- Persisted via existing tables — schema unchanged.

## Prior: thread stroke comfort zoom

- No DDL. Marker `20260809174711_thread_stroke_comfort_zoom.sql`.
- **Thread stroke comfort** (`EditableThread` / `ThreadConnectionLine` / `ControlPoint`): `threadComfortScale(zoom) = 1/max(1,√zoom)` — thins on zoom-out (rides with content); soft counter-scale on zoom-in. Replaces full `1/zoom` screen-constant stroke that looked fat when zoomed out. Hit band stays `×1/zoom`.

## Prior: unlocked frame clip hover preview

- No DDL. Marker `20260809174346_unlocked_frame_clip_hover_preview.sql`.
- **Unlocked clip UX** (`chat-panel-node`): overflowing right/bottom edges use a short `mask-image` fade so half-cut glyphs dissolve instead of chopping.
- **Hover preview**: after ~500ms dwell on an unlocked clipped frame, temporarily unclip + backdrop + raise RF node z-index to show full blocks; leave cancels immediately; saved `resizeDimensions` unchanged.

## Prior: frame select click / drag border

- No DDL. Marker `20260809173223_frame_select_click_drag_border.sql`.
- **Frame select**: click-release only; mid-press hides selection chrome.
- **Frame move**: transient blue box only; deselect on drag start/end (`lib/frame-drag-transient.ts`).

## Prior: frame UI scale selection chrome

- No DDL. Marker `20260809163216_frame_ui_scale_selection_chrome.sql`.
- **Selection chrome** (`chat-panel-node` + `globals.css`): shared `frameUiScale` — shrink when frame < ref/0.7 wide (floor 0.55); grow `widthRatio^0.85` up to 4×. Scales corner resize handles, blue resize lines, connection indicators, and rotate/lock/wrap.
- **`isBlockContentEmpty`**: `pageLink` / `databaseBlock` atoms count as content so lock/wrap show on page frames.

## Prior: pageLink chrome + deselect fix

- No DDL. Marker `20260809153815_pagelink_chrome_deselect_fix.sql`.
- **pageLink chrome** (`page-link-view`): icon + open-menu comfort counter-scale `chromeScale = 1/max(1,√scale)` via `useStore` zoom — **transform-only**. Menu/grip share first rendered title-line center. Hug width uses icon **`offsetWidth`**.
- **Deselect**: `onEditorActiveChange` counts only non-empty **TextSelection**; pane click blurs focus inside `.react-flow__node`.
- **⋮⋮ grips**: `lineCenter` + `translateY(-50%)`; skip grip layout setState when geometry unchanged.

## Prior: screen-relative frame chrome + handles

- No DDL. Marker `20260809142717_screen_relative_frame_chrome_and_handles.sql`.
- **Frame chrome** (rotate · lock · wrap, `chat-panel-node`): counter-scaled `scale(1/zoom)` via `useStore((s)=>s.transform[2])`, `transform-origin: top left`, top-anchored under the bottom-left corner. Nudge/gap offsets are `±px / zoom` so they stay a constant **SCREEN** distance (10px gap) — fixed local-px margins would detach it at zoom extremes.
- **⋮⋮ block grips + add-block line** (`tiptap-block-handles`): counter-scaled by the measured container local→screen scale (`getBoundingClientRect().height/offsetHeight` = zoom × frameScale); a `useStore` zoom subscription re-renders them to re-measure. Comfort scale `1 / max(1, √scale)`: **scale=1 when zoomed out** (rides with content, stays in the shrinking gutter), grows ∝ **√zoom** when zoomed in. Horizontally **centered in the gutter** (`left = GUTTER(24)/2 − GRIP_W(20)/2`); vertically dropped onto the **first line's center** (`top = block.top + firstLineH/2 − GRIP_H(24)/2`, `firstLineH` = computed `line-height`); `transform-origin: center`.
- Persisted via existing tables — schema unchanged.

## Prior: menu sizing + placement + nav

- No DDL. Marker `20260809132139_menu_placement_zoom_and_nav.sql`.
- **Frame right-click menu** (`BlockActionsMenu` absolute mode): removed `scale(zoom)` → **constant size at any zoom** (matches the text-highlight menu).
- **Text selection popup** (`selection-format-popup`): **hides during board nav** (pan/zoom) via `MutationObserver` on `.react-flow__viewport` transform, **returns ~150ms after nav settles** (stays mounted, `visibility:hidden`, re-places). Placement now prefers **right of frame → left of frame → end of text** (1- and multi-line alike).
- **⋮⋮ handle actions menu** (`BlockActionsMenu` fixed mode): new `openLeft` prop → opens **left of the frame** when there's room (else right of the handle), sitting opposite the right-anchored selection popup.
- Persisted via existing `messages.metadata` jsonb — schema unchanged.

## Prior: frame unlock returns to saved shape

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
