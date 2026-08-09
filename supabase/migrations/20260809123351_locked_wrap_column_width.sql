-- Frontend-only marker (no schema change).
-- Locked wrapped frames: fixed `wrapColWidth` (unscaled columns) persisted in
-- message metadata so proportional resize scales text with ZERO character reflow,
-- and unwrap -> rewrap returns to the same wrap point set while unlocked.
-- Persisted via existing messages.metadata jsonb (metadata.wrapColWidth) — no DDL.
select 1;
