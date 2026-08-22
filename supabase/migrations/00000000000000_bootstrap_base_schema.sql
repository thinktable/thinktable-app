-- Bootstrap base schema (foundational tables the incremental migrations build on).
-- Why: the original `create_saas_schema` migration was never committed to this repo,
-- so a fresh `supabase db reset` had no `conversations`/`messages`/`profiles`/`projects`
-- to reference and failed on the first real migration. This file recreates just enough
-- of that foundation (idempotently) so the local stack builds end-to-end. It is safe to
-- re-run and safe against a remote that already has these objects (IF NOT EXISTS + guarded
-- policies), and later migrations replace these owner-only policies with the shared-access ones.

-- gen_random_uuid() + digest() used by base + later migrations
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generic updated_at stamper reused by several base tables
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW(); -- Refresh timestamp on every UPDATE
  RETURN NEW;             -- Continue with the write
END;
$$;

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users; auto-provisioned on signup via trigger below
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, -- 1:1 with auth user
  email TEXT,                                                      -- Cached email for UI
  full_name TEXT,                                                  -- Display name
  avatar_url TEXT,                                                 -- Profile picture URL
  subscription_tier TEXT NOT NULL DEFAULT 'free',                  -- free | pro | enterprise
  stripe_customer_id TEXT,                                         -- Stripe linkage
  stripe_subscription_id TEXT,                                     -- Stripe linkage
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                     -- App-read per-user prefs/flags
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),                   -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()                    -- Last change
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; -- Users see only their own row

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create a profile row whenever a new auth user is inserted (app never inserts it)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name', -- Present when signup passes options.data.full_name
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING; -- Idempotent if profile already exists
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects — sidebar folders that group boards (board membership lives in
-- conversations.metadata.project_id, so no FK column here)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                 -- Project id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner
  name TEXT NOT NULL DEFAULT 'Untitled',                         -- Display name
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                   -- position, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),                 -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()                  -- Last change
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
CREATE POLICY "Users can create own projects"
  ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- conversations — a "board". Owner-only policies here; later migrations swap
-- these for shared-access policies (they DROP these exact policy names).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                 -- Board id
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Owner
  title TEXT NOT NULL DEFAULT 'Untitled',                        -- Board title
  parent_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE, -- Nested boards
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                   -- project_id, position, icon, ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),                 -- Created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()                  -- Last change
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_parent_id ON public.conversations(parent_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversations" ON public.conversations;
CREATE POLICY "Users can view own conversations"
  ON public.conversations FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own conversations" ON public.conversations;
CREATE POLICY "Users can create own conversations"
  ON public.conversations FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;
CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own conversations" ON public.conversations;
CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS conversations_updated_at ON public.conversations;
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- messages — frames within a board. Owner-only policies here; later migrations
-- swap these for conversation-scoped shared-access policies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                 -- Frame / message id
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE, -- Board
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Author
  role TEXT NOT NULL DEFAULT 'user',                             -- user | assistant | system
  content TEXT NOT NULL DEFAULT '',                             -- Frame body (HTML / text)
  tokens INTEGER NOT NULL DEFAULT 0,                            -- Optional token count
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- position, block info, flags
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()                 -- Created
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages"
  ON public.messages FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own messages" ON public.messages;
CREATE POLICY "Users can create own messages"
  ON public.messages FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own messages" ON public.messages;
CREATE POLICY "Users can update own messages"
  ON public.messages FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;
CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE USING (auth.uid() = user_id);
