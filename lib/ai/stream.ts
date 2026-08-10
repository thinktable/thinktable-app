// Client helpers to parse /api/ai SSE streams
import type { AiStreamEvent } from './types' // Event union

/** Parse one `data: {...}` SSE line into an AiStreamEvent (or null). */
export function parseAiSseLine(line: string): AiStreamEvent | null {
  const trimmed = line.trim() // Normalize
  if (!trimmed.startsWith('data:')) return null // Not an SSE data line
  const raw = trimmed.slice(5).trim() // Strip prefix
  if (!raw || raw === '[DONE]') return null // Heartbeat / end
  try {
    return JSON.parse(raw) as AiStreamEvent // Typed parse
  } catch {
    return null // Ignore malformed
  }
}

/** Read an SSE Response body, invoking onEvent for each parsed chunk. */
export async function consumeAiSse(
  response: Response, // Fetch response
  onEvent: (event: AiStreamEvent) => void // Callback
): Promise<void> {
  if (!response.body) throw new Error('No response body') // Guard
  const reader = response.body.getReader() // Stream reader
  const decoder = new TextDecoder() // UTF-8
  let buffer = '' // Incomplete line buffer
  while (true) { // Until done
    const { done, value } = await reader.read() // Next chunk
    if (done) break // EOF
    buffer += decoder.decode(value, { stream: true }) // Append
    const parts = buffer.split('\n') // Split lines
    buffer = parts.pop() || '' // Keep incomplete last line
    for (const part of parts) { // Complete lines
      const event = parseAiSseLine(part) // Parse
      if (event) onEvent(event) // Dispatch
    }
  }
  if (buffer.trim()) { // Flush remainder
    const event = parseAiSseLine(buffer) // Parse
    if (event) onEvent(event) // Dispatch
  }
}
