# Supabase schema snapshot

- Project: `yhsyhtnnklpkfcpydbst` (thinkable)
- Snapped at: `2026-08-10T16:58:53Z`
- Source: local `supabase/migrations/` + remote `list_migrations` (thinkable) + `.temp` service versions
- Service versions (from `supabase/.temp`): postgres `17.6.1.052`, gotrue `v2.195.0`, rest `v13.0.5`, storage `v1.68.1`
- Remote applied still tops out at `20260810020000_ai_copilot_foundation` (no new DDL this save)

## This save

- No DDL. Marker `20260810165853_chat_reload_persist_live_context.sql`.
- **Chat reload persistence**: open/closed + active thread id in `localStorage`; hydrate after mount; `GET /api/ai/threads/[id]` restores the same chat.
- **Live context pills**: page / frame / block / text / multi-selection chips with hover previews; skills attach as pills (not pasted prompts).
- Schema unchanged.

## Prior: AI composer + Quiz me

- No DDL. Marker `20260810143604_ai_composer_plus_quiz_me.sql`.
- **AI composer chrome**: Ask↔Edit click-toggle in the input row (Scroll↔Zoom pattern); **+** menu (search, skills, File, Connection) portaled above the overflow shell; skills include Summarize / Tasks / Search page / **Quiz me** (Ask removed from + menu).
- Schema unchanged.

## Prior: AI Edit create frames checklist

- No DDL. Marker `20260810141615_ai_edit_create_frames_checklist.sql`.
- **AI Edit create frames + threads**: Edit mode can insert frames and `panel_edges` near viewport center (pending rainbow marks); Save keeps / Remove deletes.
- Prefer **edits** over duplicate creates for follow-ups; `capabilityGap` waits for user confirm before approximating unsupported asks (e.g. real tables → checklist offer).
- Markdown checklists/pipe-tables → TipTap **taskList** (`lib/ai/markdown-to-tiptap.ts`); pending marks only wrap p/h so taskItem chrome stays intact; checklist CSS alignment + per-item ⋮⋮ handles.
- Top-bar Sparkles AI-origin toggle shown only when the page has AI-origin content.
- Persisted via existing `messages` / `panel_edges` / `ai_action_log` — schema unchanged.

## Prior: AI Edit review session

- No DDL. Marker `20260810132851_ai_edit_review_session.sql`.
- **AI Edit review UX**: Ask/Edit modes; surgical `replacements`; in-memory pending proposals (DB keeps original until Save); TipTap `aiPending` / `aiOrigin` marks; bottom review bar (eye / Remove / Save); rainbow frame glow; soft ⋮⋮ grip tint; optimistic message-cache patch so Save/Remove survive refetch races.
- Persisted via existing `messages.content` + `ai_action_log` — schema unchanged.

## Prior: AI copilot foundation

- **DDL** `20260810020000_ai_copilot_foundation.sql` applied on thinkable:
  - `ai_threads` — universal per-user sidebar chats (`page_id` filter association)
  - `ai_messages` — Ask/Plan/Edit turns (never page frames)
  - `ai_context_snapshots` — reusable context packs
  - `ai_action_log` — future Edit/Plan undo via edit-past-chat
- App: sidebar Ask streaming (`/api/ai/*`), drag chat blocks onto page, edit-to-rewind, snapshots, `lib/ai/*` mode/skill/agent stubs
