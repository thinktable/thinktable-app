// Import selected Notion page(s) onto the current (or new) board

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importNotionPagesToBoard } from '@/lib/notion/import-to-board'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient() // Session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      returnTo?: string // Board path preference
      pageIds?: string[] // Picks from the import modal
      mode?: 'card' | 'mindmap' // Add as card vs generate mindmap
    }

    const admin = createAdminClient() // Read stored token
    const { data: connection, error: connError } = await admin
      .from('notion_connections')
      .select('access_token, workspace_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (connError || !connection?.access_token) {
      return NextResponse.json({ error: 'Notion is not connected' }, { status: 400 })
    }

    if (!body.pageIds || body.pageIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one Notion page' }, { status: 400 })
    }

    const imported = await importNotionPagesToBoard({
      userId: user.id,
      accessToken: connection.access_token,
      returnTo: body.returnTo,
      workspaceName: connection.workspace_name,
      pageIds: body.pageIds,
      mode: body.mode || 'card',
    })

    return NextResponse.json(imported) // conversationId + counts for client navigation
  } catch (error) {
    console.error('Notion import failed:', error)
    return NextResponse.json({ error: 'Failed to import Notion pages' }, { status: 500 })
  }
}
