# Authentication Setup Guide

## Overview

ThinkTable uses Supabase Auth for authentication with Resend for enhanced email verification. This setup provides:

- Email/password authentication
- Email verification via Resend
- Protected routes with middleware
- Session management with SSR support

## Environment Variables

Add these to your `.env.local` file:

```env
# Resend API Key (required for email verification)
RESEND_API_KEY=re_your-resend-api-key-here

# Resend From Email (must be verified in Resend)
RESEND_FROM_EMAIL=noreply@yourdomain.com

# Site URL (for email verification links)
NEXT_PUBLIC_SITE_URL=http://localhost:3031

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

## Setup Steps

### 1. Get Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Go to [API Keys](https://resend.com/api-keys)
3. Create a new API key
4. Add it to `.env.local` as `RESEND_API_KEY`

### 2. Verify Email Domain in Resend

1. Go to [Domains](https://resend.com/domains) in Resend dashboard
2. Add and verify your domain (or use `onboarding@resend.dev` for testing)
3. Set `RESEND_FROM_EMAIL` in `.env.local`

### 3. Configure Supabase

1. Enable email authentication in Supabase Dashboard:
   - Go to Authentication → Providers → Email
   - Enable "Enable email provider"
   - Enable "Confirm email" (recommended)

2. Configure email templates (optional):
   - Supabase will send its own verification emails
   - Resend emails are sent as a backup/enhancement

### 4. Set Site URL

Update `NEXT_PUBLIC_SITE_URL` to your production domain when deploying:
- Development: `http://localhost:3031`
- Production: `https://yourdomain.com`

## Authentication Flow

### Sign Up Flow

1. User fills out signup form at `/signup`
2. Supabase creates user account
3. API route `/api/auth/send-verification` sends Resend email
4. User receives verification email with link
5. User clicks link → redirected to `/auth/verify-email`
6. Email is verified with Supabase
7. User redirected to `/login`

### Sign In Flow

1. User enters credentials at `/login`
2. Supabase authenticates user
3. Session is created and stored in cookies
4. User redirected to `/app` (protected route)

### Protected Routes

- Routes under `/app/*` require authentication
- Middleware checks for valid session
- Unauthenticated users redirected to `/login`
- Authenticated users accessing `/login` or `/signup` redirected to `/app`

## File Structure

```
apps/web/
├── app/
│   ├── signup/
│   │   └── page.tsx              # Sign up page
│   ├── login/
│   │   └── page.tsx              # Login page
│   ├── auth/
│   │   ├── verify-email/
│   │   │   └── page.tsx         # Email verification page
│   │   └── callback/
│   │       └── route.ts          # OAuth callback handler
│   ├── app/
│   │   └── page.tsx              # Protected app page
│   └── api/
│       └── auth/
│           └── send-verification/
│               └── route.ts      # Resend email API
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   └── server.ts             # Server Supabase client
│   └── resend.ts                 # Resend email utilities
└── middleware.ts                  # Route protection middleware
```

## Testing

1. Start the dev server: `npm run dev`
2. Navigate to `http://localhost:3031/signup`
3. Create an account
4. Check your email for verification link
5. Click the link to verify
6. Sign in at `/login`
7. Access protected routes at `/app`

## Troubleshooting

### Email Not Sending

- Check Resend API key is correct
- Verify email domain in Resend dashboard
- Check Resend API logs for errors
- Ensure `RESEND_FROM_EMAIL` matches verified domain

### Verification Link Not Working

- Check `NEXT_PUBLIC_SITE_URL` matches your domain
- Verify token is being extracted correctly from Supabase link
- Check browser console for errors

### Session Issues

- Clear browser cookies
- Check Supabase session configuration
- Verify middleware is running correctly

## Security Notes

- Never expose `RESEND_API_KEY` in client-side code
- Use environment variables for all secrets
- Enable email confirmation in Supabase for production
- Use HTTPS in production
- Set secure cookie flags in production



