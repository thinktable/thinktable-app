# Supabase Schema Versioning

This directory contains Supabase database schema versioning and migrations.

## Current Schema

The database includes the following tables:

- **profiles** - User profile information
- **conversations** - Chat conversations/boards
- **messages** - Individual messages within conversations
- **embeddings** - Vector embeddings for semantic search
- **subscriptions** - User subscription information
- **usage** - Usage tracking for users

## Migrations

See `migration-list.txt` + `schema-snapshot.md` for the full local/remote snapshot.

Latest on thinkable (DDL):
- `20260811225342_conversations_owner_select_for_insert_returning` (+ local `20260811225322_…`) — conversations SELECT/UPDATE allow owner `user_id` or share rank (INSERT…RETURNING)
- `rename_page_to_board_share_and_ai` / remote `20260811223628_…` (+ local `20260811220510_…`) — `board_share_*`, `user_board_*` RPCs, `ai_threads.board_id`
- `20260811103152_page_share_links_and_people` (+ local `20260811063000_…`) — original share tables (renamed above)
- `20260811104322_secure_page_share_access` / `20260811104342_secure_page_share_rls_policies` (+ local `20260811070000_…`) — hashed tokens + RLS (updated by rename)
- `20260810020000_ai_copilot_foundation` — `ai_threads`, `ai_messages`, `ai_context_snapshots`, `ai_action_log`

