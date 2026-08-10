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
- `20260810020000_ai_copilot_foundation` — `ai_threads`, `ai_messages`, `ai_context_snapshots`, `ai_action_log`

Latest local marker (no DDL):
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



