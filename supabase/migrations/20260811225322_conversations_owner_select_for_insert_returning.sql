-- Fix: INSERT…RETURNING on conversations failed RLS because SELECT only used
-- STABLE user_board_role_rank(), which often cannot see the row being inserted.
-- Owners must always be able to SELECT (and UPDATE) their own boards directly.

DROP POLICY IF EXISTS "Users can view accessible conversations" ON conversations;
CREATE POLICY "Users can view accessible conversations"
  ON conversations FOR SELECT
  USING (
    auth.uid() = user_id -- Owner path (required for INSERT…RETURNING)
    OR public.user_board_role_rank(id) >= 1 -- Shared view/comment/edit
  );

DROP POLICY IF EXISTS "Users can update editable conversations" ON conversations;
CREATE POLICY "Users can update editable conversations"
  ON conversations FOR UPDATE
  USING (
    auth.uid() = user_id -- Owner path
    OR public.user_board_role_rank(id) >= 3 -- Shared editors
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.user_board_role_rank(id) >= 3
  );
