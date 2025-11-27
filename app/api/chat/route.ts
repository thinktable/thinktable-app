// Chat API route with streaming
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { conversationId, message } = body

    if (!conversationId || !message) {
      return new Response('Missing conversationId or message', { status: 400 })
    }

    // Fetch conversation to verify ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.user_id !== user.id) {
      return new Response('Conversation not found', { status: 404 })
    }

    // Fetch conversation messages for context
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20) // Limit context to last 20 messages

    // Build messages array for OpenAI
    const openaiMessages = [
      {
        role: 'system' as const,
        content: 'You are a helpful AI assistant for Thinkable, a visual mind mapping tool. Help users explore ideas and create visual representations of their thoughts.',
      },
      ...(messages || []).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: message,
      },
    ]

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: openaiMessages,
            stream: true,
          })

          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              controller.enqueue(`data: ${JSON.stringify({ content })}\n\n`)
            }
          }

          controller.enqueue('data: [DONE]\n\n')
          controller.close()
        } catch (error: any) {
          console.error('OpenAI API error:', error)
          controller.enqueue(`data: ${JSON.stringify({ error: error.message })}\n\n`)
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('Chat API error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

