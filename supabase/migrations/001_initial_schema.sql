-- Satisfactory Logistics Database Schema
-- Run this in your Supabase SQL Editor to set up the database

-- ============================================
-- 1. TABLES
-- ============================================

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  avatar_url TEXT
);

-- Games table (stores game saves as JSON)
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT,
  data JSONB,
  share_token TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared games table (tracks who has access to which games)
CREATE TABLE IF NOT EXISTS shared_games (
  id SERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, user_id)
);

-- Shared solvers table (for sharing solver configurations)
CREATE TABLE IF NOT EXISTS shared_solvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy tables (kept for compatibility, may not be used)
CREATE TABLE IF NOT EXISTS factories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factories_users (
  id SERIAL PRIMARY KEY,
  factory_id INTEGER REFERENCES factories(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. AUTO-UPDATE TRIGGER FOR updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'global_name', NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 4. HELPER FUNCTIONS FOR SHARING
-- ============================================

-- Check if share token matches a game
CREATE OR REPLACE FUNCTION share_token_matches_game_id(token TEXT, gid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM games
    WHERE id = gid AND share_token = token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get secure token for a game (only for owner)
CREATE OR REPLACE FUNCTION secure_token_for_game_id(gid UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT share_token FROM games
    WHERE id = gid AND author_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if current user has shared a game
CREATE OR REPLACE FUNCTION has_user_shared_game_id(gid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM shared_games
    WHERE game_id = gid AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if a user is sharing a game with current user
CREATE OR REPLACE FUNCTION is_user_sharing_game_with(uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM shared_games sg
    JOIN games g ON sg.game_id = g.id
    WHERE sg.user_id = auth.uid() AND g.author_id = uid
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is owner of a game (used by RLS to avoid recursion)
CREATE OR REPLACE FUNCTION is_game_owner(gid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM games WHERE id = gid AND author_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get a game by share token (bypasses RLS for share link access)
CREATE OR REPLACE FUNCTION get_game_by_share_token(game_uuid UUID, token TEXT)
RETURNS SETOF games AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM games
  WHERE id = game_uuid AND share_token = token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Join a game as collaborator using share token
CREATE OR REPLACE FUNCTION join_game_by_share_token(game_uuid UUID, token TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  game_exists BOOLEAN;
BEGIN
  -- Verify the game exists and token matches
  SELECT EXISTS (
    SELECT 1 FROM games WHERE id = game_uuid AND share_token = token
  ) INTO game_exists;

  IF NOT game_exists THEN
    RETURN FALSE;
  END IF;

  -- Add user as collaborator
  INSERT INTO shared_games (game_id, user_id)
  VALUES (game_uuid, auth.uid())
  ON CONFLICT (game_id, user_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_solvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE factories_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Authors have full access to own games" ON games;
DROP POLICY IF EXISTS "Users can read shared games" ON games;
DROP POLICY IF EXISTS "Users can update shared games" ON games;
DROP POLICY IF EXISTS "Share token grants read access" ON games;
DROP POLICY IF EXISTS "Users can manage own games" ON games;
DROP POLICY IF EXISTS "Owners can manage collaborators" ON shared_games;
DROP POLICY IF EXISTS "Users can see their shared games" ON shared_games;
DROP POLICY IF EXISTS "Users can leave shared games" ON shared_games;
DROP POLICY IF EXISTS "Users can join via share token" ON shared_games;
DROP POLICY IF EXISTS "Users can manage own shared solvers" ON shared_solvers;
DROP POLICY IF EXISTS "Users can manage own factories" ON factories;
DROP POLICY IF EXISTS "Users can see factory shares" ON factories_users;

-- PROFILES policies
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- GAMES policies (simplified to avoid recursion)
CREATE POLICY "Users can manage own games"
  ON games FOR ALL
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can read shared games"
  ON games FOR SELECT
  TO authenticated
  USING (id IN (SELECT game_id FROM shared_games WHERE user_id = auth.uid()));

CREATE POLICY "Users can update shared games"
  ON games FOR UPDATE
  TO authenticated
  USING (id IN (SELECT game_id FROM shared_games WHERE user_id = auth.uid()));

-- SHARED_GAMES policies (using function to avoid recursion)
CREATE POLICY "Owners can manage collaborators"
  ON shared_games FOR ALL
  TO authenticated
  USING (is_game_owner(game_id))
  WITH CHECK (is_game_owner(game_id));

CREATE POLICY "Users can see their shared games"
  ON shared_games FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can leave shared games"
  ON shared_games FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- SHARED_SOLVERS policies
CREATE POLICY "Users can manage own shared solvers"
  ON shared_solvers FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- FACTORIES policies (legacy)
CREATE POLICY "Users can manage own factories"
  ON factories FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- FACTORIES_USERS policies (legacy)
CREATE POLICY "Users can see factory shares"
  ON factories_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- 6. ENABLE REALTIME
-- ============================================

-- Enable realtime for games table (for collaborative editing)
ALTER PUBLICATION supabase_realtime ADD TABLE games;

-- ============================================
-- 7. INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_games_author_id ON games(author_id);
CREATE INDEX IF NOT EXISTS idx_games_share_token ON games(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_games_game_id ON shared_games(game_id);
CREATE INDEX IF NOT EXISTS idx_shared_games_user_id ON shared_games(user_id);

-- ============================================
-- 8. CREATE PROFILES FOR EXISTING USERS
-- ============================================

-- This ensures any existing auth users get a profile
INSERT INTO profiles (id, username, avatar_url)
SELECT id, raw_user_meta_data->>'global_name', raw_user_meta_data->>'avatar_url'
FROM auth.users
ON CONFLICT (id) DO NOTHING;
