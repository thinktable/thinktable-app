// GET messages for a thread
import { createClient } from '@/lib/supabase/server' // Auth
import { NextRequest, NextResponse } from 'next/server' // Types

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await context.params // Thread id
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const { data: thread } = await supabase // Verify ownership
    .from('ai_threads') // Threads
    .select('id') // Minimal
    .eq('id', threadId) // Match
    .eq('user_id', user.id) // Own
    .maybeSingle() // One
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // Missing

  const { data, error } = await supabase // Load transcript
    .from('ai_messages') // Messages
    .select('*') // Full
    .eq('thread_id', threadId) // Thread
    .eq('user_id', user.id) // Own
    .order('created_at', { ascending: true }) // Chronological

  if (error) return NextResponse.json({ error: error.message }, { status: 500 }) // Fail
  return NextResponse.json({ messages: data || [] }) // OK
}
