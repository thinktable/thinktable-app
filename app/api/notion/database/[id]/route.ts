// Return a Notion database as structured columns + rows for the in-app table view

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchNotionDatabaseTable } from '@/lib/notion/database'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params // Notion database UUID from the path
    if (!id) {
      return NextResponse.json({ error: 'Missing database id' }, { status: 400 })
    }

    const supabase = await createClient() // Session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient() // Read stored Notion token
    const { data: connection, error: connError } = await admin
      .from('notion_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle()

    if (connError || !connection?.access_token) {
      return NextResponse.json({ error: 'Notion is not connected' }, { status: 400 })
    }

    const table = await fetchNotionDatabaseTable(connection.access_token, id)
    return NextResponse.json(table)
  } catch (error) {
    console.error('Notion database fetch failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load Notion database'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
