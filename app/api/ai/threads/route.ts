// GET list / POST create AI threads (universal; optional page filter)
import { createClient } from '@/lib/supabase/server' // Cookie-authed Supabase
import { isAiModeId } from '@/lib/ai/modes' // Mode guard
import { NextRequest, NextResponse } from 'next/server' // App Router types

export async function GET(request: NextRequest) {
  const supabase = await createClient() // Server client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Require auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const boardId = request.nextUrl.searchParams.get('boardId') // Optional filter
  const filter = request.nextUrl.searchParams.get('filter') || 'all' // all | board

  let query = supabase // Base query
    .from('ai_threads') // Threads table
    .select('*') // Full row
    .eq('user_id', user.id) // Own only
    .order('updated_at', { ascending: false }) // Recent first

  if (filter === 'board' && boardId) { // This-board filter
    query = query.eq('board_id', boardId) // Associated with current board
  }

  const { data, error } = await query // Execute
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }) // Fail
  return NextResponse.json({ threads: data || [] }) // OK
}

export async function POST(request: NextRequest) {
  const supabase = await createClient() // Server client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const body = await request.json().catch(() => ({})) // Body
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New AI chat' // Title
  const mode = isAiModeId(body.mode) ? body.mode : 'ask' // Default Ask
  const boardId = typeof body.boardId === 'string' ? body.boardId : null // Optional association
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {} // Extra

  const { data, error } = await supabase // Insert
    .from('ai_threads') // Table
    .insert({
      user_id: user.id, // Owner
      title, // Title
      mode, // Mode
      board_id: boardId, // Board association
      metadata, // Metadata
    })
    .select() // Return row
    .single() // One

  if (error) return NextResponse.json({ error: error.message }, { status: 500 }) // Fail
  return NextResponse.json({ thread: data }, { status: 201 }) // Created
}
