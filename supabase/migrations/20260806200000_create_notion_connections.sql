-- Store per-user Notion OAuth tokens for bidirectional sync (service-role access only)
CREATE TABLE IF NOT EXISTS notion_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Row id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Thinktable owner
  access_token TEXT NOT NULL, -- Notion OAuth access token (secret)
  refresh_token TEXT, -- Notion refresh token when issued
  workspace_id TEXT, -- Notion workspace id from token response
  workspace_name TEXT, -- Human-readable workspace name for UI
  workspace_icon TEXT, -- Workspace icon URL or emoji if provided
  bot_id TEXT, -- Notion bot id for this installation
  duplicated_template_id TEXT, -- Template page id if user duplicated a template
  owner JSONB, -- Owner object from Notion token response
  raw_token_response JSONB, -- Full token payload for forward-compat fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- First connect time
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last token refresh / reconnect
  CONSTRAINT notion_connections_user_id_unique UNIQUE (user_id) -- One Notion install per user for MVP
);

-- Fast lookup by Thinktable user
CREATE INDEX IF NOT EXISTS idx_notion_connections_user_id ON notion_connections(user_id);

-- Lock down: enable RLS with no policies so anon/authenticated cannot read tokens
ALTER TABLE notion_connections ENABLE ROW LEVEL SECURITY;

-- Keep updated_at current on row changes
CREATE OR REPLACE FUNCTION update_notion_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW; -- Continue with modified row
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notion_connections_updated_at ON notion_connections;
CREATE TRIGGER notion_connections_updated_at
  BEFORE UPDATE ON notion_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_notion_connections_updated_at();
