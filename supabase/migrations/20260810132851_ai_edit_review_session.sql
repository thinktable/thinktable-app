-- Frontend-only marker (no schema change).
-- AI Edit mode review UX: in-memory pending proposals (DB original until Save),
-- surgical replacements, TipTap aiPending/aiOrigin marks, review bar (eye /
-- remove / save), rainbow frame glow + soft ⋮⋮ grip tint, optimistic message
-- cache patch so Save/Remove survive refetch races.
-- Relies on existing ai_* tables from 20260810020000_ai_copilot_foundation.
-- Schema unchanged.
select 1;
