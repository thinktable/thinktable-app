// POST /api/ai/chat — Ask streams in sidebar; Edit proposes page mutations (pending review)
import { createClient } from '@/lib/supabase/server'
import {
  askSystemPrompt,
  editSystemPrompt,
  buildContextPack,
  formatContextPack,
  plainToHtml,
} from '@/lib/ai/context-pack'
import { skillHintsForIds } from '@/lib/ai/skills'
import { isSelectableAiMode } from '@/lib/ai/modes'
import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await request.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  let threadId = typeof body.threadId === 'string' ? body.threadId : null
  const pageId = typeof body.pageId === 'string' ? body.pageId : null
  const mode = isSelectableAiMode(body.mode) ? body.mode : 'ask'
  const selectedFrameIds = Array.isArray(body.selectedFrameIds)
    ? body.selectedFrameIds.filter((id: unknown) => typeof id === 'string')
    : []
  const snapshotIds = Array.isArray(body.snapshotIds)
    ? body.snapshotIds.filter((id: unknown) => typeof id === 'string')
    : []
  const skipUserInsert = body.skipUserInsert === true

  if (!message) return new Response('Missing message', { status: 400 })

  if (!threadId) {
    const { data: created, error: createErr } = await supabase
      .from('ai_threads')
      .insert({
        user_id: user.id,
        title: message.slice(0, 60) || 'New AI chat',
        mode,
        page_id: pageId,
        metadata: {},
      })
      .select()
      .single()
    if (createErr || !created) {
      return new Response(JSON.stringify({ error: createErr?.message || 'Failed to create thread' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    threadId = created.id
  } else {
    const { data: thread } = await supabase
      .from('ai_threads')
      .select('id, metadata, page_id')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!thread) return new Response('Thread not found', { status: 404 })
  }

  await supabase
    .from('ai_threads')
    .update({
      updated_at: new Date().toISOString(),
      mode,
      ...(pageId ? { page_id: pageId } : {}),
    })
    .eq('id', threadId)
    .eq('user_id', user.id)

  const { data: threadRow } = await supabase
    .from('ai_threads')
    .select('metadata')
    .eq('id', threadId)
    .single()
  const meta = (threadRow?.metadata || {}) as Record<string, unknown>
  const skillIds = Array.isArray(meta.skillIds)
    ? (meta.skillIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []

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
        metadata: { mode },
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

  const systemPrompt =
    mode === 'edit'
      ? editSystemPrompt(skillHintsForIds(skillIds))
      : askSystemPrompt(skillHintsForIds(skillIds))

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: formatContextPack(pack) },
    ...((history || []) as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

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

        const { data: assistantRow, error: asstErr } = await supabase
          .from('ai_messages')
          .insert({
            thread_id: threadId,
            user_id: user.id,
            role: 'assistant',
            content: '',
            parts: [],
            status: 'streaming',
            metadata: { mode },
          })
          .select()
          .single()

        if (asstErr || !assistantRow) {
          send({ type: 'error', error: asstErr?.message || 'Failed to create assistant message' })
          controller.close()
          return
        }

        send({ type: 'message', message: assistantRow })

        let full = ''

        if (mode === 'edit') {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: openaiMessages,
            temperature: 0.5,
            max_tokens: 3000,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'thinktable_edit_response',
                strict: true,
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['reply', 'edits'],
                  properties: {
                    reply: { type: 'string' },
                    edits: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['frameId', 'summary', 'replacements', 'contentHtml'],
                        properties: {
                          frameId: { type: 'string' },
                          summary: { type: 'string' },
                          // Prefer surgical replacements; leave empty when using contentHtml full rewrite
                          replacements: {
                            type: 'array',
                            items: {
                              type: 'object',
                              additionalProperties: false,
                              required: ['oldText', 'newText'],
                              properties: {
                                oldText: { type: 'string' },
                                newText: { type: 'string' },
                              },
                            },
                          },
                          // Full-frame HTML only when a full rewrite is required; otherwise ""
                          contentHtml: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          })

          const raw = completion.choices[0]?.message?.content || '{"reply":"","edits":[]}'
          let parsed: {
            reply?: string
            edits?: Array<{
              frameId: string
              contentHtml?: string
              summary: string
              replacements?: Array<{ oldText: string; newText: string }>
            }>
          }
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = { reply: raw, edits: [] }
          }
          full = parsed.reply || ''
          if (full) send({ type: 'text', text: full })

          const frameIds = new Set(pack.frames.map((f) => f.id))
          const validEdits = (parsed.edits || []).filter((e) => frameIds.has(e.frameId))

          const enriched: Array<{
            frameId: string
            contentHtml?: string
            summary: string
            actionLogId?: string
            originalContent?: string
            replacements?: Array<{ oldText: string; newText: string }>
          }> = []

          for (const e of validEdits) {
            const { data: msg } = await supabase
              .from('messages')
              .select('id, content')
              .eq('id', e.frameId)
              .maybeSingle()
            if (!msg) continue
            const replacements = (e.replacements || []).filter((r) => (r.oldText || '').trim())
            const { data: action } = await supabase
              .from('ai_action_log')
              .insert({
                user_id: user.id,
                thread_id: threadId,
                message_id: assistantRow.id,
                kind: 'update_frame',
                payload: {
                  frameId: e.frameId,
                  contentHtml: e.contentHtml || '',
                  replacements,
                  summary: e.summary,
                },
                inverse: { frameId: e.frameId, contentHtml: msg.content },
                status: 'pending',
              })
              .select('id')
              .single()
            enriched.push({
              frameId: e.frameId,
              contentHtml: e.contentHtml || '',
              summary: e.summary || 'Update frame',
              actionLogId: action?.id,
              originalContent: msg.content as string,
              replacements,
            })
          }

          if (enriched.length) send({ type: 'edits', edits: enriched })
        } else {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: openaiMessages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2048,
          })

          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (!delta) continue
            full += delta
            send({ type: 'text', text: delta })
          }
        }

        const parts = [{ type: 'text', text: full }]
        const { data: finalRow, error: finalErr } = await supabase
          .from('ai_messages')
          .update({
            content: full,
            parts,
            status: 'complete',
            metadata: {
              mode,
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
