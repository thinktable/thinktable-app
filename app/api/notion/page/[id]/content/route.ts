// GET pull / PUT push Notion page body (blocks ↔ TipTap HTML)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pullNotionPageBody, pushNotionPageBody } from '@/lib/notion/page-sync'

async function notionTokenForUser(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data: connection, error } = await admin
    .from('notion_connections')
    .select('access_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !connection?.access_token) {
    throw new Error('Notion is not connected')
  }
  return connection.access_token
}

/** Pull Notion page body as TipTap HTML. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await context.params
    if (!pageId) {
      return NextResponse.json({ error: 'Missing page id' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = await notionTokenForUser(user.id)
    const { html, lastEditedTime } = await pullNotionPageBody(token, pageId)
    return NextResponse.json({ ok: true, pageId, html, lastEditedTime })
  } catch (error) {
    console.error('Notion page pull failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to pull Notion page'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Push TipTap HTML to replace the Notion page body. */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await context.params
    if (!pageId) {
      return NextResponse.json({ error: 'Missing page id' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as { html?: string }
    if (typeof body.html !== 'string') {
      return NextResponse.json({ error: 'Missing html' }, { status: 400 })
    }

    const token = await notionTokenForUser(user.id)
    const { lastEditedTime } = await pushNotionPageBody(token, pageId, body.html)
    return NextResponse.json({ ok: true, pageId, lastEditedTime })
  } catch (error) {
    console.error('Notion page push failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to push Notion page'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
