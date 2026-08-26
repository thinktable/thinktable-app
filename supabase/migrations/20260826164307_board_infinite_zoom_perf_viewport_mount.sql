-- Frontend-only marker (no schema change).
-- Infinite board: soft bounds + dynamic zoom range (`lib/board-extent.ts`); spatial viewport mount (`lib/board-spatial-index.ts`, `frame-viewport-mount-context.tsx`).
-- Zoom band 5%–200% via `clampBoardZoom`; custom pinch/wheel/Safari paths honor limits (not hardcoded 0.1/2).
-- Frame drag perf: `lib/frame-dragging.ts`, `lib/board-navigating.ts`; skip O(n) effects mid-drag; EditableThread/helper-lines equality; semantic zoom below 40%.
-- Image blocks: crop menu/view (`image-block-menu.tsx`, `lib/tiptap/image-block-crop.ts`).
-- Schema unchanged.
select 1;
