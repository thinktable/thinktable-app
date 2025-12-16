-- Create panel_edges table to store connections between panels
-- This table stores edges (connections) between panels in a conversation
-- Each edge connects two panels via their source message IDs

CREATE TABLE IF NOT EXISTS panel_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  target_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Prevent duplicate edges between the same panels
  UNIQUE(source_message_id, target_message_id)
);

-- Create index on conversation_id for fast lookups when loading edges for a conversation
CREATE INDEX IF NOT EXISTS idx_panel_edges_conversation_id ON panel_edges(conversation_id);

-- Create index on user_id for RLS performance
CREATE INDEX IF NOT EXISTS idx_panel_edges_user_id ON panel_edges(user_id);

-- Enable Row Level Security
ALTER TABLE panel_edges ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own edges
CREATE POLICY "Users can view their own edges"
  ON panel_edges
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can create their own edges
CREATE POLICY "Users can create their own edges"
  ON panel_edges
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own edges
CREATE POLICY "Users can delete their own edges"
  ON panel_edges
  FOR DELETE
  USING (auth.uid() = user_id);





