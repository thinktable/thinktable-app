# Quick Fix: Update Email Template

The template in Supabase dashboard is still showing the default plain text. Here's how to fix it:

## Step-by-Step (2 minutes)

1. **Open Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/auth/templates
   - Sign in if needed

2. **Click "Confirm signup"** (first template in the list)

3. **Update Subject:**
   - Change to: `Verify your Thinkable account`

4. **Switch to HTML Editor:**
   - Look for tabs or buttons: "Text" / "HTML" 
   - Click **"HTML"** tab (important!)

5. **Replace ALL content** with this:

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

6. **Click "Save"** (top right corner)

7. **Test:**
   - Sign up with a new email
   - You should see the beautiful gradient email!

## Common Issues

**Still seeing plain text?**
- Make sure you're in the **HTML** editor, not Text editor
- Delete ALL existing content before pasting
- Make sure you clicked "Save"

**Can't find HTML editor?**
- Look for tabs: "Text" | "HTML" 
- Or a dropdown/button to switch modes
- Some dashboards have a code icon (</>) to switch to HTML

## Visual Guide

The Supabase email template editor should look like:
```
┌─────────────────────────────────────┐
│ Subject: [Verify your Thinkable...] │
│                                     │
│ [Text] [HTML] ← Click HTML tab!    │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ <!DOCTYPE html>                 │ │
│ │ <html>                          │ │
│ │   ... (paste HTML here)         │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Save] [Cancel]                     │
└─────────────────────────────────────┘
```

Make sure you're editing the **HTML** version, not the plain text version!



