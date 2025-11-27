# Update Supabase Email Template - Step by Step

## Option 1: Via Dashboard (Easiest)

1. **Go to Email Templates:**
   - https://supabase.com/dashboard/project/yhsyhtnnklpkfcpydbst/auth/templates

2. **Click on "Confirm signup"** (the first template)

3. **Update Subject Line:**
   - Change from: `Confirm Your Signup`
   - To: `Verify your Thinkable account`

4. **Replace the HTML Content:**
   - Delete everything in the HTML editor
   - Copy and paste the HTML from below
   - **IMPORTANT:** Make sure you're in the HTML editor, not the text editor!

5. **Click "Save"** (top right)

## Option 2: Via Management API (Automated)

If you have a Supabase Access Token, you can run this script:

```bash
# Get your access token from: https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN="your-access-token"
export PROJECT_REF="yhsyhtnnklpkfcpydbst"

curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_subjects_confirmation": "Verify your Thinkable account",
    "mailer_templates_confirmation_content": "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Verify your email</title></head><body style=\"font-family: -apple-system, BlinkMacSystemFont, '\''Segoe UI'\'', Roboto, '\''Helvetica Neue'\'', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;\"><div style=\"background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;\"><h1 style=\"color: white; margin: 0; font-size: 28px;\">Welcome to Thinkable!</h1></div><div style=\"background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;\"><p style=\"font-size: 16px; margin-bottom: 20px;\">Thanks for signing up! Please verify your email address to get started.</p><div style=\"text-align: center; margin: 30px 0;\"><a href=\"{{ .ConfirmationURL }}\" style=\"background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;\">Verify Email Address</a></div><p style=\"font-size: 14px; color: #6b7280; margin-top: 30px;\">If the button doesn'\''t work, copy and paste this link into your browser:</p><p style=\"font-size: 12px; color: #9ca3af; word-break: break-all; background: white; padding: 10px; border-radius: 4px; margin-top: 10px;\">{{ .ConfirmationURL }}</p><p style=\"font-size: 14px; color: #6b7280; margin-top: 30px;\">This link will expire in 24 hours.</p></div><div style=\"text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;\"><p style=\"font-size: 12px; color: #9ca3af;\">© 2024 Thinkable. All rights reserved.</p></div></body></html>"
  }'
```

## The HTML Template (Copy This)

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

## Important Notes

- Make sure you're editing the **HTML** version, not the text version
- The template uses `{{ .ConfirmationURL }}` which Supabase will replace automatically
- All styles are inline for email client compatibility
- After saving, test by signing up with a new email

## Troubleshooting

**Still seeing plain text:**
- Make sure you clicked "Confirm signup" template (not another one)
- Check you're editing HTML, not plain text
- Try refreshing the page after saving

**Template not updating:**
- Clear browser cache
- Try incognito/private window
- Check you clicked "Save" button

