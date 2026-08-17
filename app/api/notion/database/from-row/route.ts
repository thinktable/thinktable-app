// Create a new Notion database seeded with one copied row (drag row onto board).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createNotionDatabaseFromRow, type NotionDbRow } from '@/lib/notion/database'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      sourceDatabaseId?: string
      row?: NotionDbRow
    }
    if (!body.sourceDatabaseId || !body.row?.id) {
      return NextResponse.json(
        { error: 'sourceDatabaseId and row are required' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const { data: connection, error: connError } = await admin
      .from('notion_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle()
    if (connError || !connection?.access_token) {
      return NextResponse.json({ error: 'Notion is not connected' }, { status: 400 })
    }

    const created = await createNotionDatabaseFromRow(
      connection.access_token,
      body.sourceDatabaseId,
      body.row
    )
    return NextResponse.json(created)
  } catch (error) {
    console.error('Notion database from-row failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to create database'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
