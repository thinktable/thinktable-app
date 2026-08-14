// POST /api/ai/chat — Ask streams in sidebar; Edit proposes page mutations (pending review)
import { createClient } from '@/lib/supabase/server'
import {
  askSystemPrompt,
  editSystemPrompt,
  buildContextPack,
  formatContextPack,
} from '@/lib/ai/context-pack'
import { skillHintsForIds } from '@/lib/ai/skills'
import { isSelectableAiMode } from '@/lib/ai/modes'
import { newBlockMetadata } from '@/lib/blocks'
import { markHtmlWithAiPending } from '@/lib/ai/wrap-ai-html'
import { frameContentFromAi, markdownToTipTapHtml } from '@/lib/ai/markdown-to-tiptap'
import type { AiProposedEdit } from '@/lib/ai/types'
import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const CREATE_FRAME_GAP = 320 // Horizontal spacing between newly created frames

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/** Normalize model contentHtml — convert markdown-ish to TipTap when needed. */
function normalizeEditHtml(contentHtml: string): string {
  const raw = (contentHtml || '').trim()
  if (!raw) return ''
  return markdownToTipTapHtml(raw)
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
  const boardId = typeof body.boardId === 'string' ? body.boardId : null
  const mode = isSelectableAiMode(body.mode) ? body.mode : 'ask'
  const selectedFrameIds = Array.isArray(body.selectedFrameIds)
    ? body.selectedFrameIds.filter((id: unknown) => typeof id === 'string')
    : []
  const snapshotIds = Array.isArray(body.snapshotIds)
    ? body.snapshotIds.filter((id: unknown) => typeof id === 'string')
    : []
  const boardCaptures = Array.isArray(body.boardCaptures)
    ? body.boardCaptures
        .filter(
          (c: unknown) =>
            c &&
            typeof c === 'object' &&
            typeof (c as { createdAt?: unknown }).createdAt === 'string' &&
            typeof (c as { boardPath?: unknown }).boardPath === 'string'
        )
        .map((c: { createdAt: string; boardPath: string; text?: string }) => ({
          createdAt: c.createdAt,
          boardPath: c.boardPath,
          text: typeof c.text === 'string' ? c.text.slice(0, 4000) : '',
        }))
    : []
  // Per-turn skill pills from the composer (merged with thread metadata below)
  const requestSkillIds = Array.isArray(body.skillIds)
    ? body.skillIds.filter((id: unknown) => typeof id === 'string')
    : []
  const skipUserInsert = body.skipUserInsert === true
  const viewportCenter =
    body.viewportCenter &&
    typeof body.viewportCenter.x === 'number' &&
    typeof body.viewportCenter.y === 'number'
      ? { x: body.viewportCenter.x as number, y: body.viewportCenter.y as number }
      : { x: 0, y: 0 }

  if (!message) return new Response('Missing message', { status: 400 })

  if (!threadId) {
    const { data: created, error: createErr } = await supabase
      .from('ai_threads')
      .insert({
        user_id: user.id,
        title: message.slice(0, 60) || 'New AI chat',
        mode,
        board_id: boardId,
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
      .select('id, metadata, board_id')
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
      ...(boardId ? { board_id: boardId } : {}),
    })
    .eq('id', threadId)
    .eq('user_id', user.id)

  const { data: threadRow } = await supabase
    .from('ai_threads')
    .select('metadata')
    .eq('id', threadId)
    .single()
  const meta = (threadRow?.metadata || {}) as Record<string, unknown>
  const threadSkillIds = Array.isArray(meta.skillIds)
    ? (meta.skillIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  // Composer pills win for this turn; fall back to thread defaults
  const skillIds = [...new Set([...requestSkillIds, ...threadSkillIds])]

  // Persist attached skills onto the thread so follow-ups keep the same skill set
  if (requestSkillIds.length) {
    await supabase
      .from('ai_threads')
      .update({
        metadata: { ...meta, skillIds },
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId)
      .eq('user_id', user.id)
  }

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
        metadata: { mode, skillIds },
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
    boardId,
    selectedFrameIds,
    snapshotIds,
    boardCaptures,
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
                  required: ['reply', 'capabilityGap', 'edits', 'creates', 'threads'],
                  properties: {
                    reply: { type: 'string' },
                    // Non-empty = unsupported request; leave mutations empty and wait for user confirm
                    capabilityGap: { type: 'string' },
                    edits: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['frameId', 'summary', 'replacements', 'contentHtml'],
                        properties: {
                          frameId: { type: 'string' },
                          summary: { type: 'string' },
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
                          contentHtml: { type: 'string' },
                        },
                      },
                    },
                    creates: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['tempId', 'title', 'contentMarkdown', 'summary'],
                        properties: {
                          tempId: { type: 'string' },
                          title: { type: 'string' },
                          contentMarkdown: { type: 'string' },
                          summary: { type: 'string' },
                        },
                      },
                    },
                    threads: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['sourceTempId', 'targetTempId', 'summary'],
                        properties: {
                          sourceTempId: { type: 'string' },
                          targetTempId: { type: 'string' },
                          summary: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          })

          const raw =
            completion.choices[0]?.message?.content ||
            '{"reply":"","capabilityGap":"","edits":[],"creates":[],"threads":[]}'
          let parsed: {
            reply?: string
            capabilityGap?: string
            edits?: Array<{
              frameId: string
              contentHtml?: string
              summary: string
              replacements?: Array<{ oldText: string; newText: string }>
            }>
            creates?: Array<{
              tempId: string
              title: string
              contentMarkdown: string
              summary: string
            }>
            threads?: Array<{
              sourceTempId: string
              targetTempId: string
              summary: string
            }>
          }
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = { reply: raw, capabilityGap: '', edits: [], creates: [], threads: [] }
          }
          full = parsed.reply || ''
          const capabilityGap = (parsed.capabilityGap || '').trim()
          const enriched: AiProposedEdit[] = []

          // Gap: explain + wait for confirm — do not mutate the board yet
          if (capabilityGap) {
            if (!full.includes(capabilityGap)) {
              full = full ? `${full}\n\n${capabilityGap}` : capabilityGap
            }
            if (full) send({ type: 'text', text: full })
          } else {
            const frameIds = new Set(pack.frames.map((f) => f.id))
            const validEdits = (parsed.edits || []).filter((e) => frameIds.has(e.frameId))

            for (const e of validEdits) {
              const { data: msg } = await supabase
                .from('messages')
                .select('id, content')
                .eq('id', e.frameId)
                .maybeSingle()
              if (!msg) continue
              const replacements = (e.replacements || []).filter((r) => (r.oldText || '').trim())
              const contentHtml = normalizeEditHtml(e.contentHtml || '')
              const { data: action } = await supabase
                .from('ai_action_log')
                .insert({
                  user_id: user.id,
                  thread_id: threadId,
                  message_id: assistantRow.id,
                  kind: 'update_frame',
                  payload: {
                    frameId: e.frameId,
                    contentHtml,
                    replacements,
                    summary: e.summary,
                  },
                  inverse: { frameId: e.frameId, contentHtml: msg.content },
                  status: 'pending',
                })
                .select('id')
                .single()
              enriched.push({
                kind: 'update_frame',
                frameId: e.frameId,
                contentHtml,
                summary: e.summary || 'Update frame',
                actionLogId: action?.id,
                originalContent: msg.content as string,
                replacements,
              })
            }

            const creates = parsed.creates || []
            const threads = parsed.threads || []
            const tempToMessageId = new Map<string, string>()
            const existingFrameIds = new Set(pack.frames.map((f) => f.id))

            /** Resolve thread endpoint: create tempId or existing frame UUID. */
            const resolveEndpoint = (id: string): string | null => {
              const key = (id || '').trim()
              if (!key) return null
              if (tempToMessageId.has(key)) return tempToMessageId.get(key)!
              if (existingFrameIds.has(key)) return key
              return null
            }

            if (creates.length > 0 && !boardId) {
              full =
                (full ? full + '\n\n' : '') +
                'I need an open page to place frames — open a page and try again in Edit mode.'
            } else if (creates.length > 0 && boardId) {
              const n = creates.length
              const startX = viewportCenter.x - ((n - 1) * CREATE_FRAME_GAP) / 2

              for (let i = 0; i < creates.length; i++) {
                const c = creates[i]
                const tempId = (c.tempId || `c${i}`).trim()
                if (!tempId || tempToMessageId.has(tempId)) continue

                const rawHtml = frameContentFromAi(c.title || '', c.contentMarkdown || '')
                const markedHtml = markHtmlWithAiPending(rawHtml)
                const position = {
                  x: startX + i * CREATE_FRAME_GAP,
                  y: viewportCenter.y,
                }

                const { data: msg, error: msgErr } = await supabase
                  .from('messages')
                  .insert({
                    conversation_id: boardId,
                    user_id: user.id,
                    role: 'user',
                    content: markedHtml,
                    metadata: newBlockMetadata({
                      position,
                      fadeIn: true,
                      aiPendingEdit: true,
                      fromAiEdit: true,
                      hasAiOrigin: false,
                    }),
                  })
                  .select('id, content')
                  .single()

                if (msgErr || !msg) {
                  console.error('AI create_frame insert failed:', msgErr)
                  continue
                }

                tempToMessageId.set(tempId, msg.id)

                const { data: action } = await supabase
                  .from('ai_action_log')
                  .insert({
                    user_id: user.id,
                    thread_id: threadId,
                    message_id: assistantRow.id,
                    kind: 'create_frame',
                    payload: {
                      frameId: msg.id,
                      tempId,
                      summary: c.summary,
                    },
                    inverse: { frameId: msg.id },
                    status: 'pending',
                  })
                  .select('id')
                  .single()

                enriched.push({
                  kind: 'create_frame',
                  frameId: msg.id,
                  tempId,
                  contentHtml: markedHtml,
                  summary: c.summary || 'Create frame',
                  actionLogId: action?.id,
                  originalContent: '',
                })
              }
            }

            // Threads may run with creates and/or existing frame ids (needs boardId)
            if (threads.length > 0 && boardId) {
              for (const t of threads) {
                const sourceId = resolveEndpoint(t.sourceTempId)
                const targetId = resolveEndpoint(t.targetTempId)
                if (!sourceId || !targetId || sourceId === targetId) continue

                const { data: existingEdges } = await supabase
                  .from('panel_edges')
                  .select('id')
                  .eq('conversation_id', boardId)
                  .or(
                    `and(source_message_id.eq.${sourceId},target_message_id.eq.${targetId}),and(source_message_id.eq.${targetId},target_message_id.eq.${sourceId})`
                  )
                if (existingEdges && existingEdges.length > 0) continue

                const { data: edge, error: edgeErr } = await supabase
                  .from('panel_edges')
                  .insert({
                    conversation_id: boardId,
                    user_id: user.id,
                    source_message_id: sourceId,
                    target_message_id: targetId,
                    metadata: {},
                  })
                  .select('id')
                  .single()

                let edgeId = edge?.id as string | undefined
                if (edgeErr || !edgeId) {
                  if (String(edgeErr?.message || '').includes('metadata')) {
                    const retry = await supabase
                      .from('panel_edges')
                      .insert({
                        conversation_id: boardId,
                        user_id: user.id,
                        source_message_id: sourceId,
                        target_message_id: targetId,
                      })
                      .select('id')
                      .single()
                    if (retry.error || !retry.data) {
                      console.error('AI create_thread insert failed:', retry.error || edgeErr)
                      continue
                    }
                    edgeId = retry.data.id
                  } else {
                    console.error('AI create_thread insert failed:', edgeErr)
                    continue
                  }
                }

                const { data: action } = await supabase
                  .from('ai_action_log')
                  .insert({
                    user_id: user.id,
                    thread_id: threadId,
                    message_id: assistantRow.id,
                    kind: 'create_thread',
                    payload: {
                      edgeId,
                      sourceFrameId: sourceId,
                      targetFrameId: targetId,
                      summary: t.summary,
                    },
                    inverse: { edgeId },
                    status: 'pending',
                  })
                  .select('id')
                  .single()

                enriched.push({
                  kind: 'create_thread',
                  edgeId,
                  frameId: sourceId,
                  sourceFrameId: sourceId,
                  targetFrameId: targetId,
                  summary: t.summary || 'Link frames',
                  actionLogId: action?.id,
                })
              }
            }

            if (full) send({ type: 'text', text: full })
            if (enriched.length) send({ type: 'edits', edits: enriched })
          }
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
              // TipTap blocks (lists → listItem grips), not one plain paragraph
              html: markdownToTipTapHtml(full),
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
