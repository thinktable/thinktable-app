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



