# Delete Account Setup

## Issue

If you're seeing the error: "Account deletion requires SUPABASE_SECRET_KEY..."

This means the Supabase secret key is not set in your `.env.local` file.

## Solution

Add the Supabase secret key to your `.env.local` file:

```env
SUPABASE_SECRET_KEY=sb_secret_your-secret-key-here
```

## How to Get the Secret Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/_/settings/api-keys
2. Click **"Create new API Keys"** (if you don't have one yet)
3. Copy the **Secret key** - it starts with `sb_secret_`
4. Add it to your `.env.local` file as `SUPABASE_SECRET_KEY`

**Note**: The secret key (`sb_secret_...`) is the new recommended format from Supabase, replacing the legacy `service_role` key. It provides the same admin capabilities with better security features.

## Important Notes

⚠️ **Never expose this key in client-side code!**

- This key has admin privileges and can bypass Row Level Security
- Only use it in server-side API routes
- Never commit it to git (it's already in `.gitignore`)

## After Adding the Key

1. Add the key to `.env.local`
2. **Restart your Next.js dev server** (the server needs to restart to pick up new env vars)
3. Try deleting the account again

## Testing

Once the key is set:
1. Go to `/app`
2. Scroll to the bottom of the sidebar
3. Click "Delete Account"
4. Confirm deletion
5. Account should be deleted and you'll be signed out

