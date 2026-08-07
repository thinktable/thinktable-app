// Return Notion connection status for the signed-in user (never returns the access token)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isNotionOAuthConfigured } from '@/lib/notion/config'

export async function GET() {
  try {
    if (!isNotionOAuthConfigured()) {
      return NextResponse.json({ configured: false, connected: false }) // UI can show setup-needed
    }

    const supabase = await createClient() // Session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ configured: true, connected: false }, { status: 401 }) // Not signed in
    }

    const admin = createAdminClient() // Read secret table safely server-side
    const { data, error } = await admin
      .from('notion_connections')
      .select('workspace_id, workspace_name, workspace_icon, bot_id, updated_at')
      .eq('user_id', user.id)
      .maybeSingle() // Zero or one row

    if (error) {
      console.error('Notion status lookup failed:', error)
      return NextResponse.json({ error: 'Failed to load Notion status' }, { status: 500 })
    }

    return NextResponse.json({
      configured: true, // Secrets present
      connected: Boolean(data), // Has stored install
      workspaceId: data?.workspace_id ?? null,
      workspaceName: data?.workspace_name ?? null,
      workspaceIcon: data?.workspace_icon ?? null,
      botId: data?.bot_id ?? null,
      updatedAt: data?.updated_at ?? null,
    })
  } catch (error) {
    console.error('Notion status failed:', error)
    return NextResponse.json({ error: 'Failed to load Notion status' }, { status: 500 })
  }
}
