# Homepage Board Setup

The homepage displays a public, read-only board that can be edited by admins in the dashboard.

## Architecture

- **Homepage**: Read-only view of the homepage board (no topbar, no editing)
- **Dashboard**: Full editing interface at `/board/[homepage-board-id]`
- **System User**: Special user account that owns the homepage board
- **Service Role**: Used to fetch the board publicly (bypasses RLS)

## Setup Steps

### 1. Create System User Account

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add user" → "Create new user"
3. Create a user with email: `system@thinktable.com` (or your preferred system email)
4. Set a secure password (store it securely, you'll need it to edit)
5. Note the user ID (you'll need this)

### 2. Create Homepage Board

1. Log in to your app as the system user (`system@thinktable.com`)
2. Navigate to `/board` (or create a new board)
3. Build your homepage content using the ThinkTable chat interface
4. Once you're happy with the content, copy the board's UUID from the URL: `/board/[uuid]`

### 3. Configure Environment Variables

Add to your `.env.local` (and `.env.production`):

```env
# Homepage Board ID (NEXT_PUBLIC_ prefix for client-side access)
NEXT_PUBLIC_HOMEPAGE_BOARD_ID=your-homepage-board-uuid-here

# Supabase Secret Key (required for API route that fetches homepage board)
SUPABASE_SECRET_KEY=sb_secret_your-secret-key-here
```

### 4. Create Public RLS Policy (Required)

The homepage board needs to be publicly readable. Create an RLS policy in Supabase:

1. Go to Supabase Dashboard → Authentication → Policies
2. Select the `conversations` table
3. Click "New Policy" → "For full customization"
4. Name: `public_homepage_read`
5. Policy definition:
   ```sql
   -- Allow public read access to homepage board
   CREATE POLICY "public_homepage_read" ON conversations
     FOR SELECT
     USING (id::text = current_setting('app.homepage_board_id', true));
   ```

   OR use metadata-based approach:
   ```sql
   CREATE POLICY "public_homepage_read" ON conversations
     FOR SELECT
     USING (metadata->>'is_homepage' = 'true');
   ```

6. Also create policy for `messages` table:
   ```sql
   CREATE POLICY "public_homepage_messages_read" ON messages
     FOR SELECT
     USING (
       conversation_id IN (
         SELECT id FROM conversations 
         WHERE metadata->>'is_homepage' = 'true'
       )
     );
   ```

   And for `panel_edges`:
   ```sql
   CREATE POLICY "public_homepage_edges_read" ON panel_edges
     FOR SELECT
     USING (
       conversation_id IN (
         SELECT id FROM conversations 
         WHERE metadata->>'is_homepage' = 'true'
       )
     );
   ```

### 5. Mark Board as Homepage

1. In Supabase Dashboard → Table Editor → `conversations`
2. Find your homepage board
3. Update the `metadata` JSONB field:
   ```json
   {
     "is_homepage": true
   }
   ```

This makes it easier to find and allows the RLS policy to work.

### 5. Restart Server

After adding environment variables, restart your development server:

```bash
npm run dev
```

## Editing the Homepage

To edit the homepage content:

1. Log in as the system user (`system@thinktable.com`)
2. Navigate to `/board/[homepage-board-id]`
3. Use the full dashboard editing interface (topbar, chat input, etc.)
4. Make your changes
5. Changes will appear on the homepage immediately (read-only view)

## Production Safety

- ✅ Homepage has **no editing interface** (no topbar, no chat input)
- ✅ Homepage is **read-only** (uses BoardFlow in view-only mode)
- ✅ Only system user can edit (must log in to dashboard)
- ✅ No conditional logic that could fail in production

## Troubleshooting

### Homepage shows "Homepage board not configured"

- Check that `NEXT_PUBLIC_HOMEPAGE_BOARD_ID` is set in `.env.local`
- Restart your server after adding the variable
- Verify the UUID is correct (check Supabase conversations table)
- Note: The variable must have `NEXT_PUBLIC_` prefix for client-side access

### Homepage shows "Homepage board not found"

- Verify the board UUID exists in the `conversations` table
- Check that `SUPABASE_SECRET_KEY` is set correctly
- Ensure the board belongs to the system user

### Can't edit homepage board

- Make sure you're logged in as the system user
- Navigate to `/board/[homepage-board-id]` (not just `/board`)
- Verify you have the correct board ID

## API Route

The homepage board is fetched via `/api/homepage-board` which:
- Uses Supabase service role (bypasses RLS)
- Fetches the board and messages
- Returns JSON for client-side rendering

This route is public (no authentication required) since it only reads the homepage board.

