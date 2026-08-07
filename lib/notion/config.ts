// Central Notion OAuth configuration helpers (why: one place for env + URLs)

export const NOTION_VERSION = '2022-06-28' // Stable Notion-Version header for OAuth + Data API

export function getNotionClientId(): string | null {
  return process.env.NOTION_CLIENT_ID || null // Public OAuth client id from Notion Developer portal
}

export function getNotionClientSecret(): string | null {
  return process.env.NOTION_CLIENT_SECRET || null // Public OAuth client secret (server-only)
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3031' // App origin for redirects
}

export function getNotionRedirectUri(): string {
  return `${getSiteUrl()}/api/notion/callback` // Must match Developer portal redirect URI exactly
}

export function isNotionOAuthConfigured(): boolean {
  return Boolean(getNotionClientId() && getNotionClientSecret()) // Gate UI/API when secrets missing
}

export function buildNotionAuthorizeUrl(state: string): string {
  const clientId = getNotionClientId() // Required for authorize URL
  if (!clientId) {
    throw new Error('NOTION_CLIENT_ID is not configured') // Fail fast in start route
  }
  const params = new URLSearchParams({
    client_id: clientId, // Identifies Thinktable's public connection
    response_type: 'code', // OAuth authorization-code flow
    owner: 'user', // User-owned install (required by Notion public connections)
    redirect_uri: getNotionRedirectUri(), // Where Notion returns after page picker
    state, // CSRF + return-path binding
  })
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}` // Notion-hosted connect UI
}
