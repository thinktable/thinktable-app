-- Frontend-only marker (no schema change).
-- On-thread frames: perpendicular drag snaps beside the thread (metadata.onThread offset + normal);
-- live stroke gap/dot follows frame during drag; path sync keyed on geometry not every node tick;
-- constrain drag after helper lines; editor toolbar undo/redo guards destroyed TipTap editors.
-- All state rides existing messages.metadata JSON. Schema unchanged.
select 1;
