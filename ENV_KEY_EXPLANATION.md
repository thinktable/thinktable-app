# Understanding Supabase API Keys

## Key Types

### 1. **Publishable Key** (Client-Side)
- **Variable name**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- **Format**: Starts with `sb_publishable_...`
- **Usage**: Safe to expose in browser/client-side code
- **Can do**: Read/write data (subject to RLS), sign up, sign in
- **Cannot do**: Admin operations (delete users, bypass RLS)

### 2. **Secret Key** (Server-Side Only - NEW)
- **Variable name**: `SUPABASE_SECRET_KEY`
- **Format**: Starts with `sb_secret_...`
- **Usage**: Server-side only, NEVER expose in client code!
- **Can do**: Everything publishable can do + admin operations
- **Required for**: Account deletion, admin user management

### 3. **Service Role Key** (Server-Side Only - LEGACY)
- **Variable name**: `SUPABASE_SERVICE_ROLE_KEY`
- **Format**: JWT token starting with `eyJ...`
- **Usage**: Server-side only, legacy format
- **Can do**: Same as secret key
- **Status**: Still works but Supabase recommends using secret key instead

## For Account Deletion

You need **ONE** of these in your `.env.local`:

```env
# Option 1: New secret key (recommended)
SUPABASE_SECRET_KEY=sb_secret_your-actual-key-here

# Option 2: Legacy service_role key (also works)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**NOT** the publishable key - that won't work for admin operations!

## How to Get Your Secret Key

1. Go to: https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/settings/api-keys
2. Click **"Create new API Keys"** (if you don't have one)
3. Copy the **Secret key** (starts with `sb_secret_`)
4. Add to `.env.local`:
   ```env
   SUPABASE_SECRET_KEY=sb_secret_paste-your-key-here
   ```
5. **RESTART YOUR SERVER** (very important!)

## Your Current Setup

Based on your message, you might have:
- ✅ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Good for client-side
- ❌ Missing `SUPABASE_SECRET_KEY` - Needed for account deletion
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Should work if you have this

The code checks for `SUPABASE_SECRET_KEY` first, then falls back to `SUPABASE_SERVICE_ROLE_KEY`.

## Debugging

After adding the key and restarting, check your server console when clicking "Delete Account". You should see:

```
🔍 Supabase env vars found: [...]
🔍 Looking for: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
🔍 SUPABASE_SECRET_KEY exists: true/false
🔍 SUPABASE_SERVICE_ROLE_KEY exists: true/false
```

This will tell you exactly which keys the server can see.

