// Notion OAuth token exchange + typed response (why: keep route handlers thin)

import { NOTION_VERSION, getNotionClientId, getNotionClientSecret, getNotionRedirectUri } from './config'

export type NotionTokenResponse = {
  access_token: string // Bearer token for Notion API
  refresh_token?: string // Present on newer OAuth installs
  token_type: string // Usually "bearer"
  bot_id: string // Bot identity for this connection
  workspace_id?: string // Workspace the user authorized
  workspace_name?: string // Display name for top bar
  workspace_icon?: string | null // Icon URL or emoji
  duplicated_template_id?: string | null // Set when user duplicates a template
  owner?: Record<string, unknown> // Workspace owner metadata
}

export async function exchangeNotionCode(code: string): Promise<NotionTokenResponse> {
  const clientId = getNotionClientId() // OAuth client id
  const clientSecret = getNotionClientSecret() // OAuth client secret
  if (!clientId || !clientSecret) {
    throw new Error('Notion OAuth is not configured') // Misconfigured deploy
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64') // HTTP Basic auth for token endpoint
  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST', // Token exchange
    headers: {
      Authorization: `Basic ${basic}`, // Notion requires Basic client credentials
      'Content-Type': 'application/json', // JSON body
      'Notion-Version': NOTION_VERSION, // API version pin
    },
    body: JSON.stringify({
      grant_type: 'authorization_code', // Standard OAuth grant
      code, // Temporary code from redirect
      redirect_uri: getNotionRedirectUri(), // Must match authorize request
    }),
  })

  const payload = await res.json() // Parse Notion response
  if (!res.ok) {
    const message = payload?.error_description || payload?.message || 'Notion token exchange failed' // Surface API error
    throw new Error(message) // Bubble to callback route
  }
  return payload as NotionTokenResponse // Typed success payload
}
