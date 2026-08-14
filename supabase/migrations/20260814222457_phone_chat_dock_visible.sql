-- Frontend-only marker (no schema change).
-- Phone AI chat dock was invisible under max-width 899px because
-- globals.css hid all [data-chat-sidebar] (including the map dock).
-- Narrow the rule to :not([data-chat-map-dock]); portal dock onto
-- [data-board-root]; restore RF Node type-only import (instanceof crash).
-- Schema unchanged.
select 1;
