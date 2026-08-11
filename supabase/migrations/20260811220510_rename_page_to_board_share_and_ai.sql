-- Rename Thinktable Page → Board share schema + AI thread association column.
-- Historical migrations keep old names; this cutover renames live objects.

-- ---------------------------------------------------------------------------
-- Share tables: page_share_* → board_share_*
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS page_share_links RENAME TO board_share_links;
ALTER TABLE IF EXISTS page_share_people RENAME TO board_share_people;
ALTER TABLE IF EXISTS page_share_redeem_attempts RENAME TO board_share_redeem_attempts;

ALTER TABLE board_share_links RENAME COLUMN page_id TO board_id;
ALTER TABLE board_share_people RENAME COLUMN page_id TO board_id;
ALTER TABLE board_share_redeem_attempts RENAME COLUMN page_id TO board_id;

-- Constraints / indexes (rename where Postgres keeps old names after table rename)
ALTER TABLE board_share_links RENAME CONSTRAINT page_share_links_role_check TO board_share_links_role_check;
ALTER TABLE board_share_people RENAME CONSTRAINT page_share_people_role_check TO board_share_people_role_check;
ALTER TABLE board_share_people RENAME CONSTRAINT page_share_people_target_check TO board_share_people_target_check;

ALTER INDEX IF EXISTS idx_page_share_links_token_hash RENAME TO idx_board_share_links_token_hash;
ALTER INDEX IF EXISTS idx_page_share_links_page_id RENAME TO idx_board_share_links_board_id;
ALTER INDEX IF EXISTS idx_page_share_people_page_id RENAME TO idx_board_share_people_board_id;
ALTER INDEX IF EXISTS idx_page_share_people_page_email RENAME TO idx_board_share_people_board_email;
ALTER INDEX IF EXISTS idx_page_share_people_page_notion RENAME TO idx_board_share_people_board_notion;
ALTER INDEX IF EXISTS idx_page_share_people_grantee RENAME TO idx_board_share_people_grantee;
ALTER INDEX IF EXISTS idx_page_share_people_email_lower RENAME TO idx_board_share_people_email_lower;
ALTER INDEX IF EXISTS idx_page_share_redeem_attempts_user_time RENAME TO idx_board_share_redeem_attempts_user_time;
ALTER INDEX IF EXISTS idx_page_share_redeem_attempts_ip_time RENAME TO idx_board_share_redeem_attempts_ip_time;

-- Triggers / updated_at helpers
DROP TRIGGER IF EXISTS page_share_links_updated_at ON board_share_links;
DROP TRIGGER IF EXISTS page_share_people_updated_at ON board_share_people;

CREATE OR REPLACE FUNCTION update_board_share_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_board_share_people_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS update_page_share_links_updated_at();
DROP FUNCTION IF EXISTS update_page_share_people_updated_at();

CREATE TRIGGER board_share_links_updated_at
  BEFORE UPDATE ON board_share_links
  FOR EACH ROW
  EXECUTE FUNCTION update_board_share_links_updated_at();

CREATE TRIGGER board_share_people_updated_at
  BEFORE UPDATE ON board_share_people
  FOR EACH ROW
  EXECUTE FUNCTION update_board_share_people_updated_at();

-- Owner policies (recreate with new table/column names)
DROP POLICY IF EXISTS "Owners manage their page share links" ON board_share_links;
CREATE POLICY "Owners manage their board share links"
  ON board_share_links FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = board_share_links.board_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = board_share_links.board_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners manage their page share people" ON board_share_people;
CREATE POLICY "Owners manage their board share people"
  ON board_share_people FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = board_share_people.board_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = board_share_people.board_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Grantees can view their own page share grants" ON board_share_people;
