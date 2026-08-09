-- Thread path data (control points, dotted flag, algorithm) for Miro-style editable edges
ALTER TABLE panel_edges
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow updating reconnect targets + path metadata
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'panel_edges'
      AND policyname = 'Users can update their own edges'
  ) THEN
    CREATE POLICY "Users can update their own edges"
      ON panel_edges
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
