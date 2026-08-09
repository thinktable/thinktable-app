// PATCH a Notion page property (database row cell) — writes back to Notion as source of truth

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isNotionPropertyEditable,
  updateNotionPageProperty,
  type NotionPropertyEditValue,
} from '@/lib/notion/database'

/** Validate + narrow the JSON body into a typed property edit. */
function parseEditValue(body: Record<string, unknown>): {
  property: string
  value: NotionPropertyEditValue
} {
  const property = typeof body.property === 'string' ? body.property.trim() : ''
  const type = typeof body.type === 'string' ? body.type : ''
  if (!property) throw new Error('Missing property name')
  if (!isNotionPropertyEditable(type)) throw new Error(`Property type "${type}" is not editable`)

  switch (type) {
    case 'title':
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number':
    case 'date':
      return {
        property,
        value: { type, text: typeof body.text === 'string' ? body.text : '' },
      }
    case 'number': {
      if (body.number === null || body.number === '') {
        return { property, value: { type: 'number', number: null } }
      }
      const n = typeof body.number === 'number' ? body.number : parseFloat(String(body.number))
      if (Number.isNaN(n)) throw new Error('Invalid number')
      return { property, value: { type: 'number', number: n } }
    }
    case 'checkbox':
      return { property, value: { type: 'checkbox', checked: body.checked === true } }
    case 'select':
    case 'status':
      return {
        property,
        value: {
          type,
          name: typeof body.name === 'string' && body.name ? body.name : null,
        },
      }
    case 'multi_select': {
      const names = Array.isArray(body.names)
        ? body.names.filter((n): n is string => typeof n === 'string' && n.length > 0)
        : []
      return { property, value: { type: 'multi_select', names } }
    }
    default:
      throw new Error(`Unsupported type "${type}"`)
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await context.params // Notion page UUID (database row)
    if (!pageId) {
      return NextResponse.json({ error: 'Missing page id' }, { status: 400 })
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

    const body = (await request.json()) as Record<string, unknown>
    const { property, value } = parseEditValue(body)

    await updateNotionPageProperty(connection.access_token, pageId, property, value)
    return NextResponse.json({ ok: true, pageId, property, value })
  } catch (error) {
    console.error('Notion page property update failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to update Notion page'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
