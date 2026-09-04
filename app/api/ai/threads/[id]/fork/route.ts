// POST — duplicate a thread + its turns into a new chat the user can continue
import { createClient } from '@/lib/supabase/server' // Cookie-authed Supabase
import { NextRequest, NextResponse } from 'next/server' // App Router types

/** Build a distinct title so the fork is obvious in the picker list. */
function forkTitle(source: string): string {
  const base = source.trim() || 'New AI chat' // Empty / whitespace → default
  if (base.toLowerCase().startsWith('copy of ')) return `${base} (copy)` // Avoid "Copy of Copy of …"
  return `Copy of ${base}` // First fork
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: sourceId } = await context.params // Thread to duplicate
  const supabase = await createClient() // Server client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Require auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const { data: source, error: sourceErr } = await supabase // Load owned source thread
    .from('ai_threads') // Threads
    .select('*') // Full row for mode / board / metadata
    .eq('id', sourceId) // Match
    .eq('user_id', user.id) // Own only
    .maybeSingle() // One or none
  if (sourceErr) return NextResponse.json({ error: sourceErr.message }, { status: 500 }) // Fail
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // Missing

  const { data: messages, error: msgErr } = await supabase // Load transcript to copy
    .from('ai_messages') // Turns
    .select('*') // Full rows
    .eq('thread_id', sourceId) // Source chat
    .eq('user_id', user.id) // Own
    .order('created_at', { ascending: true }) // Parents before children when remapping
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 }) // Fail

  const sourceMeta =
    source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? (source.metadata as Record<string, unknown>) // Preserve agent / skill prefs
      : {}

  const { data: forked, error: insertErr } = await supabase // Mint the copy thread
    .from('ai_threads') // Threads
    .insert({
      user_id: user.id, // Same owner
      title: forkTitle(source.title), // Distinct picker label
      mode: source.mode, // Keep Ask / Edit
      board_id: source.board_id, // Same board association
      metadata: { ...sourceMeta, forkedFrom: sourceId }, // Trace origin without breaking prefs
    })
    .select() // Return row
    .single() // One
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 }) // Fail

  const rows = messages || [] // Chronological source turns
  if (rows.length === 0) { // Empty chat — thread alone is enough
    return NextResponse.json({ thread: forked }, { status: 201 }) // Created
  }

  const idMap = new Map<string, string>() // old message id → new message id
  const inserts = rows.map((m) => {
    const newId = crypto.randomUUID() // Stable id so we can remap parent_id in one insert
    idMap.set(m.id, newId) // Record mapping
    const status =
      m.status === 'streaming' || m.status === 'pending' ? 'complete' : m.status // Don't leave half-streamed turns
    return {
      id: newId, // Explicit so FK remap works in one pass
      thread_id: forked.id, // New parent thread
      user_id: user.id, // Owner
      role: m.role, // user | assistant | …
      content: m.content, // Body
      parts: m.parts ?? [], // Drag blocks
      parent_id: null as string | null, // Filled after map is complete
      status, // Lifecycle
      metadata: m.metadata && typeof m.metadata === 'object' ? m.metadata : {}, // Preserve boardLinks etc.
      created_at: m.created_at, // Keep original order / timestamps
    }
  })

  for (let i = 0; i < rows.length; i++) { // Second pass: remap in-thread parent links
    const oldParent = rows[i].parent_id as string | null // Source parent
    inserts[i].parent_id = oldParent && idMap.has(oldParent) ? idMap.get(oldParent)! : null // Only remap within this fork
  }

  const { error: copyErr } = await supabase.from('ai_messages').insert(inserts) // Bulk copy turns
  if (copyErr) {
    await supabase.from('ai_threads').delete().eq('id', forked.id).eq('user_id', user.id) // Roll back empty fork on copy fail
    return NextResponse.json({ error: copyErr.message }, { status: 500 }) // Fail
  }

  return NextResponse.json({ thread: forked }, { status: 201 }) // Open this in the client
}
