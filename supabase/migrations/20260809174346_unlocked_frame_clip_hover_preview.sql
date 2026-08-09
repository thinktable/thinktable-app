-- Frontend-only marker (no schema change).
-- Unlocked frames that clip blocks: soft edge fade (mask-image) so half-cut
-- glyphs dissolve; after ~500ms hover, temporarily unclip to preview the full
-- content (backdrop + raised z-index; leave cancels; saved size unchanged).
-- All via existing messages.metadata / client UI — no DDL.
select 1;
