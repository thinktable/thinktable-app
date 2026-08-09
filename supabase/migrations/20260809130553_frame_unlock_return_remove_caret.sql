-- Frontend-only marker (no schema change).
-- Removed the overflow expand/collapse caret (lock = fit-to-content, unlock = your set shape).
-- Unlock now restores the saved unlocked shape via message metadata:
--   metadata.unlockedFrameSize {width,height} + metadata.unlockedFrameScale
-- captured at lock time and refreshed on unlocked resize-end, so unlock is reversible
-- after a locked proportional resize. Dropped the now-dead metadata.collapsedFrameSize usage.
-- Added a "Frame shape automations" stub entry to the right-click frame menu.
-- All persisted via existing messages.metadata jsonb — no DDL.
select 1;
