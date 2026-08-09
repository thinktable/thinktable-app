// List Notion pages as a sidebar-style tree for the import picker

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildNotionPageTree,
  resolveBlockIdParents,
  searchAllAccessibleNotionPages,
} from '@/lib/notion/pages'

export async function GET() {
  try {
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
      .select('access_token, workspace_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (connError || !connection?.access_token) {
      return NextResponse.json({ error: 'Notion is not connected' }, { status: 400 })
    }

    const raw = await searchAllAccessibleNotionPages(connection.access_token) // Flat accessible set
    const pages = await resolveBlockIdParents(connection.access_token, raw) // Nest DBs under pages
    const tree = buildNotionPageTree(pages) // Notion-native nesting

    return NextResponse.json({
      workspaceName: connection.workspace_name,
      tree, // Nested pages for the modal
      count: pages.length, // Total accessible pages
    })
  } catch (error) {
    console.error('Notion pages list failed:', error)
    return NextResponse.json({ error: 'Failed to load Notion pages' }, { status: 500 })
  }
}
