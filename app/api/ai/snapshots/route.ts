// GET list / POST create context snapshots
import { createClient } from '@/lib/supabase/server' // Auth
import { NextRequest, NextResponse } from 'next/server' // Types

export async function GET(request: NextRequest) {
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const threadId = request.nextUrl.searchParams.get('threadId') // Optional filter

  let query = supabase
    .from('ai_context_snapshots')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (threadId) query = query.eq('thread_id', threadId) // Scope to thread when asked

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ snapshots: data || [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const body = await request.json().catch(() => ({})) // Body
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Context snapshot'
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  const messageId = typeof body.messageId === 'string' ? body.messageId : null
  const payload =
    body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {}

  const { data, error } = await supabase
    .from('ai_context_snapshots')
    .insert({
      user_id: user.id,
      thread_id: threadId,
      message_id: messageId,
      name,
      payload,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ snapshot: data }, { status: 201 })
}
