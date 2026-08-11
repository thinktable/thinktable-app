# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-11T23:14:05Z`
- Source: local `supabase/migrations/` + remote `list_migrations` (thinkable) + `.temp` service versions
- Service versions (from `supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.195.0`, rest `v13.0.5`, storage `v1.68.1`
- Remote applied tops out at `20260811225342_conversations_owner_select_for_insert_returning`

## This save

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
