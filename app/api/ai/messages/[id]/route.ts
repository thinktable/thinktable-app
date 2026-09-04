// PATCH /api/ai/messages/[id]
// - soft: true → update content/html/metadata in place (TipTap save, board-link threads)
// - default → edit a past user turn: truncate later turns, undo actions, prepare regenerate
import { createClient } from '@/lib/supabase/server' // Auth
import { undoAiAction, type AiAction } from '@/lib/ai/actions' // Undo stub
import { NextRequest, NextResponse } from 'next/server' // Types

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: messageId } = await context.params // Message to edit
  const supabase = await createClient() // Client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) // 401

  const body = await request.json().catch(() => ({})) // Body
  const soft = body.soft === true // TipTap / metadata-only save

  const { data: message } = await supabase // Load target
    .from('ai_messages') // Messages
    .select('*') // Full
    .eq('id', messageId) // Id
    .eq('user_id', user.id) // Own
    .maybeSingle() // One

  if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // Missing

  // Soft save: any role; keep later turns; merge metadata (html, boardLinks, …)
  if (soft) {
    const content =
      typeof body.content === 'string' ? body.content : (message.content as string) // Keep if omitted
    const html = typeof body.html === 'string' ? body.html : undefined
    const metaIn =
      body.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : null
    const prevMeta = (message.metadata as Record<string, unknown>) || {} // Pre-edit metadata
    const priorHtml =
      typeof prevMeta.html === 'string' ? (prevMeta.html as string) : undefined // HTML before this write
    // Freeze the first sent/received body so Revert text can restore user edits
    const isFirstFreeze = typeof prevMeta.originalContent !== 'string'
    const contentUnchanged = content === (message.content as string)
    const originalContent = isFirstFreeze
      ? (message.content as string)
      : (prevMeta.originalContent as string)
    // Prefer prior HTML; on a metadata-only first freeze, the incoming html is still the original
    const originalHtml =
      typeof prevMeta.originalHtml === 'string'
        ? (prevMeta.originalHtml as string)
        : priorHtml ??
          (isFirstFreeze && contentUnchanged && html !== undefined ? html : undefined)
    const metadata: Record<string, unknown> = {
      ...prevMeta,
      ...(metaIn || {}),
      ...(html !== undefined ? { html } : {}),
      originalContent, // Never overwrite once stamped
      ...(typeof originalHtml === 'string' ? { originalHtml } : {}), // Keep unset until we have HTML
    }
    const { data: updated, error } = await supabase
      .from('ai_messages')
      .update({
        content,
        parts: [{ type: 'text', text: content }],
        metadata,
      })
      .eq('id', messageId)
      .eq('user_id', user.id)
      .select()
      .single()
    if (error || !updated) {
      return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ message: updated, soft: true })
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '' // New text
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 }) // Require

  if (message.role !== 'user') {
    return NextResponse.json({ error: 'Only user messages can be edited' }, { status: 400 }) // Guard
  }

  const threadId = message.thread_id as string // Parent thread
  const createdAt = message.created_at as string // Cutoff

  // Load later messages (to find action log anchors) then delete them
  const { data: later } = await supabase
    .from('ai_messages')
    .select('id, created_at')
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .gt('created_at', createdAt)

  const laterIds = (later || []).map((m: { id: string }) => m.id as string) // Ids to remove

  // Mark related actions undone + run inverse stubs (Edit mode will fill real inverses)
  if (laterIds.length) {
    const { data: actions } = await supabase
      .from('ai_action_log')
      .select('*')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .in('message_id', laterIds)
      .neq('status', 'undone')

    for (const row of actions || []) {
      const action: AiAction = {
        kind: (row.kind as AiAction['kind']) || 'noop',
        payload: (row.payload || {}) as Record<string, unknown>,
        inverse: (row.inverse || {}) as Record<string, unknown>,
      }
      await undoAiAction(action) // Stub undo
      await supabase
        .from('ai_action_log')
        .update({ status: 'undone' })
        .eq('id', row.id)
        .eq('user_id', user.id)
    }

    await supabase
      .from('ai_messages')
      .delete()
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .in('id', laterIds)
  }

  // Update the edited user message in place
  const { data: updated, error } = await supabase
    .from('ai_messages')
    .update({
      content,
      parts: [{ type: 'text', text: content }],
      metadata: {
        ...((message.metadata as Record<string, unknown>) || {}),
        edited: true,
        editedAt: new Date().toISOString(),
      },
    })
    .eq('id', messageId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  }

  await supabase
    .from('ai_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('user_id', user.id)

  return NextResponse.json({
    message: updated,
    truncatedIds: laterIds,
    threadId,
  })
}