CREATE POLICY "Grantees can view their own board share grants"
  ON board_share_people FOR SELECT
  USING (
    grantee_user_id = auth.uid()
    OR (
      email IS NOT NULL
      AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = board_share_people.board_id AND c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Access RPCs: user_page_* → user_board_*
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_board_access_role(p_board_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid(); -- Current user
  v_email TEXT; -- Confirmed JWT email (lowered)
  v_role TEXT; -- Best matching grant role
BEGIN
  IF v_uid IS NULL OR p_board_id IS NULL THEN
    RETURN NULL; -- Anonymous / invalid
  END IF;

  -- Board owner always wins
  IF EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_board_id AND c.user_id = v_uid
  ) THEN
    RETURN 'owner';
  END IF;

  v_email := lower(COALESCE(auth.jwt() ->> 'email', '')); -- Email from JWT

  SELECT p.role INTO v_role
  FROM board_share_people p
  WHERE p.board_id = p_board_id
    AND (
      p.grantee_user_id = v_uid
      OR (v_email <> '' AND p.email IS NOT NULL AND lower(p.email) = v_email)
    )
  ORDER BY CASE p.role
    WHEN 'edit' THEN 3
    WHEN 'comment' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END DESC
  LIMIT 1; -- Strongest grant wins

  RETURN v_role; -- May be NULL
END;
$$;

REVOKE ALL ON FUNCTION public.user_board_access_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_board_access_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_board_role_rank(p_board_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.user_board_access_role(p_board_id)
    WHEN 'owner' THEN 4
    WHEN 'edit' THEN 3
    WHEN 'comment' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.user_board_role_rank(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_board_role_rank(UUID) TO authenticated;

-- Point RLS policies at the new rank helper
DROP POLICY IF EXISTS "Users can view accessible conversations" ON conversations;
CREATE POLICY "Users can view accessible conversations"
  ON conversations FOR SELECT
  USING (public.user_board_role_rank(id) >= 1);

DROP POLICY IF EXISTS "Users can update editable conversations" ON conversations;
CREATE POLICY "Users can update editable conversations"
  ON conversations FOR UPDATE
  USING (public.user_board_role_rank(id) >= 3)
  WITH CHECK (public.user_board_role_rank(id) >= 3);

DROP POLICY IF EXISTS "Users can view accessible messages" ON messages;
CREATE POLICY "Users can view accessible messages"
  ON messages FOR SELECT
  USING (public.user_board_role_rank(conversation_id) >= 1);

DROP POLICY IF EXISTS "Editors can insert messages" ON messages;
CREATE POLICY "Editors can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_board_role_rank(conversation_id) >= 3
  );

DROP POLICY IF EXISTS "Editors can update messages" ON messages;
CREATE POLICY "Editors can update messages"
  ON messages FOR UPDATE
  USING (public.user_board_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_board_role_rank(conversation_id) >= 3);

DROP POLICY IF EXISTS "Editors can delete messages" ON messages;
CREATE POLICY "Editors can delete messages"
  ON messages FOR DELETE
  USING (public.user_board_role_rank(conversation_id) >= 3);

DROP POLICY IF EXISTS "Users can view accessible edges" ON panel_edges;
CREATE POLICY "Users can view accessible edges"
  ON panel_edges FOR SELECT
  USING (public.user_board_role_rank(conversation_id) >= 1);

DROP POLICY IF EXISTS "Editors can insert edges" ON panel_edges;
CREATE POLICY "Editors can insert edges"
  ON panel_edges FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_board_role_rank(conversation_id) >= 3
  );

DROP POLICY IF EXISTS "Editors can update edges" ON panel_edges;
CREATE POLICY "Editors can update edges"
  ON panel_edges FOR UPDATE
  USING (public.user_board_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_board_role_rank(conversation_id) >= 3);

DROP POLICY IF EXISTS "Editors can delete edges" ON panel_edges;
CREATE POLICY "Editors can delete edges"
  ON panel_edges FOR DELETE
  USING (public.user_board_role_rank(conversation_id) >= 3);

DROP POLICY IF EXISTS "Users can view accessible canvas nodes" ON canvas_nodes;
CREATE POLICY "Users can view accessible canvas nodes"
  ON canvas_nodes FOR SELECT
  USING (public.user_board_role_rank(conversation_id) >= 1);

DROP POLICY IF EXISTS "Editors can insert canvas nodes" ON canvas_nodes;
CREATE POLICY "Editors can insert canvas nodes"
  ON canvas_nodes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_board_role_rank(conversation_id) >= 3
  );

DROP POLICY IF EXISTS "Editors can update canvas nodes" ON canvas_nodes;
CREATE POLICY "Editors can update canvas nodes"
  ON canvas_nodes FOR UPDATE
  USING (public.user_board_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_board_role_rank(conversation_id) >= 3);

DROP POLICY IF EXISTS "Editors can delete canvas nodes" ON canvas_nodes;
CREATE POLICY "Editors can delete canvas nodes"
  ON canvas_nodes FOR DELETE
  USING (public.user_board_role_rank(conversation_id) >= 3);

-- Drop legacy RPCs after policies no longer reference them
DROP FUNCTION IF EXISTS public.user_page_role_rank(UUID);
DROP FUNCTION IF EXISTS public.user_page_access_role(UUID);

-- ---------------------------------------------------------------------------
-- AI threads: page_id → board_id
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS ai_threads RENAME COLUMN page_id TO board_id;
ALTER INDEX IF EXISTS idx_ai_threads_page_id RENAME TO idx_ai_threads_board_id;
