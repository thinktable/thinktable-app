# Removing Duplicate Emails

## Issue

You're receiving **two verification emails**:
1. Supabase email (via Resend SMTP) - "Confirm Your Signup"
2. Custom Resend API email - "Verify your Thinkable account"

## Why This Happens

- ✅ Supabase is configured to send emails through Resend SMTP (working!)
- ⚠️ Your code is ALSO calling the Resend API directly (duplicate!)

## Solution

Since Supabase is now handling emails through Resend SMTP, you don't need the custom Resend API code anymore.

### What Was Removed

1. **Removed from `app/signup/page.tsx`:**
   - The `fetch('/api/auth/send-verification')` call
   - This was sending a duplicate email

### What You Can Keep (Optional)

The following files are no longer needed but can be kept for reference:
- `app/api/auth/send-verification/route.ts` - Custom Resend API route
- `lib/resend.ts` - Resend utility functions

You can delete these later if you want to clean up, but they won't cause issues if left alone.

## Result

Now you'll only receive **one email** from Supabase (sent through Resend SMTP):
- ✅ Professional email from `onboarding@resend.dev`
- ✅ Supabase handles the verification flow
- ✅ No duplicates!

## Next Steps

1. **Test signup** - You should now only get one email
2. **Customize email templates** (optional):
   - Go to: https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/auth/templates
   - Customize the "Confirm signup" template
   - Use Resend's email styling

3. **When you get your domain:**
   - Verify domain in Resend
   - Update Supabase SMTP sender email to `noreply@yourdomain.com`
   - That's it!



