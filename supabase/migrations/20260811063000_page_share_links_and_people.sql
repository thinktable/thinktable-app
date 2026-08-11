-- Thinktable page share: role-bearing copy links + people grants (Notion address book / email)

-- ---------------------------------------------------------------------------
-- page_share_links — opaque token URLs that embed view | comment | edit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Row id
  page_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, -- Shared Thinktable page
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner who minted the link
  role TEXT NOT NULL, -- view | comment | edit (permission attached to the link)
  token TEXT NOT NULL, -- Opaque unguessable token used in ?s=
  revoked_at TIMESTAMPTZ, -- Soft revoke; null = active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Mint time
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last rotate / touch
  CONSTRAINT page_share_links_role_check CHECK (role IN ('view', 'comment', 'edit')), -- Known roles only
  CONSTRAINT page_share_links_token_unique UNIQUE (token) -- Tokens must be globally unique
);

-- One active link per page+role (simplifies Copy link UX)
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_share_links_active_page_role
  ON page_share_links (page_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_page_share_links_page_id ON page_share_links(page_id); -- List links for a page
CREATE INDEX IF NOT EXISTS idx_page_share_links_token ON page_share_links(token); -- Resolve inbound ?s=

ALTER TABLE page_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their page share links"
  ON page_share_links FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_share_links.page_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_share_links.page_id AND c.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_page_share_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW; -- Continue
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_share_links_updated_at ON page_share_links;
CREATE TRIGGER page_share_links_updated_at
  BEFORE UPDATE ON page_share_links
  FOR EACH ROW
  EXECUTE FUNCTION update_page_share_links_updated_at();

-- ---------------------------------------------------------------------------
-- page_share_people — invited people (Notion user / email) with a role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_share_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Row id
  page_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, -- Shared Thinktable page
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Inviter (page owner)
  role TEXT NOT NULL, -- view | comment | edit
  email TEXT, -- Invite target email (Notion or typed)
  notion_user_id TEXT, -- Notion person id when picked from workspace
  display_name TEXT, -- Cached name for UI
  avatar_url TEXT, -- Cached avatar for UI
  grantee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Linked Thinktable user when known
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Invite time
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last role change
  CONSTRAINT page_share_people_role_check CHECK (role IN ('view', 'comment', 'edit')), -- Known roles
  CONSTRAINT page_share_people_target_check CHECK (
    email IS NOT NULL OR notion_user_id IS NOT NULL OR grantee_user_id IS NOT NULL
  ) -- At least one identity
);

-- Prefer unique email per page when email present
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_share_people_page_email
  ON page_share_people (page_id, lower(email))
  WHERE email IS NOT NULL;

-- Prefer unique Notion user per page when Notion id present
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_share_people_page_notion
  ON page_share_people (page_id, notion_user_id)
  WHERE notion_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_page_share_people_page_id ON page_share_people(page_id); -- List invites

ALTER TABLE page_share_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their page share people"
  ON page_share_people FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_share_people.page_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = page_share_people.page_id AND c.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_page_share_people_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW; -- Continue
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_share_people_updated_at ON page_share_people;
CREATE TRIGGER page_share_people_updated_at
  BEFORE UPDATE ON page_share_people
  FOR EACH ROW
  EXECUTE FUNCTION update_page_share_people_updated_at();
