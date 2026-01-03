# Setup Resend SMTP in Supabase

## Quick Setup Guide

Since you're using Resend's test email (`onboarding@resend.dev`), here's how to configure Supabase to send emails through Resend SMTP.

## Step 1: Get Your Resend API Key

1. Go to: https://resend.com/api-keys
2. Copy your API key (starts with `re_`)
3. Make sure it's in your `.env.local`:
   ```env
   RESEND_API_KEY=re_your-actual-key-here
   ```

## Step 2: Configure Supabase SMTP

1. **Go to Supabase Dashboard:**
   - https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/settings/auth

2. **Scroll down to "SMTP Settings"**

3. **Enable Custom SMTP:**
   - Toggle "Enable Custom SMTP" to ON

4. **Fill in Resend SMTP Credentials:**
   - **SMTP Host:** `smtp.resend.com`
   - **SMTP Port:** `465` (SSL) or `587` (TLS) - use `465` for SSL
   - **SMTP User:** `resend`
   - **SMTP Password:** Your Resend API key (the `re_...` key from Step 1)
   - **Sender Email:** `onboarding@resend.dev` (Resend's test email)
   - **Sender Name:** `ThinkTable` (or your app name)

5. **Click "Save"**

## Step 3: Test It

1. Sign up with a new email address
2. You should receive an email from `onboarding@resend.dev` instead of `noreply@mail.app.supabase.io`
3. Check your Resend dashboard: https://resend.com/emails to see the email was sent

## What This Does

- ✅ Supabase handles all auth flow (token generation, expiration, etc.)
- ✅ Resend sends the emails (better deliverability, analytics)
- ✅ Emails come from `onboarding@resend.dev` (professional)
- ✅ No duplicate emails
- ✅ No code changes needed

## After Setup

Once SMTP is configured, you can:
1. Remove the Resend API code (`/api/auth/send-verification` route)
2. Remove Resend dependency from `package.json` (optional)
3. Simplify your signup flow

But for now, keep everything as-is until SMTP is working!

## ⚠️ IMPORTANT: Resend Test Email Limitation

**Resend's test email (`onboarding@resend.dev`) can ONLY send to your verified account email!**

If you see this error:
```
450 You can only send testing emails to your own email address (your@email.com)
```

This means:
- ✅ You can send to: Your verified Resend account email (e.g., `easayani@goalfish.io`)
- ❌ You CANNOT send to: Any other email addresses (e.g., `easayani@gmail.com`)

**Solutions:**

1. **For Testing:** Use your verified Resend account email when signing up
2. **For Production:** Verify your domain in Resend and use `noreply@yourdomain.com`

## Troubleshooting

**500 Error on Signup:**
- **Most common cause:** Trying to send to an email that's not your verified Resend account email
- **Solution:** Use your verified email (`easayani@goalfish.io`) for testing, or verify a domain

**Emails still coming from Supabase:**
- Make sure "Enable Custom SMTP" is ON
- Verify SMTP credentials are correct
- Check Resend API key is valid
- Try port `587` if `465` doesn't work

**SMTP connection failed:**
- Double-check the API key is correct
- Make sure port `465` is selected (SSL)
- Verify `smtp.resend.com` is the host

**Not receiving emails:**
- Check spam folder
- Verify email address is correct
- Check Resend dashboard for delivery status
- **Make sure you're using your verified Resend account email!**

## Next Steps (Later)

When you get your own domain:
1. Verify domain in Resend: https://resend.com/domains
2. Update "Sender Email" in Supabase to `noreply@yourdomain.com`
3. That's it! No code changes needed.

