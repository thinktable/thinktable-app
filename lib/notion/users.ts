// List Notion workspace people for the Share picker (OAuth token → GET /v1/users)

import { NOTION_VERSION } from './config' // Pinned Notion Data API version

export type NotionPerson = {
  id: string // Notion user UUID
  name: string | null // Display name when Notion provides one
  email: string | null // Email when capability allows (person only)
  avatarUrl: string | null // Avatar URL when present
}

type NotionUserPayload = {
  object?: string // Always "user" on success rows
  id?: string // Notion user id
  name?: string | null // Display name
  avatar_url?: string | null // Avatar
  type?: string // "person" | "bot"
  person?: { email?: string } // Email lives under person
}

/** Fetch one page of Notion users (people + bots); caller filters. */
export async function listNotionUsers(
  accessToken: string, // User OAuth install token (never expose to browser)
  opts?: { startCursor?: string; pageSize?: number } // Pagination controls
): Promise<{ users: NotionUserPayload[]; nextCursor: string | null; hasMore: boolean }> {
  const params = new URLSearchParams() // Build query string for GET /v1/users
  if (opts?.startCursor) params.set('start_cursor', opts.startCursor) // Continue pagination
  params.set('page_size', String(Math.min(Math.max(opts?.pageSize ?? 100, 1), 100))) // Notion max 100
  const qs = params.toString() // Serialize query
  const res = await fetch(`https://api.notion.com/v1/users${qs ? `?${qs}` : ''}`, {
    method: 'GET', // List users endpoint
    headers: {
      Authorization: `Bearer ${accessToken}`, // Workspace install token
      'Notion-Version': NOTION_VERSION, // Required version header
    },
  })
  const payload = await res.json() // Parse Notion JSON body
  if (!res.ok) {
    throw new Error(payload?.message || 'Failed to list Notion users') // Surface API error
  }
  return {
    users: (payload.results || []) as NotionUserPayload[], // Raw user rows
    nextCursor: payload.next_cursor ?? null, // Cursor for next page
    hasMore: Boolean(payload.has_more), // Whether more pages exist
  }
}

/** Load all person users (paginated) and optionally filter by name/email query. */
export async function searchNotionPeople(
  accessToken: string, // OAuth token
  query?: string // Case-insensitive name/email substring
): Promise<NotionPerson[]> {
  const q = (query || '').trim().toLowerCase() // Normalize search
  const people: NotionPerson[] = [] // Accumulator
  let startCursor: string | undefined // Pagination cursor
  let guard = 0 // Cap pages to avoid runaway loops
  do {
    const page = await listNotionUsers(accessToken, { startCursor, pageSize: 100 }) // One Notion page
    for (const u of page.users) {
      if (u.type !== 'person' || !u.id) continue // Skip bots and malformed rows
      const person: NotionPerson = {
        id: u.id, // Notion user id for grant metadata
        name: u.name ?? null, // Display name
        email: u.person?.email ?? null, // Email when capability granted
        avatarUrl: u.avatar_url ?? null, // Avatar for picker row
      }
      if (!q) {
        people.push(person) // No filter — keep all people
        continue
      }
      const hay = `${person.name || ''} ${person.email || ''}`.toLowerCase() // Search haystack
      if (hay.includes(q)) people.push(person) // Match name or email
    }
    startCursor = page.nextCursor || undefined // Advance cursor
    guard += 1 // Count pages fetched
  } while (startCursor && guard < 10) // At most ~1000 users for picker
  return people // Filtered people list
}
