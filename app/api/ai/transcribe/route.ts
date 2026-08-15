// POST /api/ai/transcribe — STT for AI composer voice memos
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const MAX_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI not configured' }, { status: 500 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const raw = form.get('audio')
  if (!(raw instanceof Blob) || raw.size === 0) {
    return NextResponse.json({ error: 'Missing audio' }, { status: 400 })
  }
  if (raw.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Audio too large' }, { status: 413 })
  }

  const name =
    raw instanceof File && raw.name
      ? raw.name
      : raw.type.includes('mp4')
        ? 'memo.mp4'
        : raw.type.includes('ogg')
          ? 'memo.ogg'
          : 'memo.webm'

  try {
    // toFile ensures a proper Uploadable with filename for format detection
    const file = await toFile(raw, name, { type: raw.type || 'audio/webm' })
    const transcript = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    })
    const text = (transcript.text || '').trim()
    return NextResponse.json({ text })
  } catch (err) {
    console.error('Transcribe failed (gpt-4o-mini-transcribe):', err)
    // Fallback for accounts that only have whisper-1
    try {
      const file = await toFile(raw, name, { type: raw.type || 'audio/webm' })
      const transcript = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'en',
        temperature: 0,
      })
      const text = (transcript.text || '').trim()
      return NextResponse.json({ text })
    } catch (err2) {
      console.error('Transcribe failed (whisper-1):', err2)
      return NextResponse.json({ error: 'Transcription failed' }, { status: 502 })
    }
  }
}
