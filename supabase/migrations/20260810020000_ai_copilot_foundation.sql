-- Thinktable AI copilot foundation: universal sidebar threads (separate from page frames)
-- Page frames stay in messages; AI chat lives here so Ask never auto-places on the page.

-- ---------------------------------------------------------------------------
-- ai_threads — universal per-user chat sessions (filterable by page association)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Thread id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner
  title TEXT NOT NULL DEFAULT 'New AI chat', -- Display title in sidebar header
  mode TEXT NOT NULL DEFAULT 'ask', -- ask | plan | edit (Ask live; others reserved)
  page_id UUID REFERENCES conversations(id) ON DELETE SET NULL, -- Optional page association for filter (not ownership)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- agentId, skillIds, connector refs
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last activity
  CONSTRAINT ai_threads_mode_check CHECK (mode IN ('ask', 'plan', 'edit')) -- Known modes only
);

CREATE INDEX IF NOT EXISTS idx_ai_threads_user_id ON ai_threads(user_id); -- List user's threads
CREATE INDEX IF NOT EXISTS idx_ai_threads_page_id ON ai_threads(page_id); -- Filter by page
CREATE INDEX IF NOT EXISTS idx_ai_threads_updated_at ON ai_threads(updated_at DESC); -- Recent first

ALTER TABLE ai_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ai threads"
  ON ai_threads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ai threads"
  ON ai_threads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai threads"
  ON ai_threads FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ai threads"
  ON ai_threads FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_ai_threads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_threads_updated_at ON ai_threads;
CREATE TRIGGER ai_threads_updated_at
  BEFORE UPDATE ON ai_threads
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_threads_updated_at();

-- ---------------------------------------------------------------------------
-- ai_messages — turns inside a thread (never become page frames)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Message id
  thread_id UUID NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE, -- Parent thread
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner (denormalized for RLS)
  role TEXT NOT NULL, -- user | assistant | system | tool
  content TEXT NOT NULL DEFAULT '', -- Text / markdown body
  parts JSONB NOT NULL DEFAULT '[]'::jsonb, -- Structured blocks for drag-to-page
  parent_id UUID REFERENCES ai_messages(id) ON DELETE SET NULL, -- Branching later
  status TEXT NOT NULL DEFAULT 'complete', -- pending | streaming | complete | error
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- model, token usage, edit flags
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Last edit
  CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  CONSTRAINT ai_messages_status_check CHECK (status IN ('pending', 'streaming', 'complete', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_id ON ai_messages(thread_id); -- Load transcript
CREATE INDEX IF NOT EXISTS idx_ai_messages_user_id ON ai_messages(user_id); -- RLS helpers
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON ai_messages(thread_id, created_at ASC); -- Order turns

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ai messages"
  ON ai_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ai messages"
  ON ai_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai messages"
  ON ai_messages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ai messages"
  ON ai_messages FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_ai_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW(); -- Stamp every update
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_messages_updated_at ON ai_messages;
CREATE TRIGGER ai_messages_updated_at
  BEFORE UPDATE ON ai_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_messages_updated_at();

-- ---------------------------------------------------------------------------
-- ai_context_snapshots — reusable context packs anchored to a chat turn
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Snapshot id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner
  thread_id UUID REFERENCES ai_threads(id) ON DELETE SET NULL, -- Origin thread (optional)
  message_id UUID REFERENCES ai_messages(id) ON DELETE SET NULL, -- Anchor turn (optional)
  name TEXT NOT NULL, -- User-facing label
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- page ids, frame excerpts, connector refs, notes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Last rename / payload edit
);

CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_user_id ON ai_context_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_thread_id ON ai_context_snapshots(thread_id);

ALTER TABLE ai_context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ai snapshots"
  ON ai_context_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ai snapshots"
  ON ai_context_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai snapshots"
  ON ai_context_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ai snapshots"
  ON ai_context_snapshots FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_ai_context_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_context_snapshots_updated_at ON ai_context_snapshots;
CREATE TRIGGER ai_context_snapshots_updated_at
  BEFORE UPDATE ON ai_context_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_context_snapshots_updated_at();

-- ---------------------------------------------------------------------------
-- ai_action_log — append-only intents for future Edit/Plan undo via edit-past-chat
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Action id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner
  thread_id UUID NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE, -- Thread that produced the action
  message_id UUID REFERENCES ai_messages(id) ON DELETE SET NULL, -- Assistant/tool turn that issued it
  kind TEXT NOT NULL, -- e.g. create_frame, update_frame (Ask writes none yet)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- Forward intent
  inverse JSONB NOT NULL DEFAULT '{}'::jsonb, -- Undo payload for edit-rewind
  status TEXT NOT NULL DEFAULT 'pending', -- pending | applied | undone | error
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Logged at
  CONSTRAINT ai_action_log_status_check CHECK (status IN ('pending', 'applied', 'undone', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_ai_action_log_thread_id ON ai_action_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_message_id ON ai_action_log(message_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_user_id ON ai_action_log(user_id);

ALTER TABLE ai_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ai actions"
  ON ai_action_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ai actions"
  ON ai_action_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ai actions"
  ON ai_action_log FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ai actions"
  ON ai_action_log FOR DELETE
  USING (auth.uid() = user_id);