Latest local marker (no DDL):
- `20260904134700_chat_thread_scroll_native_clip` — Chat↔chat threads in transcript scroller (scroll-native); content-window clip; sync board-overlay scroll paint
- `20260904051948_chat_turn_multiselect_and_chat_to_chat_threads` — Chat turn multi-select + chat↔chat threads; multi-drag; connect auto-pan fix
- `20260904050604_unify_ai_star_light_blue_lock_frames_icon` — Unify AI sparkle `#b5daf3`; lock-frames toolbar icon 1
- `20260904045406_ai_chat_fork_and_revert_text` — Thread fork (Copy of …) + chat Revert text silos
- `20260904043128_chat_link_cue_click_opens_turn` — Board chat-link cue click opens linked turn; drag still starts thread
- `20260904041502_chat_link_cues_survive_sidebar_close` — Board chat-link cues survive desktop chat close; thread clip under chrome
- `20260904034627_chat_turn_selection_persist_and_link_cue_scale` — Chat turn selection/scroll persist across remount; smaller chat-link cue line
- `20260904033309_chat_thread_clip_stubs_under_chrome` — Chat↔board thread clip stubs + under-chrome / map-side seam clip
- `20260903191644_chat_sidebar_seam_thread_gaps` — Chat sidebar left seam gaps where chat↔board threads cross
- `20260903190337_ai_chat_turns_frame_like` — AI chat turns as frames (select chrome, TipTap ⋮⋮, board drop, boardLinks)
- `20260902180605_db_cold_row_hover_handle_insert` — Cold DB row ⋮⋮ + add-row hairlines on hover without click-warm
- `20260902161220_db_table_rows_setter` — Frame menu Table rows setter (shown/total, Show all, Reset); replaces Preview / Expanded
- `20260902155842_db_show_more_less_preview_full_width` — `+# rows — show more / show less`; idle preview full width / all view-visible columns
- `20260902151646_db_row_warm_inline_caret_no_semantic_zoom` — Inline DB row warm + caret at click; switch rows without nav; remove semantic zoom; keep DB TipTap live mid-nav; retain I-bar after warm
- `20260831173348_notion_db_row_warm_show_more_per_frame` — Notion DB row-click warm + per-frame show-more (50/page); Preview/Expanded; duplicate caps independent
- `20260829201500_db_table_lazy_layouts_column_windowing_cold_frames` — Lazy layouts + column windowing + cold DOM snapshots; live DB stays mounted on pan
- `20260829140859_notion_db_focus_gated_static_preview_boards_multi_select` — Notion DB live table only while frame-selected + always-compact static preview + nav-freeze watchdog; boards nav multi-select with bulk share/move/delete
- `20260827174930_slash_commands_media_board_font_phone_menu` — Slash `/` menu + media blocks + board font; phone keyboard-safe slash menu placement/scroll
- `20260826170715_brand_mark_board_fill_theme_strokes` — Brand mark board-fill disc + border; theme-aware default strokes (map chat toggle + chat sidebar)
- `20260826164307_board_infinite_zoom_perf_viewport_mount` — Infinite board soft bounds + 5%–200% zoom; spatial viewport mount; frame-drag perf + semantic zoom; image-block crop
- `20260824151643_menu_surface_ai_skills_frame_stack_line` — Translucent menu surfaces; menu placement beside host frame; suggest-edits AI skill; frame stack line at connection points
- `20260824122544_property_value_wrap_and_frame_adjust_box` — Property values wrap/nowrap with the frame (no ellipsis); connections strip inside the fill; upright adjust-box snap/stack geometry
- `20260824041824_phone_unselected_frame_drag_minimap_pan` — Phone hold-then-drag unselected frames; minimap touch pan
- `20260824040420_ai_hide_text_and_frame_text_select` — AI hide-text (haze) for flashcards; frame text drag-select fix
- `20260824033903_on_thread_frame_content_center` — On-thread compact chip layout + centered content; visual-size path projection; blocks import fix
- `20260824033035_on_thread_side_flip_drag_commit` — On-thread offset drag commit fix; flip side when crossing thread; live drag anchor; skip block-group drag-stop on thread frames
- `20260824031611_on_thread_perp_drag_toolbar_guard` — On-thread perpendicular drag (offset + dot); live gap during drag; render-storm guard; editor toolbar destroyed-editor undo/redo guard
- `20260824024921_draw_lasso_insert_space_thread_frames` — Freehand lasso select; Insert space drag-to-gap; Insert frame on thread + thickness; property icons inside fill
- `20260823234830_frame_fit_free_restore` — Fit→free restores saved free-resize box; lock snapshots before hug; metadata sync guard
- `20260823233405_property_strip_scroll_db_clip_preview` — Property strip horizontal scroll + …; free-resize DB hover full-table preview; TipTap destroyed-editor guard
- `20260823223134_notion_db_table_perf_scroll` — Notion DB virtualization + pagination; wheel scroll/zoom over selected DB; property block drag
- `20260823024219_property_strip_pagination_tooltips` — Property strip caret paging; icon name tooltips
- `20260821141020_shift_drag_and_cmd_wheel_nav_flip` — Shift+drag pan↔select; Cmd/Ctrl+wheel Scroll↔Zoom; New board title/rename
- `20260820105819_desktop_frame_select_opens_menu` — Desktop frame select opens frame menu; phone tap-after-selected unchanged
- `20260820105152_phone_boards_nav_tap_sticky_tunnel` — Phone boards nav tap/hold + sticky Cloudflare tunnel
- `20260820103736_remove_style_bar_menu_toggle` — Remove Style bar; touch menu no Search autofocus; strip/path tap toggles closed
- `20260820020104_style_bar_labels_and_menus` — Style bar Block/Frame/Thread menus + labels; Layout Threads
- `20260820002722_thread_layout_stack_unstack_restore` — Thread layout stack/unstack restore (magnet independent)
- `20260819233757_thread_layout_snap_pack_stack_line` — Thread layout magnet pack + stack line (no lock)
- `20260819103921_notion_import_picker_recents_cancel` — Notion Import pages Recents/Shared open; Adding/Generating Cancel
- `20260818235211_boards_nav_dismiss_on_board_click` — Boards nav hides on board / outside chrome click
- `20260818013815_card_convert_bring_collapsed_stack` — Card convert bring-along (sub/parent); collapsed stack; peel from table
- `20260818002748_board_nav_notion_db_widths_subtasks` — Board nav freeze; Notion DB column widths/subtasks; cell ellipsis
- `20260817004139_notion_row_card_frame_drag_zindex` — Notion row→card; frame drag zIndex (TipTap NodeViews); DB hug scrollWidth
- `20260816131032_selected_frame_drag_keeps_selection` — Selected frame drag keeps selection; phone all-block ⋮⋮; menu placement
- `20260816045221_frame_screen_chrome_fit_gaps` — Frame screen chrome boost + blue→content gaps + even add-block hairlines
- `20260816040622_screen_relative_frame_chrome` — Screen-relative frame chrome (handles/indicators/rotate/wrap/property/conn/⋮⋮)
- `20260816033714_frame_resize_chrome_connection_indicators` — Frame resize 1:1 chrome (square ring); connection simulators outset; no frame-drag on indicator press
- `20260816031355_connections_properties_block_handles` — Connections strip ⋮⋮ + no add-block hairlines on property/connections grips
- `20260816030739_frame_property_cell_chrome` — Frame property cell chrome (select/hover/I-bar; scale-aligned ⋮⋮)
- `20260815183526_ai_composer_voice_dictation` — AI composer voice-to-text (Whisper; skip BlackHole/virtual mics)
- `20260815175520_phone_board_open_menu_taps` — Phone preview/open/Notion taps on boardLink (caret skip + nodrag + selected reveal)
- `20260815174523_customize_agent_chat_scroll_chrome` — Customize agent panel; chat scroll/return-to-bottom chrome
- `20260815171425_property_block_header_chat_chrome` — Property header one-block + propertyBlock cells; chat brand beside thread; path/More cutoff; boards-nav pin
- `20260815045351_phone_mode_pill_undo_cluster` — Phone mode pill (tools inside; undo/redo board-fill sibling)
- `20260815012513_phone_zoom_swipe_frame_caret` — Phone Zoom swipe-zoom; selected-frame first-tap caret
- `20260815005933_frame_property_ibar_align` — Frame property chrome + I-bar create align
- `20260815001725_menu_flyouts_always_right` — Menu flyouts always right of parent; lock card on flyout open
- `20260815000653_turn_into_menu_frame_block_chrome` — Turn into Format/Property tabs; Block/Frame headers; menu row visibility
- `20260814222457_phone_chat_dock_visible` — Phone AI chat dock visible under 900px (`:not([data-chat-map-dock])`)
- `20260814205759_board_reload_perf_cold_load` — Board cold-load perf (no 500ms poll; homepage probe gated; loading.tsx; RF Node type-import)
- `20260814191420_path_menu_hover_board_load_reveal` — Path-menu hover dwell/fade; board-nav leave grace; frame/chat load reveal
- `20260814181955_top_bar_load_layout_minimap` — Top bar load layout (path shimmer, chat-column measure); minimap expand-up
- `20260814134144_prompt_bars_menu_placement_ibar` — AI prompt bars, chrome-free menu placement, I-bar pane-click slop
- `20260814065945_top_bar_tool_titles` — Mode-bar tool titles + two-stage collapse (Search title hides on field slide-out)
- `20260814063716_view_capture_presentation` — View Capture + Presentation menus (local captures, add-to-chat)
- `20260814042452_top_bar_share_more_image_blocks` — Share/More top-bar chrome + image blocks
- `20260814035712_board_camera_rotation` — Board camera rotation (nav icon/slider, phone twist pinch-lock, Safari trackpad)
- `20260814024128_view_presentation_icon` — View Presentation icon + Layout/View bar rework
- `20260814012801_frame_color_menu_border_slider` — Frame Color menu border size slider
- `20260813233344_board_menu_long_press_draggable_heal` — Board menu + long-press + draggable heal
- `20260813114401_frame_connections_notion` — Frame Connections → Notion (live/manual + footer mark)
- `20260813103833_turn_into_property_pane` — Turn into Property pane + Automations UI
- `20260811110630_frame_snap_rotate_mates_mid_drag_reshap` — snap mates follow rotation AABB; mid-drag re-snap
- `20260811024400_frame_edge_snap_stack_shapes_rotation` — frame edge-snap / stack / shapes / AABB rotation
- `20260810165853_chat_reload_persist_live_context` — chat reload persist + live context pills

Earlier markers:
- `20260810143604_ai_composer_plus_quiz_me` — AI composer + menu / Quiz me skill
- `20260810141615_ai_edit_create_frames_checklist` — AI Edit create frames/threads, checklists, capabilityGap
- `20260810132851_ai_edit_review_session` — AI Edit review UX (pending session / Save-Remove)

Earlier foundation:
- `20251124231547_create_saas_schema` - Initial schema creation
- `20251124231600_fix_function_security` - Security fixes for functions

## Project Information

- **Project ID**: `yhsyhtnnklpkfcpydbst`
- **Project Name**: thinkable
- **Region**: us-east-2
- **Database Version**: PostgreSQL 17.6.1

## Versioning Workflow

1. Make schema changes in Supabase Studio or via SQL
2. Create a migration using Supabase CLI or MCP tools
3. Commit migrations to git
4. Apply migrations to production



