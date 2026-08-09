-- Frontend-only marker (no schema change).
-- Thread stroke / dash / control knobs use grip comfort scale
-- threadComfortScale(zoom) = 1/max(1,√zoom) so lines thin on zoom-out
-- instead of staying fat via full 1/zoom. Hit band stays ×1/zoom.
-- All via client UI — no DDL.
select 1;
