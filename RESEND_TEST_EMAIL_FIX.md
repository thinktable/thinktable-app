# Fix: Resend Test Email Limitation

## The Problem

You're getting a **500 error** when signing up because Resend's test email (`onboarding@resend.dev`) can **only send to your verified Resend account email**.

## The Error

```
450 You can only send testing emails to your own email address (easayani@goalfish.io)
```

## Quick Fix (For Testing)

**Use your verified Resend account email when signing up:**
- ✅ `easayani@goalfish.io` (your verified email - will work)
- ❌ `easayani@gmail.com` (not verified - will fail)

## Permanent Solution

### Option 1: Verify Your Domain in Resend (Recommended)

1. Go to: https://resend.com/domains
2. Click "Add Domain"
3. Enter your domain (e.g., `thinktable.com`)
4. Add the DNS records Resend provides
5. Wait for verification (usually a few minutes)
6. Update Supabase SMTP settings:
   - **Sender Email:** `noreply@yourdomain.com`
   - Keep other settings the same

### Option 2: Temporarily Disable Email Confirmation (Development Only)

1. Go to: https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/auth/providers
2. Click on **Email** provider
3. **Uncheck** "Confirm email" (temporarily)
4. Users can sign up without email verification
5. **Remember to re-enable this before production!**

## Current Status

- ✅ SMTP is configured correctly
- ✅ Resend is connected
- ⚠️ Limited to sending to `easayani@goalfish.io` only

## Next Steps

1. **For now:** Test signups with `easayani@goalfish.io`
2. **Before production:** Verify your domain in Resend
3. **Update sender email** to use your verified domain

This is a Resend limitation, not a bug in your code!



