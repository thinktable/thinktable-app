// POST /api/ai/chat — Ask-mode streaming; never inserts into messages (page frames)
import { createClient } from '@/lib/supabase/server' // Auth
import {
  askSystemPrompt,
  buildContextPack,
  formatContextPack,
  plainToHtml,
} from '@/lib/ai/context-pack' // Context helpers
import { skillHintsForIds } from '@/lib/ai/skills' // Skill hints
import { NextRequest } from 'next/server' // Types
import OpenAI from 'openai' // OpenAI SDK

const openai = new OpenAI({ // Shared client
  apiKey: process.env.OPENAI_API_KEY, // Env key
})

function sse(data: unknown): string { // Encode one SSE event
  return `data: ${JSON.stringify(data)}\n\n` // Standard SSE
}

export async function POST(request: NextRequest) {
  const supabase = await createClient() // Cookie client
  const {
    data: { user },
  } = await supabase.auth.getUser() // Auth
  if (!user) return new Response('Unauthorized', { status: 401 }) // 401

  if (!process.env.OPENAI_API_KEY) { // Missing key
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await request.json().catch(() => ({})) // Parse body
  const message = typeof body.message === 'string' ? body.message.trim() : '' // User text
  let threadId = typeof body.threadId === 'string' ? body.threadId : null // Existing thread
  const pageId = typeof body.pageId === 'string' ? body.pageId : null // Current page
  const selectedFrameIds = Array.isArray(body.selectedFrameIds)
    ? body.selectedFrameIds.filter((id: unknown) => typeof id === 'string')
    : [] // Selection
  const snapshotIds = Array.isArray(body.snapshotIds)
    ? body.snapshotIds.filter((id: unknown) => typeof id === 'string')
    : [] // Attached snapshots
  const skipUserInsert = body.skipUserInsert === true // Edit-rewind already updated the user row

  if (!message) return new Response('Missing message', { status: 400 }) // Require text

  // Ensure thread exists (create if needed) and belongs to user
  if (!threadId) {
    const { data: created, error: createErr } = await supabase // New thread
      .from('ai_threads') // Table
      .insert({
        user_id: user.id, // Owner
        title: message.slice(0, 60) || 'New AI chat', // Seed title from prompt
        mode: 'ask', // Ask only for now
        page_id: pageId, // Associate with current page when present
        metadata: {}, // Empty
      })
      .select() // Return
      .single() // One
    if (createErr || !created) {
      return new Response(JSON.stringify({ error: createErr?.message || 'Failed to create thread' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    threadId = created.id // Use new id
  } else {
    const { data: thread } = await supabase // Verify
      .from('ai_threads') // Table
      .select('id, metadata, page_id') // Fields
      .eq('id', threadId) // Match
      .eq('user_id', user.id) // Own
      .maybeSingle() // One
    if (!thread) return new Response('Thread not found', { status: 404 }) // Missing
  }

  // Touch thread updated_at + optionally keep page association fresh
  await supabase
    .from('ai_threads')
    .update({
      updated_at: new Date().toISOString(), // Activity
      ...(pageId ? { page_id: pageId } : {}), // Refresh association when on a page
    })
    .eq('id', threadId)
    .eq('user_id', user.id)

  // Load thread metadata for skills
  const { data: threadRow } = await supabase
    .from('ai_threads')
    .select('metadata')
    .eq('id', threadId)
    .single()
  const meta = (threadRow?.metadata || {}) as Record<string, unknown>
  const skillIds = Array.isArray(meta.skillIds)
    ? (meta.skillIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []

  // Persist user message (unless edit-rewind already did)
  let userMessage: Record<string, unknown> | null = null
  if (!skipUserInsert) {
    const { data: inserted, error: userErr } = await supabase
      .from('ai_messages')
      .insert({
        thread_id: threadId,
        user_id: user.id,
        role: 'user',
        content: message,
        parts: [{ type: 'text', text: message }],
        status: 'complete',
        metadata: {},
      })
      .select()
      .single()
    if (userErr || !inserted) {
      return new Response(JSON.stringify({ error: userErr?.message || 'Failed to save message' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    userMessage = inserted
  }

  // Prior transcript for model context
  const { data: history } = await supabase
    .from('ai_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(40)

  const pack = await buildContextPack(supabase, {
    userId: user.id,
    pageId,
    selectedFrameIds,
    snapshotIds,
  })

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: askSystemPrompt(skillHintsForIds(skillIds)) },
    { role: 'system', content: formatContextPack(pack) },
    ...((history || []) as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  // Ensure the latest user turn is present (covers skipUserInsert + rare read lag after insert)
  const last = history?.[history.length - 1]
  if (!last || last.role !== 'user' || last.content !== message) {
    openaiMessages.push({ role: 'user', content: message })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)))

      try {
        if (userMessage) send({ type: 'message', message: userMessage })

        // Placeholder assistant row (streaming)
        const { data: assistantRow, error: asstErr } = await supabase
          .from('ai_messages')
          .insert({
            thread_id: threadId,
            user_id: user.id,
            role: 'assistant',
            content: '',
            parts: [],
            status: 'streaming',
            metadata: { mode: 'ask' },
          })
          .select()
          .single()

        if (asstErr || !assistantRow) {
          send({ type: 'error', error: asstErr?.message || 'Failed to create assistant message' })
          controller.close()
          return
        }

        send({ type: 'message', message: assistantRow })

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: openaiMessages,
          stream: true,
          temperature: 0.7,
          max_tokens: 2048,
        })

        let full = ''
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content || ''
          if (!delta) continue
          full += delta
          send({ type: 'text', text: delta })
        }

        const parts = [{ type: 'text', text: full }]
        const { data: finalRow, error: finalErr } = await supabase
          .from('ai_messages')
          .update({
            content: full,
            parts,
            status: 'complete',
            metadata: {
              mode: 'ask',
              html: plainToHtml(full),
            },
          })
          .eq('id', assistantRow.id)
          .eq('user_id', user.id)
          .select()
          .single()

        if (finalErr || !finalRow) {
          send({ type: 'error', error: finalErr?.message || 'Failed to finalize assistant message' })
          controller.close()
          return
        }

        // Bump thread title on first exchange if still default
        await supabase
          .from('ai_threads')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', threadId)
          .eq('user_id', user.id)

        send({ type: 'done', message: finalRow })
        controller.close()
      } catch (err: any) {
        send({ type: 'error', error: err?.message || 'Stream failed' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
