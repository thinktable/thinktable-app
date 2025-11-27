// API route to generate board name from user prompt using AI structured output
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { prompt } = body

    if (!prompt) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }

    // Use structured output to generate a concise board name
    const completion = await openai.beta.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Generate a concise, descriptive title (2-5 words) for a conversation board based on the user\'s prompt. The title should capture the main topic or question.',
        },
        {
          role: 'user',
          content: `Generate a board title for this prompt: "${prompt}"`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'board_title',
          description: 'Board title generated from user prompt',
          schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'A concise board title (2-5 words)',
              },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      },
    })

    const parsed = completion.choices[0]?.message?.parsed
    const title = parsed?.title || prompt.slice(0, 50) // Fallback to truncated prompt

    return NextResponse.json({ title })
  } catch (error: any) {
    console.error('Board name generation error:', error)
    // Fallback: return a simple title based on prompt
    const body = await request.json()
    const prompt = body.prompt || 'New Conversation'
    const fallbackTitle = prompt.length > 50 ? prompt.slice(0, 47) + '...' : prompt
    
    return NextResponse.json({ title: fallbackTitle })
  }
}

