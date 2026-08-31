-- Frontend-only marker (no schema change).
-- Notion DB: show-more pages 50/copy via per-frame metadata dbVisibleRowCap (not shared by Notion DB id);
-- live table mounts only after a row click (frame select stays static); that row is seeded hydrated.
-- Preview defaults to 12 rows; Expanded seeds that frame to 50; duplicate clears dbVisibleRowCap.
-- Schema unchanged.
select 1;
