// List Notion workspace people for Share picker (proxies GET /v1/users; never returns token)

import { NextResponse } from 'next/server' // JSON responses
import { createClient } from '@/lib/supabase/server' // Session user
import { createAdminClient } from '@/lib/supabase/admin' // Read notion_connections
import { searchNotionPeople } from '@/lib/notion/users' // Paginated people search

export async function GET(request: Request) {
  try {
    const supabase = await createClient() // Cookie session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Require signed-in Thinktable user

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // Not signed in
    }

    const admin = createAdminClient() // Secret table access
    const { data: connection, error: connError } = await admin
      .from('notion_connections') // Stored OAuth install
      .select('access_token') // Token only
      .eq('user_id', user.id) // Current user
      .maybeSingle() // Zero or one

    if (connError || !connection?.access_token) {
      return NextResponse.json({ connected: false, people: [] }) // No Notion → empty picker
    }

    const { searchParams } = new URL(request.url) // Query string
    const q = searchParams.get('q') || undefined // Optional name/email filter
    const people = await searchNotionPeople(connection.access_token, q) // Filter people

    return NextResponse.json({
      connected: true, // Notion install present
      people, // id / name / email / avatarUrl
    })
  } catch (error) {
    console.error('Notion users list failed:', error) // Server log
    return NextResponse.json({ error: 'Failed to load Notion users' }, { status: 500 })
  }
}
