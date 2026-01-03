# Resend Email Setup

## Issue

You're receiving emails from `noreply@mail.app.supabase.io` instead of Resend.

## Why This Happens

When a user signs up, **Supabase automatically sends a verification email** using its default email service. Then our code tries to send a Resend email, but:

1. Supabase sends its email immediately on signup
2. Resend email might be sent too (or might fail silently)
3. You see Supabase's email first

## Solutions

### Option 1: Configure Supabase to Use Resend SMTP (Recommended)

This makes Supabase send emails through Resend, so you get Resend's beautiful emails automatically:

1. **Get Resend SMTP credentials:**
   - Go to: https://resend.com/domains
   - Click on your domain (or use `resend.com` for testing)
   - Go to "SMTP" tab
   - Copy the SMTP credentials:
     - Host: `smtp.resend.com`
     - Port: `465` (SSL) or `587` (TLS)
     - Username: `resend`
     - Password: Your Resend API key

2. **Configure in Supabase:**
   - Go to: https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/settings/auth
   - Scroll to "SMTP Settings"
   - Enable "Enable Custom SMTP"
   - Fill in:
     - Host: `smtp.resend.com`
     - Port: `465`
     - Username: `resend`
     - Password: Your Resend API key (starts with `re_`)
     - Sender email: `onboarding@resend.dev` (for testing) or your verified domain
     - Sender name: `ThinkTable`

3. **Test:** Sign up again - emails should come from Resend!

### Option 2: Disable Supabase Auto-Emails (Not Recommended)

You can disable Supabase's automatic emails, but this requires:
- Custom email templates in Supabase
- More complex setup
- Not recommended for production

### Option 3: Keep Both (Current Setup)

Currently, both emails are sent:
- Supabase sends its default email immediately
- Our code tries to send Resend email

**To verify Resend is working:**
1. Check your server console when signing up
2. Look for: `✅ Resend verification email sent successfully!`
3. Check Resend dashboard: https://resend.com/emails
4. You should see emails being sent there

## Debugging

### Check Server Logs

When you sign up, check your server console for:

```
📧 Resend API key found, attempting to send via Resend...
✅ Token extracted, sending via Resend...
📧 Sending Resend email to: your@email.com
✅ Resend verification email sent successfully!
```

If you see errors instead, check:
- `RESEND_API_KEY` is set correctly
- `RESEND_FROM_EMAIL` is set (or defaults to `onboarding@resend.dev`)
- Resend API key is valid

### Check Resend Dashboard

1. Go to: https://resend.com/emails
2. You should see emails being sent
3. If not, check the API key is correct

### Common Issues

**"RESEND_API_KEY not set"**
- Add `RESEND_API_KEY=re_your-key` to `.env.local`
- Restart server

**"Resend email failed"**
- Check API key is valid
- Check `RESEND_FROM_EMAIL` is set correctly
- Check Resend dashboard for errors

**"Still getting Supabase emails"**
- This is normal - Supabase sends emails automatically
- Configure Resend SMTP in Supabase to replace Supabase emails (Option 1)

## Recommended: Use Resend SMTP

The best solution is **Option 1** - configure Supabase to use Resend SMTP. This way:
- ✅ Supabase handles email sending
- ✅ Uses Resend's infrastructure
- ✅ You can customize templates in Supabase
- ✅ No duplicate emails
- ✅ Better deliverability

See instructions above for setting up Resend SMTP in Supabase.



