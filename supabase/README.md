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



