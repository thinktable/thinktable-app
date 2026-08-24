-- Frontend-only marker (no schema change).
-- Draw bar: freehand lasso select (own SVG trail, implicit closed loop, partial-overlap hits);
-- Insert space (vertical/horizontal armed tools) drags a gap open and persists shifted node positions;
-- Thread menu Insert frame: frame rides the thread path (metadata.onThread + thread-path-geometry);
-- Property icons/connections paint inside the frame fill with hug caps.
-- All state rides existing messages.metadata / panel_edges.metadata JSON. Schema unchanged.
select 1;
