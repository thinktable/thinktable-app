# Debugging Environment Variables

## Issue

The delete account feature says the secret key is missing, but you've added keys to `.env.local`.

## Common Causes

### 1. Wrong Variable Name

Make sure you're using the **exact** variable name in `.env.local`:

```env
SUPABASE_SECRET_KEY=sb_secret_your-actual-key-here
```

**NOT:**
- `NEXT_PUBLIC_SUPABASE_SECRET_KEY` (wrong - NEXT_PUBLIC_ is for client-side)
- `SUPABASE_PUBLISHABLE_KEY` (wrong - this is for client-side, not admin)
- `SUPABASE_SECRET` (wrong - missing _KEY)

### 2. Server Not Restarted

**IMPORTANT**: After adding/changing `.env.local`, you MUST restart your dev server:

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

Environment variables are only loaded when the server starts!

### 3. Wrong File Location

Make sure `.env.local` is in the **`apps/web/`** directory, not the root `thinktable/` directory:

```
thinktable/
  apps/
    web/
      .env.local  ← Should be here
      package.json
      ...
```

### 4. File Format Issues

Make sure your `.env.local` file:
- Has no spaces around the `=` sign
- Has no quotes around the value (unless the value itself contains spaces)
- Each variable is on its own line

**Correct:**
```env
SUPABASE_SECRET_KEY=sb_secret_abc123...
```

**Wrong:**
```env
SUPABASE_SECRET_KEY = sb_secret_abc123...  # Spaces around =
SUPABASE_SECRET_KEY="sb_secret_abc123..."  # Quotes (usually OK but not needed)
```

## How to Verify

1. **Check server logs** when you start `npm run dev` - you should see the env vars being logged
2. **Check the delete account API logs** - it will show which env vars it found
3. **Verify the key format**:
   - New secret key: Starts with `sb_secret_`
   - Legacy service_role: Starts with `eyJ` (JWT format)

## Quick Test

Add this to your `.env.local` and restart the server:

```env
# For admin operations (account deletion)
SUPABASE_SECRET_KEY=sb_secret_your-secret-key-from-dashboard

# OR use legacy service_role key:
# SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Then check the server console when clicking "Delete Account" - it will show which keys it found.



