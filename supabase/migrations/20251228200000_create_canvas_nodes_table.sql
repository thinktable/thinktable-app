-- Create canvas_nodes table to store freehand drawings and other canvas elements
-- This table stores non-message nodes (like freehand drawings) that belong to a conversation/board
CREATE TABLE IF NOT EXISTS canvas_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique node ID (matches React Flow node.id)
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, -- Board/conversation this node belongs to
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner of the node
  node_type TEXT NOT NULL DEFAULT 'freehand', -- Type of canvas node (e.g., 'freehand', 'shape', etc.)
  position_x DOUBLE PRECISION NOT NULL, -- X position in flow coordinates
  position_y DOUBLE PRECISION NOT NULL, -- Y position in flow coordinates
  width DOUBLE PRECISION NOT NULL, -- Node width
  height DOUBLE PRECISION NOT NULL, -- Node height
  data JSONB NOT NULL DEFAULT '{}'::jsonb, -- Node data (e.g., points array for freehand drawings, initialSize, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Creation timestamp
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Last update timestamp
);

-- Create index on conversation_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_conversation_id ON canvas_nodes(conversation_id);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_user_id ON canvas_nodes(user_id);

-- Create index on node_type for filtering by type
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_node_type ON canvas_nodes(node_type);

-- Enable Row Level Security
ALTER TABLE canvas_nodes ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own canvas nodes
CREATE POLICY "Users can view their own canvas nodes"
  ON canvas_nodes
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own canvas nodes
CREATE POLICY "Users can insert their own canvas nodes"
  ON canvas_nodes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own canvas nodes
CREATE POLICY "Users can update their own canvas nodes"
  ON canvas_nodes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own canvas nodes
CREATE POLICY "Users can delete their own canvas nodes"
  ON canvas_nodes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_canvas_nodes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on row updates
CREATE TRIGGER update_canvas_nodes_updated_at
  BEFORE UPDATE ON canvas_nodes
  FOR EACH ROW
  EXECUTE FUNCTION update_canvas_nodes_updated_at();




