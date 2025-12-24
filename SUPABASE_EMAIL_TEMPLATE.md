# Custom Supabase Email Template

## Beautiful Signup Confirmation Email

Copy this HTML template into your Supabase dashboard to match your custom design.

## Setup Instructions

1. **Go to Supabase Dashboard:**
   - https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/auth/templates

2. **Click on "Confirm signup" template**

3. **Update the Subject:**
   ```
   Verify your Thinkable account
   ```

4. **Replace the HTML content with:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify your email</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Thinkable!</h1>
    </div>
    <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">Thanks for signing up! Please verify your email address to get started.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="{{ .ConfirmationURL }}" style="background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Verify Email Address</a>
      </div>
      <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="font-size: 12px; color: #9ca3af; word-break: break-all; background: white; padding: 10px; border-radius: 4px; margin-top: 10px;">{{ .ConfirmationURL }}</p>
      <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">This link will expire in 24 hours.</p>
    </div>
    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 12px; color: #9ca3af;">© 2024 Thinkable. All rights reserved.</p>
    </div>
  </body>
</html>
```

5. **Click "Save"**

## Template Variables Used

- `{{ .ConfirmationURL }}` - The verification link (Supabase handles this automatically)
- All styling is inline for maximum email client compatibility

## Result

✅ Beautiful gradient header  
✅ Professional styling  
✅ Clear call-to-action button  
✅ Fallback link text  
✅ Branded footer  

## Optional: Customize Other Templates

You can also customize:
- **Magic Link** - For passwordless login
- **Reset Password** - For password recovery
- **Invite User** - For admin invitations
- **Change Email** - For email address changes

Use the same design system (gradient header, clean layout) for consistency!



