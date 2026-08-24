# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-24T04:18:24Z`
- Source: local `supabase/migrations/` + remote `list_migrations` (thinkable) + `.temp` service versions
- Service versions (from `supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.195.0`, rest `v13.0.5`, storage `v1.68.1`
- CLI: `supabase` `2.90.0` (marker via `migration new`)
- Remote applied tops out at `20260811225342_conversations_owner_select_for_insert_returning`

## This save

- No DDL. Marker `20260824041824_phone_unselected_frame_drag_minimap_pan.sql`.
- Phone unselected frames: panel `nodrag` + hold ~450ms then drag (`lib/phone-unselected-frame-drag.ts`); blue move border (`PhoneFrameDragProvider`); nest-stack / on-thread drag hooks wired.
- Phone minimap: pointer pan (`lib/minimap-viewport-pan.ts`); `touch-action: none` on minimap; desktop keeps RF d3 pan + mouse-only fitView fallback.
- Schema unchanged; remote applied still tops out at `20260811225342`.

## Prior: AI hide text and frame text select

- No DDL. Marker `20260824040420_ai_hide_text_and_frame_text_select.sql`.
- AI Edit can create/style hidden text (`[[hide]]…[[/hide]]` → TipTap haze; flashcards skill; context pack annotates hidden spans).
- Selected frames: stopPropagation without preventDefault on TipTap mousedown/pointerdown so drag-to-select text works.
- Schema unchanged; remote applied still tops out at `20260811225342`.

## Prior: on-thread frame content center

- No DDL. Marker `20260824033903_on_thread_frame_content_center.sql`.
- On-thread offset frames: drag-end commit uses live `dragRef.anchor` + final RF position (fixes snap-back on release).
- Crossing the thread flips to the opposite side (no longer locked to the first normal); collapse to inline only when pulling back on the same side.
- Projection during drag reads the live session anchor (`nodeWithOnThreadAnchor`); block-group / nest-stack drag-stop skipped for on-thread frames.
- Schema unchanged; remote applied still tops out at `20260811225342`.

## Prior: on-thread perpendicular drag and toolbar guard

- No DDL. Marker `20260824031611_on_thread_perp_drag_toolbar_guard.sql`.
- On-thread frames: perpendicular drag (>12px) snaps beside the thread (`metadata.onThread.offset` + normal); thread shows a **dot** on the path instead of a stroke gap; drag back collapses to inline gap mode.
- Live gap/dot during drag (`EditableThread` derives `t` from frame center via `closestT`); path sync keyed on endpoint geometry (`onThreadPathSyncKey`) to stop render storms.
- Drag constrain runs after helper lines (`constrainOnThreadPositionChanges` in `board-flow.tsx`); single commit on drag end.
- Editor toolbar undo/redo: `canEditorUndo` / `canEditorRedo` guard destroyed TipTap editors (`editor.isDestroyed`).
- Schema unchanged; remote applied still tops out at `20260811225342`.

## Prior: draw lasso, insert space, on-thread frames

- No DDL. Marker `20260824024921_draw_lasso_insert_space_thread_frames.sql`.
- Draw bar **Lasso** is freehand (`lib/freehand-lasso-select.ts`): own SVG trail, implicitly closed loop, partial-overlap frame/thread hits.
- Draw bar **Insert space** (`drawTool` `insert-v` / `insert-h`, `use-insert-space-drag.ts` + `insert-space-overlay.tsx`): drag opens a gap, top-level nodes past the guide shift by the delta, positions persist on release.
- Thread menu **Insert frame** (`use-on-thread-frames.ts`, `lib/threads/on-thread-frame.ts`, `lib/threads/thread-path-geometry.ts`): frame sits at `t` on the thread path with stroke gaps, drag slides it along the curve; thread **Thickness** in `ThreadEdgeData.strokeWidth`.
- Property icons / connections paint inside the frame fill (`lib/property-header-context.tsx`), with hug caps on cell value / row-card title.
- All of it rides existing `messages.metadata` (`onThread`) and `panel_edges.metadata` JSON — schema unchanged; remote applied still tops out at `20260811225342`.

## Prior: frame fit↔free restore

- No DDL. Marker `20260823234830_frame_fit_free_restore.sql`.
- Frame fit↔free toggle: unlock restores `unlockedFrameSize` / scale after fit-to-text; lock snapshots live free box before hugging.
- Metadata sync guard — stale locked `resizeDimensions` no longer overwrite a fit→free restore.
- Schema unchanged.

## Prior: property strip scroll and DB hover preview

- No DDL. Marker `20260823233405_property_strip_scroll_db_clip_preview.sql`.
- Top property strip: horizontal scroll when icons overflow; **…** at the right when not fully scrolled (replaces ←/→ caret pagination).
- Free-resize Notion DB frames: hover clip-preview (`data-clip-preview`) expands to full table width × height — not the clipped viewport.
- TipTap `getHTML` guard when editor/view is destroyed mid-sync.
- Schema unchanged.

## Prior: Notion DB table perf and wheel scroll

- No DDL. Marker `20260823223134_notion_db_table_perf_scroll.sql`.
- Notion DB table perf: paginated fetch (50 rows + Load more), `@tanstack/react-virtual` row virtualization, lazy cell editors, memoized rows, frame-drag light shell.
- DB wheel UX: scroll in Scroll nav; block pan at table edges; pinch / Cmd+Ctrl+wheel still zooms map; bottom fade when truncated.
- Property block drag/drop, value popup, drop-line portal, AI origin toggle (ongoing chrome work).
- Schema unchanged.

## Prior: property strip pagination and tooltips

- No DDL. Marker `20260823024219_property_strip_pagination_tooltips.sql`.
- Top property strip paginates with ←/→ carets when icons overflow the frame width (chrome band measure + screenChromeScale).
- Property icons (top strip + in-frame cells): shared `PropertyIconWithTooltip` (~200ms hover) — Notion column name, else type label.
- Card↔table property round-trip improvements (`propertyName`, inline harvest, convert layout).
- Schema unchanged.

## Prior: Shift+drag and Cmd/Ctrl+wheel nav flip

- No DDL. Marker `20260821141020_shift_drag_and_cmd_wheel_nav_flip.sql`.
- Shift+drag flips Free-nav pointer tool (pan↔select); Cmd/Ctrl+wheel flips sticky Scroll↔Zoom (Mac trackpad pinch always zooms).
- Default board title **New board** + in-path rename; empty `/board` shows New board.
- Schema unchanged.

## Prior: desktop frame select opens menu

- No DDL. Marker `20260820105819_desktop_frame_select_opens_menu.sql`.
- Desktop left-click select opens the frame menu (same as thread/block); Shift/Cmd multi-select does not; already-selected drag strip toggles; text/chrome dismisses if open.
- Phone: first tap selects only; tap drag strip again for menu (unchanged).
- Schema unchanged.

## Prior: phone boards nav tap sticky tunnel

- No DDL. Marker `20260820105152_phone_boards_nav_tap_sticky_tunnel.sql`.
- Phone boards nav: scrim below top bar (hamburger toggles close); tap opens board + closes; hold reorders; hover styles only on hover devices; ghost-click reopen guard.
- Sticky Cloudflare quick tunnel script (`scripts/sticky-cloudflare-tunnel.sh`) — new process group; replaces prior tunnel on each run.
- Schema unchanged.

## Prior: remove style bar menu toggle

- No DDL. Marker `20260820103736_remove_style_bar_menu_toggle.sql`.
- Remove Style mode (Block/Frame/Thread) from the top-bar pill; frame menu skips Search autofocus on touch; second strip/path tap toggles frame/thread menus closed.
- Schema unchanged.

## Prior: style bar labels and menus

- No DDL. Marker `20260820020104_style_bar_labels_and_menus.sql`.
- Style bar: Block / Frame / Thread menus (drop “style” from tool names); Layout bar Threads; Turn into + Notion top-bar pin preference polish.
- Schema unchanged.

## Prior: thread layout stack unstack restore

- No DDL. Marker `20260820002722_thread_layout_stack_unstack_restore.sql`.
- Thread layout: magnet and stack independent of align/direction; stack collapses in place; unstack restores fill XY (chrome unwind on hide remount).
- Schema unchanged.

## Prior: thread layout snap pack stack line

- No DDL. Marker `20260819233757_thread_layout_snap_pack_stack_line.sql`.
- Thread layout: magnet packs selected frames flush and links `sideStacks` (stack line; no lock). Line shows when either frame is selected, and always while mates are stacked.
- Schema unchanged.

## Prior: notion import picker recents cancel

- No DDL. Marker `20260819103921_notion_import_picker_recents_cancel.sql`.
- Notion Import pages: Recents / Shared start open; Private + nested pages collapsed; Adding… / Generating… + Cancel (abort in-flight import). Sidebar more-menu New board nests under a row.
- Schema unchanged.

## Prior: boards nav dismiss on board click

- No DDL. Marker `20260818235211_boards_nav_dismiss_on_board_click.sql`.
- Boards nav popup: board / other-chrome pointerdown outside the menu + hamburger unpins and hides immediately (pin still survives leave / board switch / reload).
- Schema unchanged.

## Prior: card convert bring collapsed stack

- No DDL. Marker `20260818013815_card_convert_bring_collapsed_stack.sql`.
- Nested/parent Card convert: **Bring related rows?** (sub-rows + parent rows, both default on; `thinktable-card-convert-bring-v3`); collapsed `sideStacks` pack (Stack under); peeled rows hidden from the live table; DB row gutter overflow + selected-DB pinch/zoom hygiene.
- Schema unchanged.

## Prior: board nav notion db widths subtasks

- No DDL. Marker `20260818002748_board_nav_notion_db_widths_subtasks.sql`.
- Board pan/zoom nav freeze (`board-navigating`); Notion view subtasks + `configuration.properties` column widths / wrap / visibility; DB cell overflow ellipsis; phone DB touch/paint hygiene.
- Schema unchanged.

## Prior: notion row card frame drag zindex

- No DDL. Marker `20260817004139_notion_row_card_frame_drag_zindex.sql`.
- Notion DB row→card convert (property frames + threads); frame drag z-order via `zIndex` (no RF nodes reorder — TipTap NodeViews); row-card layout freeze; DB frame hug uses table `scrollWidth`.
- Schema unchanged.

## Prior: selected frame drag keeps selection

- No DDL. Marker `20260816131032_selected_frame_drag_keeps_selection.sql`.
- Selected frame drag keeps selection (body/chrome — not text, ⋮⋮, adjust, connection simulators, or property/connection marks); mid-press hides indicators only. Phone paints every block ⋮⋮ while the frame is selected; menu placement updates.
- Schema unchanged.

## Prior: frame screen chrome fit gaps

- No DDL. Marker `20260816045221_frame_screen_chrome_fit_gaps.sql`.
- Frame chrome: larger `frameScreenChromeScale` (1.4×, soft zoom^0.35); blue→content gaps (Y 6 / X 1); adjust box fits screen ⋮⋮; rotate/free/wrap gap = indicator + gutter; add-block hairlines even about visual ⋮⋮.
- Schema unchanged.

## Prior: screen relative frame chrome

- No DDL. Marker `20260816040622_screen_relative_frame_chrome.sql`.
- Frame selection chrome is screen-relative: resize handles, indicators, rotate/free/wrap, property/connections rows; ⋮⋮ comfort vs zoom×frameScale.
- Schema unchanged.

## Prior: frame resize chrome connection indicators

- No DDL. Marker `20260816033714_frame_resize_chrome_connection_indicators.sql`.
- Frame resize chrome: compact handles + square adjust ring; connection simulators outset; indicator press no longer frame-drags.
- Schema unchanged.

## Prior: connections properties block handles

- No DDL. Marker `20260816031355_connections_properties_block_handles.sql`.
- Connections strip gets a ⋮⋮ like the property header (Live Sync / Manual / Remove); property + connections chrome grips omit add-block hairlines.
- Schema unchanged.

## Prior: frame property cell chrome

- No DDL. Marker `20260816030739_frame_property_cell_chrome.sql`.
- Frame property cell chrome: fill radius matches property cell; adjust gutters/bands scale with `frameScale`; ⋮⋮ centers in gutter and tracks resize; property/connections only while selected; empty-cell first click selects the frame; hover border only when selected; `PropertyBlockView` watches `contenteditable` so selected hover/I-bar work on first interaction; homepage nav Get started + overflow menu.
- Schema unchanged.

## Prior: AI composer voice dictation

- No DDL. Marker `20260815183526_ai_composer_voice_dictation.sql`.
- AI composer voice-to-text: mic left of send; Cursor-style waveform + timer + cancel/confirm; PCM→WAV → Whisper (`/api/ai/transcribe`); prefer physical mics over BlackHole/virtual devices.
- Schema unchanged.

## Prior: phone board open menu taps

- No DDL. Marker `20260815175520_phone_board_open_menu_taps.sql`.
- Phone preview / open / Notion on boardLink: selected-frame caret `touchstart` skips `[data-page-link-preview]`; menu `nodrag`/`nopan`; touch devices keep the pill visible while the host frame is selected.
- Schema unchanged.

## Prior: customize agent chat scroll chrome

- No DDL. Marker `20260815174523_customize_agent_chat_scroll_chrome.sql`.
- Customize-agent panel (drafts in localStorage); chat return-to-bottom on phone content card + desktop; open chats pin to bottom; preserve scroll across phone↔desktop remounts; thread caret beside title; header agent icon only when transcript exists.
- Schema unchanged.

## Prior: property block header chat chrome

- No DDL. Marker `20260815171425_property_block_header_chat_chrome.sql`.
- Property types: top icons are one strip block (single ⋮⋮); Turn into → Property yields `propertyBlock` cell atoms; chat brand sits beside thread picker; path uses cutoff-able space before More; boards-nav pin survives reload.
- Schema unchanged.

## Prior: phone mode pill undo cluster

- No DDL. Marker `20260815045351_phone_mode_pill_undo_cluster.sql`.
- Phone pill: mode dropdown + tools in one rounded pill; undo/redo board-fill sibling tucks under the tools right cap; Draw six icons pack evenly; hide-pill removed.
- Schema unchanged.

## Prior: phone zoom swipe frame caret

- No DDL. Marker `20260815012513_phone_zoom_swipe_frame_caret.sql`.
- Phone Zoom nav: two-finger parallel swipe zooms (no pan) with trackpad-like coast; Scroll nav still pans + coasts; pinch still zooms.
- Selected-frame caret: phone non-passive `touchstart` + desktop `pointerdown` place I-bar on first press.
- Schema unchanged.

## Prior: frame property ibar align

- No DDL. Marker `20260815005933_frame_property_ibar_align.sql`.
- Turn into → Property: persist `metadata.propertyType`; frame top property icon + blue connection handle (arms top connection point); I-bar create offsets match block chrome (X=26 / Y=4); first-time property shifts Y by strip height; note-fade-in opacity-only.
- Schema unchanged.

## Prior: menu flyouts always right

- No DDL. Marker `20260815001725_menu_flyouts_always_right.sql`.
- Menu placement: flyouts (Turn into / Color / Shape / Board in / …) always open to the **right** of the parent card; main card locks under the pointer once a flyout is open (no left-side hover thrash).
- Schema unchanged.

## Prior: turn into menu frame block chrome

- No DDL. Marker `20260815000653_turn_into_menu_frame_block_chrome.sql`.
- Block/frame menus: Turn into Format / Property tabs (compact one-pane flyout); Block vs Frame headers; hide Turn into on frame menu; hide Present from here on block ⋮⋮ menu.
- Schema unchanged.

## Prior: phone chat dock visible

- No DDL. Marker `20260814222457_phone_chat_dock_visible.sql`.
- Phone AI dock invisible under 900px: `globals.css` hid all `[data-chat-sidebar]` including the map dock — narrowed to `:not([data-chat-map-dock])`. Dock portals onto `[data-board-root]`; RF `Node` type-only import (runtime `instanceof` crash). Empty-frame grey outline + Free nav board fill when chat open.
- Schema unchanged.

## Prior: board reload perf cold load

- No DDL. Marker `20260814205759_board_reload_perf_cold_load.sql`.
- Board cold-load perf: no 500ms messages poll (Realtime + invalidate); `/api/homepage-board` only for homepage id; async legacy migrate; `loading.tsx`; RF `Node` type-import fix (stopped Fast Refresh loop / blank frames from `next/dynamic` ChatPanelNode).
- Schema unchanged.

## Prior: path menu hover board load reveal

- No DDL. Marker `20260814191420_path_menu_hover_board_load_reveal.sql`.
- Path crumb hover: 320ms dwell + slower fade-in, 120ms leave grace (stay open into nested flyouts). Board nav hover leave ~350ms. Frame shells overlap real frames then fade with content; chat placeholder fades out fully before transcript fades in.
- Schema unchanged.

## Prior: top bar load layout minimap

- No DDL. Marker `20260814181955_top_bar_load_layout_minimap.sql`.
- Top bar: one path shimmer; chat-open cookie so the column exists on first HTML; tools stay hidden until that width is measured (already collapsed if space requires). Minimap expand-up after frames land.
- Schema unchanged.

## Prior: prompt bars menu placement ibar

- No DDL. Marker `20260814134144_prompt_bars_menu_placement_ibar.sql`.
- AI prompt bars (sidebar ticks / phone dashes); chrome-free menu placement; I-bar pane-click slop.
- Schema unchanged.

## Prior: top bar tool titles

- No DDL. Marker `20260814065945_top_bar_tool_titles.sql`.
- Mode-bar icon+title (undo/redo stay icon-only); Filter/Sort/Automations/Search + eraser/pencil/highlighter collapse first; remaining titles next; Search title hides as the field slides out. Labels: Present, Tidy up, Anchor, Snap frames.
- Schema unchanged.

## Prior: view capture presentation

- No DDL. Marker `20260814063716_view_capture_presentation.sql`.
- View bar: Capture + Presentation menus (local captures, presentation picker, add-to-chat); Draw highlighter color dropdown; board menu Capture; connections group on frames.
- Schema unchanged.

## Prior: top bar share more image blocks

- No DDL. Marker `20260814042452_top_bar_share_more_image_blocks.sql`.
- Top bar: lock+Share, copy link, favorites, More (Import/Export, Connections→Notion). TipTap imageBlock.
- Schema unchanged.

## Prior: board camera rotation

- No DDL. Marker `20260814035712_board_camera_rotation.sql`.
- Board camera rotation: Free nav rotate icon (drag snaps at 0°, slider does not) + Reset; phone two-finger twist with ~42° arm + pinch zoom-lock; Safari trackpad `GestureEvent` (Chromium does not expose trackpad rotate).
- Schema unchanged.

## Prior: view presentation icon

- No DDL. Marker `20260814024128_view_presentation_icon.sql`.
- View top bar: Presentation icon with slash after Board style; Layout/View bar rework (Smart Align).
- Schema unchanged.

## Prior: frame color menu border slider

- No DDL. Marker `20260814012801_frame_color_menu_border_slider.sql`.
- Frame Color menu: Last used → Background → Border (smooth 1–8px size slider); solid fills; border shows from color alone; hide Draw reset arrow.
- Schema unchanged.

## Prior: board menu long press draggable heal

- No DDL. Marker `20260813233344_board_menu_long_press_draggable_heal.sql`.
- Board empty-pane menu; phone long-press → Board/frame/Map menus; unselected TipTap non-editable; message merge always recomputes frame `draggable` (fix stuck-after-Linear/pin).
- Schema unchanged.

## Prior: frame connections notion

- No DDL. Marker `20260813114401_frame_connections_notion.sql`.
- Frame menu Connections → Notion; live/manual sync; footer mark; flyout beside the Connections row.
- Schema unchanged.

## Prior: turn into property pane

- No DDL. Marker `20260813103833_turn_into_property_pane.sql`.
- Turn into flyout: Property pane (AI Autofill, type grids, connectors) + Automations menu/editor (UI-only).
- Schema unchanged.

## Prior: phone AI dock separate cards

- No DDL. Marker `20260813032248_phone_ai_dock_separate_cards.sql`.
- Phone AI dock: transcript / chrome / prompt as separate rounded cards with gaps; chrome mid-strip board-fill, no border.
- Schema unchanged.

## Prior: remove draw shapes top bar

- No DDL. Marker `20260813030725_remove_draw_shapes_top_bar.sql`.
- Draw top bar: remove Shapes button (and More overflow entry).
- Schema unchanged.

## Prior: chrome slash separators overflow

- No DDL. Marker `20260813030128_chrome_slash_separators_overflow.sql`.
- Top bar + Free nav: `|` → `/`; Draw group dividers → `/`; keep `/` before More and More→Layout on Actions overflow.
- Schema unchanged.

## Prior: actions bar lock icons board center

- No DDL. Marker `20260813023611_actions_bar_lock_icons_board_center.sql`.
- Actions bar: board lock = Anchor, frame lock = stacked Lego; Free nav Scroll|Zoom pipes; board-centered toolbar (no +, no mode-pill reset); Insert = Table/File/Camera only; layout (None) Actions-only.
- Schema unchanged.

## Prior: move toolbar controls to menus

- No DDL. Marker `20260813011513_move_toolbar_controls_to_menus.sql`.
- Home top-bar formatting moved: paintbrush + align to text select popup; fill/border + board/frame locks to frame right-click; thread Style/Thickness (`strokeWidth`) to thread click menu.
- Schema unchanged.

## Prior: free nav minimap plus minus circle

- No DDL. Marker `20260813005233_free_nav_minimap_plus_minus_circle.sql`.
- Minimap toggle is a circle **+/-** (matches Free nav fill) at Free nav top-left; removed Map icon + minimize/expand subicon.
- Schema unchanged.

## Prior: free nav map icon fill placement

- No DDL. Marker `20260812111842_free_nav_map_icon_fill_placement.sql`.
- Free nav fill: board when chat closed or transcript open; white for input-only; Map controls fixed top-left with minimize/expand badge.
- Schema unchanged.

## Prior: free nav minimap map icon chrome

- No DDL. Marker `20260812110123_free_nav_minimap_map_icon_chrome.sql`.
- Free nav white chrome; Map open/close icon (white + shadow) overlays minimap top-left when open and Free nav top-left when closed; removed hover pill / open-on-hover.
- Schema unchanged.

## Prior: phone AI map dock chrome

- No DDL. Marker `20260812015846_phone_ai_map_dock_chrome.sql`.
- Phone AI map dock: composer on the board above keyboard; Free nav snaps above + left-aligns to chat card; minimap unmounts while AI open; brand logo hides while open; dock/nav use board fill; Free nav + minimap column-stack (no overlap).
- Schema unchanged.

## Prior: phone frame create no browser zoom

- No DDL. Marker `20260812002117_phone_frame_create_no_browser_zoom.sql`.
- Frame create no longer forces RF zoom to 100% / recenter.
- Phone: lock browser page zoom (`maximumScale=1`); board `main` `overflow-hidden`; I-bar capture stays centered at 16px and keeps keyboard focus while typing (TipTap gets `setContent` only — no edge autofocus Safari would page-zoom).
- Schema unchanged.

## Prior: board/frame lock toolbar

- No DDL. Marker `20260811233658_board_frame_lock_toolbar.sql`.
- Top-bar **board / frame** locks (distinct Lock + FileText / Square sub-icons): pin selected frames to the board (`boardLocked`); lock ≥2 frames to each other (`frameLockGroupId` rigid drag). Fit-to-content stays on under-frame ScanText.
- Schema unchanged.

## Prior: conversations INSERT RETURNING RLS

- **DDL (thinkable, applied via MCP):**
  - Local `20260811225322_conversations_owner_select_for_insert_returning.sql` ↔ remote `20260811225342_conversations_owner_select_for_insert_returning`
  - `conversations` SELECT/UPDATE RLS: allow `auth.uid() = user_id` **or** share rank (fixes INSERT…RETURNING when STABLE `user_board_role_rank` misses the new row)
- App: linked-board content isolation (sole `boardLink` after Turn into Board; strip board name from child body; restore open-menu CSS; repair polluted frames)

## Prior: Page → Board rename

- **DDL (thinkable, applied via MCP):**
  - Local `20260811220510_rename_page_to_board_share_and_ai.sql` ↔ remote `20260811223628_rename_page_to_board_share_and_ai`
  - `page_share_*` → `board_share_*` (tables, `board_id` columns, indexes, triggers, policies)
  - RPCs `user_page_access_role` / `user_page_role_rank` → `user_board_access_role` / `user_board_role_rank` (RLS policies updated)
  - `ai_threads.page_id` → `ai_threads.board_id`
- App: product term **Page → Board** (DEFINITIONS / UI / TipTap `boardLink` dual-read / share API `/api/share/[boardId]`)

## Prior: page share + side-stack snap polish

- **DDL (thinkable, applied via MCP; local filenames differ):**
  - Local `20260811063000_page_share_links_and_people.sql` ↔ remote `20260811103152_page_share_links_and_people`
  - Local `20260811070000_secure_page_share_access.sql` ↔ remote `20260811104322_secure_page_share_access` + `20260811104342_secure_page_share_rls_policies`
  - Tables/helpers: then `page_share_links`, `page_share_people`, hashed tokens, conversation-scoped RLS (renamed in this save)
- Marker `20260811110630_frame_snap_rotate_mates_mid_drag_reshap.sql` (no extra DDL):
  - Snap/stack mates repark live when host upright AABB changes (rotation)
  - Per-side stack trees + nested packs; unlocked drag-away can re-snap to another side/frame same gesture
  - Shape-aware AABB; share UI / APIs shipped with the above DDL

## Prior: frame edge-snap / shapes / rotation

- No DDL. Marker `20260811024400_frame_edge_snap_stack_shapes_rotation.sql`.
- **Frame edge-snap / stack**: snap links frames (line per gap); first Stack locks (`snapLockGroupId`); Open stack + directional arrows + Lock on the line menu; unlock then drag-away delinks.
- **Frames as shapes** + upright blue AABB resize chrome; blocks/shape rotate inside (no double fill).
- Nested TipTap frames removed; legacy HTML unwraps on load.
- Schema unchanged.

## Prior: AI composer + Quiz me

- No DDL. Marker `20260810143604_ai_composer_plus_quiz_me.sql`.
- **AI composer chrome**: Ask↔Edit click-toggle in the input row (Scroll↔Zoom pattern); **+** menu (search, skills, File, Connection) portaled above the overflow shell; skills include Summarize / Tasks / Search board / **Quiz me** (Ask removed from + menu).
- Schema unchanged.

## Prior: AI Edit create frames checklist

- No DDL. Marker `20260810141615_ai_edit_create_frames_checklist.sql`.
- **AI Edit create frames + threads**: Edit mode can insert frames and `panel_edges` near viewport center (pending rainbow marks); Save keeps / Remove deletes.
- Prefer **edits** over duplicate creates for follow-ups; `capabilityGap` waits for user confirm before approximating unsupported asks (e.g. real tables → checklist offer).
- Markdown checklists/pipe-tables → TipTap **taskList** (`lib/ai/markdown-to-tiptap.ts`); pending marks only wrap p/h so taskItem chrome stays intact; checklist CSS alignment + per-item ⋮⋮ handles.
- Top-bar Sparkles AI-origin toggle shown only when the board has AI-origin content.
- Persisted via existing `messages` / `panel_edges` / `ai_action_log` — schema unchanged.

## Prior: AI Edit review session

- No DDL. Marker `20260810132851_ai_edit_review_session.sql`.
- **AI Edit review UX**: Ask/Edit modes; surgical `replacements`; in-memory pending proposals (DB keeps original until Save); TipTap `aiPending` / `aiOrigin` marks; bottom review bar (eye / Remove / Save); rainbow frame glow; soft ⋮⋮ grip tint; optimistic message-cache patch so Save/Remove survive refetch races.
- Persisted via existing `messages.content` + `ai_action_log` — schema unchanged.

## Prior: AI copilot foundation

- **DDL** `20260810020000_ai_copilot_foundation.sql` applied on thinkable:
  - `ai_threads` — universal per-user sidebar chats (`board_id` filter association; was `page_id`)
  - `ai_messages` — Ask/Plan/Edit turns (never board frames)
  - `ai_context_snapshots` — reusable context packs
  - `ai_action_log` — future Edit/Plan undo via edit-past-chat
- App: sidebar Ask streaming (`/api/ai/*`), drag chat blocks onto board, edit-to-rewind, snapshots, `lib/ai/*` mode/skill/agent stubs
`, storage `v1.68.1`
- CLI: `supabase` `2.90.0` (marker via `migration new`)
- Remote applied tops out at `20260811225342_conversations_owner_select_for_insert_returning`

## This save

- No DDL. Marker `20260820105152_phone_boards_nav_tap_sticky_tunnel.sql`.
- Phone boards nav: scrim below top bar (hamburger toggles close); tap opens board + closes; hold reorders; hover styles only on hover devices; ghost-click reopen guard.
- Sticky Cloudflare quick tunnel script (`scripts/sticky-cloudflare-tunnel.sh`) — new process group; replaces prior tunnel on each run.
- Schema unchanged.

## Prior: remove style bar menu toggle

- No DDL. Marker `20260820103736_remove_style_bar_menu_toggle.sql`.
- Remove Style mode (Block/Frame/Thread) from the top-bar pill; frame menu skips Search autofocus on touch; second strip/path tap toggles frame/thread menus closed.
- Schema unchanged.

## Prior: style bar labels and menus

- No DDL. Marker `20260820020104_style_bar_labels_and_menus.sql`.
- Style bar: Block / Frame / Thread menus (drop “style” from tool names); Layout bar Threads; Turn into + Notion top-bar pin preference polish.
- Schema unchanged.

## Prior: thread layout stack unstack restore

- No DDL. Marker `20260820002722_thread_layout_stack_unstack_restore.sql`.
- Thread layout: magnet and stack independent of align/direction; stack collapses in place; unstack restores fill XY (chrome unwind on hide remount).
- Schema unchanged.

## Prior: thread layout snap pack stack line

- No DDL. Marker `20260819233757_thread_layout_snap_pack_stack_line.sql`.
- Thread layout: magnet packs selected frames flush and links `sideStacks` (stack line; no lock). Line shows when either frame is selected, and always while mates are stacked.
- Schema unchanged.

## Prior: notion import picker recents cancel

- No DDL. Marker `20260819103921_notion_import_picker_recents_cancel.sql`.
- Notion Import pages: Recents / Shared start open; Private + nested pages collapsed; Adding… / Generating… + Cancel (abort in-flight import). Sidebar more-menu New board nests under a row.
- Schema unchanged.

## Prior: boards nav dismiss on board click

- No DDL. Marker `20260818235211_boards_nav_dismiss_on_board_click.sql`.
- Boards nav popup: board / other-chrome pointerdown outside the menu + hamburger unpins and hides immediately (pin still survives leave / board switch / reload).
- Schema unchanged.

## Prior: card convert bring collapsed stack

- No DDL. Marker `20260818013815_card_convert_bring_collapsed_stack.sql`.
- Nested/parent Card convert: **Bring related rows?** (sub-rows + parent rows, both default on; `thinktable-card-convert-bring-v3`); collapsed `sideStacks` pack (Stack under); peeled rows hidden from the live table; DB row gutter overflow + selected-DB pinch/zoom hygiene.
- Schema unchanged.

## Prior: board nav notion db widths subtasks

- No DDL. Marker `20260818002748_board_nav_notion_db_widths_subtasks.sql`.
- Board pan/zoom nav freeze (`board-navigating`); Notion view subtasks + `configuration.properties` column widths / wrap / visibility; DB cell overflow ellipsis; phone DB touch/paint hygiene.
- Schema unchanged.

## Prior: notion row card frame drag zindex

- No DDL. Marker `20260817004139_notion_row_card_frame_drag_zindex.sql`.
- Notion DB row→card convert (property frames + threads); frame drag z-order via `zIndex` (no RF nodes reorder — TipTap NodeViews); row-card layout freeze; DB frame hug uses table `scrollWidth`.
- Schema unchanged.

## Prior: selected frame drag keeps selection

- No DDL. Marker `20260816131032_selected_frame_drag_keeps_selection.sql`.
- Selected frame drag keeps selection (body/chrome — not text, ⋮⋮, adjust, connection simulators, or property/connection marks); mid-press hides indicators only. Phone paints every block ⋮⋮ while the frame is selected; menu placement updates.
- Schema unchanged.

## Prior: frame screen chrome fit gaps

- No DDL. Marker `20260816045221_frame_screen_chrome_fit_gaps.sql`.
- Frame chrome: larger `frameScreenChromeScale` (1.4×, soft zoom^0.35); blue→content gaps (Y 6 / X 1); adjust box fits screen ⋮⋮; rotate/free/wrap gap = indicator + gutter; add-block hairlines even about visual ⋮⋮.
- Schema unchanged.

## Prior: screen relative frame chrome

- No DDL. Marker `20260816040622_screen_relative_frame_chrome.sql`.
- Frame selection chrome is screen-relative: resize handles, indicators, rotate/free/wrap, property/connections rows; ⋮⋮ comfort vs zoom×frameScale.
- Schema unchanged.

## Prior: frame resize chrome connection indicators

- No DDL. Marker `20260816033714_frame_resize_chrome_connection_indicators.sql`.
- Frame resize chrome: compact handles + square adjust ring; connection simulators outset; indicator press no longer frame-drags.
- Schema unchanged.

## Prior: connections properties block handles

- No DDL. Marker `20260816031355_connections_properties_block_handles.sql`.
- Connections strip gets a ⋮⋮ like the property header (Live Sync / Manual / Remove); property + connections chrome grips omit add-block hairlines.
- Schema unchanged.

## Prior: frame property cell chrome

- No DDL. Marker `20260816030739_frame_property_cell_chrome.sql`.
- Frame property cell chrome: fill radius matches property cell; adjust gutters/bands scale with `frameScale`; ⋮⋮ centers in gutter and tracks resize; property/connections only while selected; empty-cell first click selects the frame; hover border only when selected; `PropertyBlockView` watches `contenteditable` so selected hover/I-bar work on first interaction; homepage nav Get started + overflow menu.
- Schema unchanged.

## Prior: AI composer voice dictation

- No DDL. Marker `20260815183526_ai_composer_voice_dictation.sql`.
- AI composer voice-to-text: mic left of send; Cursor-style waveform + timer + cancel/confirm; PCM→WAV → Whisper (`/api/ai/transcribe`); prefer physical mics over BlackHole/virtual devices.
- Schema unchanged.

## Prior: phone board open menu taps

- No DDL. Marker `20260815175520_phone_board_open_menu_taps.sql`.
- Phone preview / open / Notion on boardLink: selected-frame caret `touchstart` skips `[data-page-link-preview]`; menu `nodrag`/`nopan`; touch devices keep the pill visible while the host frame is selected.
- Schema unchanged.

## Prior: customize agent chat scroll chrome

- No DDL. Marker `20260815174523_customize_agent_chat_scroll_chrome.sql`.
- Customize-agent panel (drafts in localStorage); chat return-to-bottom on phone content card + desktop; open chats pin to bottom; preserve scroll across phone↔desktop remounts; thread caret beside title; header agent icon only when transcript exists.
- Schema unchanged.

## Prior: property block header chat chrome

- No DDL. Marker `20260815171425_property_block_header_chat_chrome.sql`.
- Property types: top icons are one strip block (single ⋮⋮); Turn into → Property yields `propertyBlock` cell atoms; chat brand sits beside thread picker; path uses cutoff-able space before More; boards-nav pin survives reload.
- Schema unchanged.

## Prior: phone mode pill undo cluster

- No DDL. Marker `20260815045351_phone_mode_pill_undo_cluster.sql`.
- Phone pill: mode dropdown + tools in one rounded pill; undo/redo board-fill sibling tucks under the tools right cap; Draw six icons pack evenly; hide-pill removed.
- Schema unchanged.

## Prior: phone zoom swipe frame caret

- No DDL. Marker `20260815012513_phone_zoom_swipe_frame_caret.sql`.
- Phone Zoom nav: two-finger parallel swipe zooms (no pan) with trackpad-like coast; Scroll nav still pans + coasts; pinch still zooms.
- Selected-frame caret: phone non-passive `touchstart` + desktop `pointerdown` place I-bar on first press.
- Schema unchanged.

## Prior: frame property ibar align

- No DDL. Marker `20260815005933_frame_property_ibar_align.sql`.
- Turn into → Property: persist `metadata.propertyType`; frame top property icon + blue connection handle (arms top connection point); I-bar create offsets match block chrome (X=26 / Y=4); first-time property shifts Y by strip height; note-fade-in opacity-only.
- Schema unchanged.

## Prior: menu flyouts always right

- No DDL. Marker `20260815001725_menu_flyouts_always_right.sql`.
- Menu placement: flyouts (Turn into / Color / Shape / Board in / …) always open to the **right** of the parent card; main card locks under the pointer once a flyout is open (no left-side hover thrash).
- Schema unchanged.

## Prior: turn into menu frame block chrome

- No DDL. Marker `20260815000653_turn_into_menu_frame_block_chrome.sql`.
- Block/frame menus: Turn into Format / Property tabs (compact one-pane flyout); Block vs Frame headers; hide Turn into on frame menu; hide Present from here on block ⋮⋮ menu.
- Schema unchanged.

## Prior: phone chat dock visible

- No DDL. Marker `20260814222457_phone_chat_dock_visible.sql`.
- Phone AI dock invisible under 900px: `globals.css` hid all `[data-chat-sidebar]` including the map dock — narrowed to `:not([data-chat-map-dock])`. Dock portals onto `[data-board-root]`; RF `Node` type-only import (runtime `instanceof` crash). Empty-frame grey outline + Free nav board fill when chat open.
- Schema unchanged.

## Prior: board reload perf cold load

- No DDL. Marker `20260814205759_board_reload_perf_cold_load.sql`.
- Board cold-load perf: no 500ms messages poll (Realtime + invalidate); `/api/homepage-board` only for homepage id; async legacy migrate; `loading.tsx`; RF `Node` type-import fix (stopped Fast Refresh loop / blank frames from `next/dynamic` ChatPanelNode).
- Schema unchanged.

## Prior: path menu hover board load reveal

- No DDL. Marker `20260814191420_path_menu_hover_board_load_reveal.sql`.
- Path crumb hover: 320ms dwell + slower fade-in, 120ms leave grace (stay open into nested flyouts). Board nav hover leave ~350ms. Frame shells overlap real frames then fade with content; chat placeholder fades out fully before transcript fades in.
- Schema unchanged.

## Prior: top bar load layout minimap

- No DDL. Marker `20260814181955_top_bar_load_layout_minimap.sql`.
- Top bar: one path shimmer; chat-open cookie so the column exists on first HTML; tools stay hidden until that width is measured (already collapsed if space requires). Minimap expand-up after frames land.
- Schema unchanged.

## Prior: prompt bars menu placement ibar

- No DDL. Marker `20260814134144_prompt_bars_menu_placement_ibar.sql`.
- AI prompt bars (sidebar ticks / phone dashes); chrome-free menu placement; I-bar pane-click slop.
- Schema unchanged.

## Prior: top bar tool titles

- No DDL. Marker `20260814065945_top_bar_tool_titles.sql`.
- Mode-bar icon+title (undo/redo stay icon-only); Filter/Sort/Automations/Search + eraser/pencil/highlighter collapse first; remaining titles next; Search title hides as the field slides out. Labels: Present, Tidy up, Anchor, Snap frames.
- Schema unchanged.

## Prior: view capture presentation

- No DDL. Marker `20260814063716_view_capture_presentation.sql`.
- View bar: Capture + Presentation menus (local captures, presentation picker, add-to-chat); Draw highlighter color dropdown; board menu Capture; connections group on frames.
- Schema unchanged.

## Prior: top bar share more image blocks

- No DDL. Marker `20260814042452_top_bar_share_more_image_blocks.sql`.
- Top bar: lock+Share, copy link, favorites, More (Import/Export, Connections→Notion). TipTap imageBlock.
- Schema unchanged.

## Prior: board camera rotation

- No DDL. Marker `20260814035712_board_camera_rotation.sql`.
- Board camera rotation: Free nav rotate icon (drag snaps at 0°, slider does not) + Reset; phone two-finger twist with ~42° arm + pinch zoom-lock; Safari trackpad `GestureEvent` (Chromium does not expose trackpad rotate).
- Schema unchanged.

## Prior: view presentation icon

- No DDL. Marker `20260814024128_view_presentation_icon.sql`.
- View top bar: Presentation icon with slash after Board style; Layout/View bar rework (Smart Align).
- Schema unchanged.

## Prior: frame color menu border slider

- No DDL. Marker `20260814012801_frame_color_menu_border_slider.sql`.
- Frame Color menu: Last used → Background → Border (smooth 1–8px size slider); solid fills; border shows from color alone; hide Draw reset arrow.
- Schema unchanged.

## Prior: board menu long press draggable heal

- No DDL. Marker `20260813233344_board_menu_long_press_draggable_heal.sql`.
- Board empty-pane menu; phone long-press → Board/frame/Map menus; unselected TipTap non-editable; message merge always recomputes frame `draggable` (fix stuck-after-Linear/pin).
- Schema unchanged.

## Prior: frame connections notion

- No DDL. Marker `20260813114401_frame_connections_notion.sql`.
- Frame menu Connections → Notion; live/manual sync; footer mark; flyout beside the Connections row.
- Schema unchanged.

## Prior: turn into property pane

- No DDL. Marker `20260813103833_turn_into_property_pane.sql`.
- Turn into flyout: Property pane (AI Autofill, type grids, connectors) + Automations menu/editor (UI-only).
- Schema unchanged.

## Prior: phone AI dock separate cards

- No DDL. Marker `20260813032248_phone_ai_dock_separate_cards.sql`.
- Phone AI dock: transcript / chrome / prompt as separate rounded cards with gaps; chrome mid-strip board-fill, no border.
- Schema unchanged.

## Prior: remove draw shapes top bar

- No DDL. Marker `20260813030725_remove_draw_shapes_top_bar.sql`.
- Draw top bar: remove Shapes button (and More overflow entry).
- Schema unchanged.

## Prior: chrome slash separators overflow

- No DDL. Marker `20260813030128_chrome_slash_separators_overflow.sql`.
- Top bar + Free nav: `|` → `/`; Draw group dividers → `/`; keep `/` before More and More→Layout on Actions overflow.
- Schema unchanged.

## Prior: actions bar lock icons board center

- No DDL. Marker `20260813023611_actions_bar_lock_icons_board_center.sql`.
- Actions bar: board lock = Anchor, frame lock = stacked Lego; Free nav Scroll|Zoom pipes; board-centered toolbar (no +, no mode-pill reset); Insert = Table/File/Camera only; layout (None) Actions-only.
- Schema unchanged.

## Prior: move toolbar controls to menus

- No DDL. Marker `20260813011513_move_toolbar_controls_to_menus.sql`.
- Home top-bar formatting moved: paintbrush + align to text select popup; fill/border + board/frame locks to frame right-click; thread Style/Thickness (`strokeWidth`) to thread click menu.
- Schema unchanged.

## Prior: free nav minimap plus minus circle

- No DDL. Marker `20260813005233_free_nav_minimap_plus_minus_circle.sql`.
- Minimap toggle is a circle **+/-** (matches Free nav fill) at Free nav top-left; removed Map icon + minimize/expand subicon.
- Schema unchanged.

## Prior: free nav map icon fill placement

- No DDL. Marker `20260812111842_free_nav_map_icon_fill_placement.sql`.
- Free nav fill: board when chat closed or transcript open; white for input-only; Map controls fixed top-left with minimize/expand badge.
- Schema unchanged.

## Prior: free nav minimap map icon chrome

- No DDL. Marker `20260812110123_free_nav_minimap_map_icon_chrome.sql`.
- Free nav white chrome; Map open/close icon (white + shadow) overlays minimap top-left when open and Free nav top-left when closed; removed hover pill / open-on-hover.
- Schema unchanged.

## Prior: phone AI map dock chrome

- No DDL. Marker `20260812015846_phone_ai_map_dock_chrome.sql`.
- Phone AI map dock: composer on the board above keyboard; Free nav snaps above + left-aligns to chat card; minimap unmounts while AI open; brand logo hides while open; dock/nav use board fill; Free nav + minimap column-stack (no overlap).
- Schema unchanged.

## Prior: phone frame create no browser zoom

- No DDL. Marker `20260812002117_phone_frame_create_no_browser_zoom.sql`.
- Frame create no longer forces RF zoom to 100% / recenter.
- Phone: lock browser page zoom (`maximumScale=1`); board `main` `overflow-hidden`; I-bar capture stays centered at 16px and keeps keyboard focus while typing (TipTap gets `setContent` only — no edge autofocus Safari would page-zoom).
- Schema unchanged.

## Prior: board/frame lock toolbar

- No DDL. Marker `20260811233658_board_frame_lock_toolbar.sql`.
- Top-bar **board / frame** locks (distinct Lock + FileText / Square sub-icons): pin selected frames to the board (`boardLocked`); lock ≥2 frames to each other (`frameLockGroupId` rigid drag). Fit-to-content stays on under-frame ScanText.
- Schema unchanged.

## Prior: conversations INSERT RETURNING RLS

- **DDL (thinkable, applied via MCP):**
  - Local `20260811225322_conversations_owner_select_for_insert_returning.sql` ↔ remote `20260811225342_conversations_owner_select_for_insert_returning`
  - `conversations` SELECT/UPDATE RLS: allow `auth.uid() = user_id` **or** share rank (fixes INSERT…RETURNING when STABLE `user_board_role_rank` misses the new row)
- App: linked-board content isolation (sole `boardLink` after Turn into Board; strip board name from child body; restore open-menu CSS; repair polluted frames)

## Prior: Page → Board rename

- **DDL (thinkable, applied via MCP):**
  - Local `20260811220510_rename_page_to_board_share_and_ai.sql` ↔ remote `20260811223628_rename_page_to_board_share_and_ai`
  - `page_share_*` → `board_share_*` (tables, `board_id` columns, indexes, triggers, policies)
  - RPCs `user_page_access_role` / `user_page_role_rank` → `user_board_access_role` / `user_board_role_rank` (RLS policies updated)
  - `ai_threads.page_id` → `ai_threads.board_id`
- App: product term **Page → Board** (DEFINITIONS / UI / TipTap `boardLink` dual-read / share API `/api/share/[boardId]`)

## Prior: page share + side-stack snap polish

- **DDL (thinkable, applied via MCP; local filenames differ):**
  - Local `20260811063000_page_share_links_and_people.sql` ↔ remote `20260811103152_page_share_links_and_people`
  - Local `20260811070000_secure_page_share_access.sql` ↔ remote `20260811104322_secure_page_share_access` + `20260811104342_secure_page_share_rls_policies`
  - Tables/helpers: then `page_share_links`, `page_share_people`, hashed tokens, conversation-scoped RLS (renamed in this save)
- Marker `20260811110630_frame_snap_rotate_mates_mid_drag_reshap.sql` (no extra DDL):
  - Snap/stack mates repark live when host upright AABB changes (rotation)
  - Per-side stack trees + nested packs; unlocked drag-away can re-snap to another side/frame same gesture
  - Shape-aware AABB; share UI / APIs shipped with the above DDL

## Prior: frame edge-snap / shapes / rotation

- No DDL. Marker `20260811024400_frame_edge_snap_stack_shapes_rotation.sql`.
- **Frame edge-snap / stack**: snap links frames (line per gap); first Stack locks (`snapLockGroupId`); Open stack + directional arrows + Lock on the line menu; unlock then drag-away delinks.
- **Frames as shapes** + upright blue AABB resize chrome; blocks/shape rotate inside (no double fill).
- Nested TipTap frames removed; legacy HTML unwraps on load.
- Schema unchanged.

## Prior: AI composer + Quiz me

- No DDL. Marker `20260810143604_ai_composer_plus_quiz_me.sql`.
- **AI composer chrome**: Ask↔Edit click-toggle in the input row (Scroll↔Zoom pattern); **+** menu (search, skills, File, Connection) portaled above the overflow shell; skills include Summarize / Tasks / Search board / **Quiz me** (Ask removed from + menu).
- Schema unchanged.

## Prior: AI Edit create frames checklist

- No DDL. Marker `20260810141615_ai_edit_create_frames_checklist.sql`.
- **AI Edit create frames + threads**: Edit mode can insert frames and `panel_edges` near viewport center (pending rainbow marks); Save keeps / Remove deletes.
- Prefer **edits** over duplicate creates for follow-ups; `capabilityGap` waits for user confirm before approximating unsupported asks (e.g. real tables → checklist offer).
- Markdown checklists/pipe-tables → TipTap **taskList** (`lib/ai/markdown-to-tiptap.ts`); pending marks only wrap p/h so taskItem chrome stays intact; checklist CSS alignment + per-item ⋮⋮ handles.
- Top-bar Sparkles AI-origin toggle shown only when the board has AI-origin content.
- Persisted via existing `messages` / `panel_edges` / `ai_action_log` — schema unchanged.

## Prior: AI Edit review session

- No DDL. Marker `20260810132851_ai_edit_review_session.sql`.
- **AI Edit review UX**: Ask/Edit modes; surgical `replacements`; in-memory pending proposals (DB keeps original until Save); TipTap `aiPending` / `aiOrigin` marks; bottom review bar (eye / Remove / Save); rainbow frame glow; soft ⋮⋮ grip tint; optimistic message-cache patch so Save/Remove survive refetch races.
- Persisted via existing `messages.content` + `ai_action_log` — schema unchanged.

## Prior: AI copilot foundation

- **DDL** `20260810020000_ai_copilot_foundation.sql` applied on thinkable:
  - `ai_threads` — universal per-user sidebar chats (`board_id` filter association; was `page_id`)
  - `ai_messages` — Ask/Plan/Edit turns (never board frames)
  - `ai_context_snapshots` — reusable context packs
  - `ai_action_log` — future Edit/Plan undo via edit-past-chat
- App: sidebar Ask streaming (`/api/ai/*`), drag chat blocks onto board, edit-to-rewind, snapshots, `lib/ai/*` mode/skill/agent stubs
