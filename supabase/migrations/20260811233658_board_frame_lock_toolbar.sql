-- Frontend-only marker (no schema change).
-- Top-bar board/frame locks: Lock+FileText pins selected frames to the board
-- (metadata.boardLocked → not draggable); Lock+Square locks ≥2 selected frames
-- to each other (metadata.frameLockGroupId → rigid group drag).
-- Under-frame ScanText remains fit-to-content (frameUnlocked). Schema unchanged.
select 1;
