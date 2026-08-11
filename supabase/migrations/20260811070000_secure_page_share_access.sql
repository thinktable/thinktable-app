-- Secure page sharing: hashed link tokens, access-role helper, conversation-scoped RLS

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- SHA-256 for token_hash backfill

-- ---------------------------------------------------------------------------
-- Hash share tokens at rest (plaintext never stored after mint)
-- ---------------------------------------------------------------------------
ALTER TABLE page_share_links
  ADD COLUMN IF NOT EXISTS token_hash TEXT; -- sha256 hex of opaque token

-- Backfill from any legacy plaintext tokens, then drop plaintext
UPDATE page_share_links
SET token_hash = encode(digest(convert_to(token, 'UTF8'), 'sha256'), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

-- Rows without a hash cannot be redeemed; revoke them
UPDATE page_share_links
SET revoked_at = COALESCE(revoked_at, NOW())
WHERE token_hash IS NULL;

ALTER TABLE page_share_links
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE page_share_links
  DROP COLUMN IF EXISTS token; -- Never store recoverable secrets

DROP INDEX IF EXISTS idx_page_share_links_token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_share_links_token_hash
  ON page_share_links (token_hash);

-- Allow multiple active links per role (each Copy mints a fresh token)
DROP INDEX IF EXISTS idx_page_share_links_active_page_role;

CREATE INDEX IF NOT EXISTS idx_page_share_people_grantee
  ON page_share_people (grantee_user_id)
  WHERE grantee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_page_share_people_email_lower
  ON page_share_people (lower(email))
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Redeem attempt log (rate limiting; service-role writes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_share_redeem_attempts (
  id BIGSERIAL PRIMARY KEY, -- Row id
  page_id UUID, -- Target page when known
  user_id UUID, -- Authenticated redeemer
  ip_hash TEXT, -- SHA-256 of client IP (no raw IP stored)
  ok BOOLEAN NOT NULL DEFAULT false, -- Whether redeem succeeded
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Attempt time
);

CREATE INDEX IF NOT EXISTS idx_page_share_redeem_attempts_user_time
  ON page_share_redeem_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_share_redeem_attempts_ip_time
  ON page_share_redeem_attempts (ip_hash, created_at DESC);

ALTER TABLE page_share_redeem_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (admin client) can read/write attempts

-- ---------------------------------------------------------------------------
-- Access role helper (SECURITY DEFINER — fixed search_path)
-- Returns: owner | edit | comment | view | NULL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_page_access_role(p_page_id UUID)
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
  IF v_uid IS NULL OR p_page_id IS NULL THEN
    RETURN NULL; -- Anonymous / invalid
  END IF;

  -- Page owner always wins
  IF EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_page_id AND c.user_id = v_uid
  ) THEN
    RETURN 'owner';
  END IF;

  v_email := lower(COALESCE(auth.jwt() ->> 'email', '')); -- Email from JWT

  SELECT p.role INTO v_role
  FROM page_share_people p
  WHERE p.page_id = p_page_id
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

REVOKE ALL ON FUNCTION public.user_page_access_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_page_access_role(UUID) TO authenticated;

-- Numeric rank for policy comparisons (owner=4 … view=1; none=0)
CREATE OR REPLACE FUNCTION public.user_page_role_rank(p_page_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.user_page_access_role(p_page_id)
    WHEN 'owner' THEN 4
    WHEN 'edit' THEN 3
    WHEN 'comment' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.user_page_role_rank(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_page_role_rank(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- conversations RLS — shared viewers can SELECT; editors UPDATE; owner DELETE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON conversations;
-- Keep insert as owner-create only (policy name preserved if present)
DROP POLICY IF EXISTS "Users can create own conversations" ON conversations;

CREATE POLICY "Users can create own conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view accessible conversations"
  ON conversations FOR SELECT
  USING (public.user_page_role_rank(id) >= 1);

CREATE POLICY "Users can update editable conversations"
  ON conversations FOR UPDATE
  USING (public.user_page_role_rank(id) >= 3)
  WITH CHECK (public.user_page_role_rank(id) >= 3);

CREATE POLICY "Owners can delete conversations"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- messages RLS — conversation-scoped (not row user_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own messages" ON messages;
DROP POLICY IF EXISTS "Users can create own messages" ON messages;
DROP POLICY IF EXISTS "Users can update own messages" ON messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON messages;

CREATE POLICY "Users can view accessible messages"
  ON messages FOR SELECT
  USING (public.user_page_role_rank(conversation_id) >= 1);

CREATE POLICY "Editors can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_page_role_rank(conversation_id) >= 3
  );

CREATE POLICY "Editors can update messages"
  ON messages FOR UPDATE
  USING (public.user_page_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_page_role_rank(conversation_id) >= 3);

CREATE POLICY "Editors can delete messages"
  ON messages FOR DELETE
  USING (public.user_page_role_rank(conversation_id) >= 3);

-- ---------------------------------------------------------------------------
-- panel_edges RLS — conversation-scoped
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own edges" ON panel_edges;
DROP POLICY IF EXISTS "Users can create their own edges" ON panel_edges;
DROP POLICY IF EXISTS "Users can delete their own edges" ON panel_edges;
DROP POLICY IF EXISTS "Users can update their own edges" ON panel_edges;

CREATE POLICY "Users can view accessible edges"
  ON panel_edges FOR SELECT
  USING (public.user_page_role_rank(conversation_id) >= 1);

CREATE POLICY "Editors can insert edges"
  ON panel_edges FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_page_role_rank(conversation_id) >= 3
  );

CREATE POLICY "Editors can update edges"
  ON panel_edges FOR UPDATE
  USING (public.user_page_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_page_role_rank(conversation_id) >= 3);

CREATE POLICY "Editors can delete edges"
  ON panel_edges FOR DELETE
  USING (public.user_page_role_rank(conversation_id) >= 3);

-- ---------------------------------------------------------------------------
-- canvas_nodes RLS — conversation-scoped
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own canvas nodes" ON canvas_nodes;
DROP POLICY IF EXISTS "Users can insert their own canvas nodes" ON canvas_nodes;
DROP POLICY IF EXISTS "Users can update their own canvas nodes" ON canvas_nodes;
DROP POLICY IF EXISTS "Users can delete their own canvas nodes" ON canvas_nodes;

CREATE POLICY "Users can view accessible canvas nodes"
  ON canvas_nodes FOR SELECT
  USING (public.user_page_role_rank(conversation_id) >= 1);

CREATE POLICY "Editors can insert canvas nodes"
  ON canvas_nodes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_page_role_rank(conversation_id) >= 3
  );

CREATE POLICY "Editors can update canvas nodes"
  ON canvas_nodes FOR UPDATE
  USING (public.user_page_role_rank(conversation_id) >= 3)
  WITH CHECK (public.user_page_role_rank(conversation_id) >= 3);

CREATE POLICY "Editors can delete canvas nodes"
  ON canvas_nodes FOR DELETE
  USING (public.user_page_role_rank(conversation_id) >= 3);

-- Grantees may read their own grant rows (for UI); owners still manage all
DROP POLICY IF EXISTS "Grantees can view their own page share grants" ON page_share_people;
CREATE POLICY "Grantees can view their own page share grants"
  ON page_share_people FOR SELECT
  USING (
    grantee_user_id = auth.uid()
    OR (
      email IS NOT NULL
      AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_share_people.page_id AND c.user_id = auth.uid()
    )
  );
