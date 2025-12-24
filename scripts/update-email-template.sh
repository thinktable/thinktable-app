#!/bin/bash

# Script to update Supabase email template via Management API
# Usage: ./update-email-template.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_REF="yhsyhtnnklpkfcpydbst"

echo -e "${YELLOW}Updating Supabase Email Template...${NC}"

# Check if SUPABASE_ACCESS_TOKEN is set
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo -e "${RED}Error: SUPABASE_ACCESS_TOKEN is not set${NC}"
  echo ""
  echo "Get your access token from: https://supabase.com/dashboard/account/tokens"
  echo ""
  echo "Then run:"
  echo "  export SUPABASE_ACCESS_TOKEN='your-token-here'"
  echo "  ./update-email-template.sh"
  exit 1
fi

# Beautiful HTML template (escaped for JSON)
HTML_TEMPLATE='<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Verify your email</title></head><body style="font-family: -apple-system, BlinkMacSystemFont, '\''Segoe UI'\'', Roboto, '\''Helvetica Neue'\'', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Thinkable!</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><p style="font-size: 16px; margin-bottom: 20px;">Thanks for signing up! Please verify your email address to get started.</p><div style="text-align: center; margin: 30px 0;"><a href="{{ .ConfirmationURL }}" style="background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Verify Email Address</a></div><p style="font-size: 14px; color: #6b7280; margin-top: 30px;">If the button doesn'\''t work, copy and paste this link into your browser:</p><p style="font-size: 12px; color: #9ca3af; word-break: break-all; background: white; padding: 10px; border-radius: 4px; margin-top: 10px;">{{ .ConfirmationURL }}</p><p style="font-size: 14px; color: #6b7280; margin-top: 30px;">This link will expire in 24 hours.</p></div><div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;"><p style="font-size: 12px; color: #9ca3af;">© 2024 Thinkable. All rights reserved.</p></div></body></html>'

# Create JSON payload
JSON_PAYLOAD=$(cat <<EOF
{
  "mailer_subjects_confirmation": "Verify your Thinkable account",
  "mailer_templates_confirmation_content": "$HTML_TEMPLATE"
}
EOF
)

# Make API call
echo -e "${YELLOW}Updating template...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  echo -e "${GREEN}✅ Email template updated successfully!${NC}"
  echo ""
  echo "Test by signing up with a new email address."
else
  echo -e "${RED}❌ Failed to update template (HTTP $HTTP_CODE)${NC}"
  echo ""
  echo "Response:"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  exit 1
fi



