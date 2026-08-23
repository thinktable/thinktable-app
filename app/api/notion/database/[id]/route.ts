// Return a Notion database as structured columns + rows for the in-app table view.
// POST creates a new empty row (page) in the database's data source.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createNotionDatabaseRow,
  fetchNotionDatabaseTable,
  NOTION_DB_CLIENT_ROW_PAGE,
} from '@/lib/notion/database'

async function notionTokenForUser(): Promise<
  { token: string } | { error: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const admin = createAdminClient()
  const { data: connection, error: connError } = await admin
    .from('notion_connections')
    .select('access_token')
    .eq('user_id', user.id)
    .maybeSingle()
  if (connError || !connection?.access_token) {
    return { error: NextResponse.json({ error: 'Notion is not connected' }, { status: 400 }) }
  }
  return { token: connection.access_token }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params // Notion database UUID from the path
    if (!id) {
      return NextResponse.json({ error: 'Missing database id' }, { status: 400 })
    }
    const auth = await notionTokenForUser()
    if ('error' in auth) return auth.error

    const limitParam = request.nextUrl.searchParams.get('limit')
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined
    const rowLimit = limitParam
      ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || NOTION_DB_CLIENT_ROW_PAGE))
      : NOTION_DB_CLIENT_ROW_PAGE
    const table = await fetchNotionDatabaseTable(auth.token, id, {
      rowLimit,
      rowCursor: cursor,
    })
    return NextResponse.json(table)
  } catch (error) {
    console.error('Notion database fetch failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load Notion database'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Create an empty page (row) in this database's data source. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Missing database id' }, { status: 400 })
    }
    const auth = await notionTokenForUser()
    if ('error' in auth) return auth.error

    // Resolve data source + title property from the live schema
    const table = await fetchNotionDatabaseTable(auth.token, id)
    const titleProp = table.properties.find((p) => p.type === 'title')
    if (!titleProp) {
      return NextResponse.json({ error: 'Database has no title property' }, { status: 400 })
    }
    const row = await createNotionDatabaseRow(auth.token, table.dataSourceId, titleProp.name)
    return NextResponse.json({ row, dataSourceId: table.dataSourceId })
  } catch (error) {
    console.error('Notion database row create failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to create row'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
