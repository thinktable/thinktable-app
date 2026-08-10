// DELETE a context snapshot
import { createClient } from '@/lib/supabase/server' // Auth
import { NextRequest, NextResponse } from 'next/server' // Types

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params // Snapshot id
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const { error } = await supabase
    .from('ai_context_snapshots')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
