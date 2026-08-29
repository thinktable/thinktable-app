-- Frontend-only marker (no schema change).
-- Notion DB tables: render only the selected layout (gallery/board/calendar were built and discarded
-- on every table render, 212ms of a 229ms render), window columns against the viewport via the <th>
-- probes, hydrate one row on hover, and keep the live table mounted across pan/drag.
-- Cold frames replay the live frame's own sanitized DOM; live editors mount on interaction, not proximity.
-- Supabase client is a singleton with coalesced GETs and a memoized auth.getUser().
-- Schema unchanged.
select 1;
