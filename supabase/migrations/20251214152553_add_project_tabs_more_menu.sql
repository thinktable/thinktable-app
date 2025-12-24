-- Migration: Add more menu button to project tabs with rename and delete functionality
-- Date: 2025-12-14
-- Description: Added UI functionality for project tabs to include a more menu button
--              that allows renaming and deleting projects. No database schema changes required
--              as this uses existing projects table.

-- This migration documents the addition of project management UI features.
-- The projects table already supports name updates and deletions via existing columns.

-- No SQL changes needed - this is a UI feature that uses existing schema:
-- - projects.name (for rename)
-- - projects.id (for delete)
-- - projects.user_id (for authorization)
