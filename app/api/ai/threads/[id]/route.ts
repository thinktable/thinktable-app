// PATCH rename/mode / DELETE a single AI thread
import { createClient } from '@/lib/supabase/server' // Auth client
import { isAiModeId } from '@/lib/ai/modes' // Mode guard
import { NextRequest, NextResponse } from 'next/server' // Types

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params // Thread id
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const body = await request.json().catch(() => ({})) // Body
  const patch: Record<string, unknown> = {} // Accumulator
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim() // Rename
  if (isAiModeId(body.mode)) patch.mode = body.mode // Mode switch
  if (body.pageId === null) patch.page_id = null // Clear association
  else if (typeof body.pageId === 'string') patch.page_id = body.pageId // Set association
  if (body.metadata && typeof body.metadata === 'object') patch.metadata = body.metadata // Metadata

  if (!Object.keys(patch).length) { // Nothing to update
    return NextResponse.json({ error: 'No changes' }, { status: 400 }) // Bad request
  }

  const { data, error } = await supabase // Update
    .from('ai_threads') // Table
    .update(patch) // Patch
    .eq('id', id) // Id
    .eq('user_id', user.id) // Own
    .select() // Return
    .single() // One

  if (error) return NextResponse.json({ error: error.message }, { status: 500 }) // Fail
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // Missing
  return NextResponse.json({ thread: data }) // OK
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params // Thread id
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const { error } = await supabase // Delete
    .from('ai_threads') // Cascades messages via FK
    .delete() // Delete
    .eq('id', id) // Id
    .eq('user_id', user.id) // Own

  if (error) return NextResponse.json({ error: error.message }, { status: 500 }) // Fail
  return NextResponse.json({ ok: true }) // OK
}
