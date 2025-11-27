# Update Email Template Now

## Quick Method (2 steps)

### Step 1: Get Your Access Token

1. Go to: https://supabase.com/dashboard/account/tokens
2. Click **"Generate new token"** (if you don't have one)
3. Give it a name: "Email Template Update"
4. Copy the token

### Step 2: Run the Script

```bash
cd apps/web

# Set your token (replace with actual token)
export SUPABASE_ACCESS_TOKEN="sbp_your-actual-token-here"

# Run the update script
node scripts/update-email-template.mjs
```

That's it! The template will be updated automatically.

## What the Script Does

- Updates the "Confirm signup" email template
- Sets subject to: "Verify your Thinkable account"
- Applies your beautiful gradient HTML design
- Uses Supabase Management API

## Test It

After running the script:
1. Sign up with a new email
2. Check your inbox
3. You should see the beautiful gradient email! ✨

