-- Frontend-only marker (no schema change).
-- Phone: unselected frames nodrag + hold-then-drag (`lib/phone-unselected-frame-drag.ts`); blue move border via `PhoneFrameDragProvider`.
-- Phone minimap: pointer pan (`lib/minimap-viewport-pan.ts`); `touch-action: none` on minimap; RF MiniMap panHandler ignores touchmove.
-- Schema unchanged.
select 1;
