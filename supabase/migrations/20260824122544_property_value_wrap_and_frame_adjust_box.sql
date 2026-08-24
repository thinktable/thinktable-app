-- Frontend-only marker (no schema change).
-- Property values never ellipsize: cell is a `<textarea>` that follows the frame wrap mode
--   (fit-to-text = one nowrap line at measured glyph width; wrap = `pre-wrap` + fit height).
-- Row-card hug: nowrap reads the cell's own width; wrap returns `contentFit.offsetWidth` (fixed point).
-- Connections strip is the last block inside the fill; blue adjust box reserves no top/bottom band.
-- Snap/stack geometry moved to upright adjust boxes (`lib/frame-adjust-box.ts`).
-- Schema unchanged.
select 1;
