// Disconnect Notion for the current user (deletes stored OAuth tokens)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  try {
    const supabase = await createClient() // Session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient() // Service role delete
    const { error } = await admin.from('notion_connections').delete().eq('user_id', user.id)

    if (error) {
      console.error('Notion disconnect failed:', error)
      return NextResponse.json({ error: 'Failed to disconnect Notion' }, { status: 500 })
    }

    return NextResponse.json({ ok: true }) // Client clears connected UI
  } catch (error) {
    console.error('Notion disconnect failed:', error)
    return NextResponse.json({ error: 'Failed to disconnect Notion' }, { status: 500 })
  }
}
