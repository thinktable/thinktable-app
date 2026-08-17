// Convert a Notion database frame between Table view and Card view (threaded property frames).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertNotionDbLayout } from '@/lib/notion/convert-db-layout'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: databaseId } = await context.params // Notion database UUID (path; verified against frame)
    if (!databaseId) {
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

    const body = (await request.json().catch(() => ({}))) as {
      layout?: 'card' | 'table'
      conversationId?: string
      sourceMessageId?: string
      rowId?: string // Optional — single DB row → one card threaded to the DB frame
    }
    if (body.layout !== 'card' && body.layout !== 'table') {
      return NextResponse.json({ error: 'layout must be card or table' }, { status: 400 })
    }
    if (!body.conversationId || !body.sourceMessageId) {
      return NextResponse.json(
        { error: 'conversationId and sourceMessageId are required' },
        { status: 400 }
      )
    }

    const admin = createAdminClient() // Notion token + frame inserts
    const { data: connection, error: connError } = await admin
      .from('notion_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle()
    if (connError || !connection?.access_token) {
      return NextResponse.json({ error: 'Notion is not connected' }, { status: 400 })
    }

    const result = await convertNotionDbLayout({
      admin,
      accessToken: connection.access_token,
      userId: user.id,
      conversationId: body.conversationId,
      sourceMessageId: body.sourceMessageId,
      layout: body.layout,
      ...(body.rowId ? { rowId: body.rowId } : {}),
    })

    // Path id is informational — convert resolves the real DB id from the frame
    void databaseId
    return NextResponse.json(result)
  } catch (error) {
    console.error('Notion DB convert-layout failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to convert layout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
