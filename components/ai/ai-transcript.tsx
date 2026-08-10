'use client'

// Transcript of AI turns — each turn is a draggable block for drop-onto-page
import { useState } from 'react' // Local edit state
import type { AiMessage, AiChatBlockDragPayload } from '@/lib/ai/types' // Types
import { AI_CHAT_BLOCK_MIME } from '@/lib/ai/types' // MIME
import { plainToHtml } from '@/lib/ai/context-pack' // HTML for drop
import { cn } from '@/lib/utils' // cn
import { GripVertical, Bookmark, Loader2 } from 'lucide-react' // Icons

interface AiTranscriptProps {
  messages: AiMessage[] // Turns
  streamingId?: string | null // Assistant id currently streaming
  onEditUserMessage: (messageId: string, content: string) => Promise<void> // Cursor-style edit
  onSaveSnapshot: (message: AiMessage) => Promise<void> // Save context snapshot
}

export function AiTranscript({
  messages,
  streamingId,
  onEditUserMessage,
  onSaveSnapshot,
}: AiTranscriptProps) {
  const [editingId, setEditingId] = useState<string | null>(null) // Inline edit target
  const [draft, setDraft] = useState('') // Edit draft
  const [busyId, setBusyId] = useState<string | null>(null) // Per-row busy

  const startEdit = (m: AiMessage) => {
    if (m.role !== 'user') return // Only user turns
    setEditingId(m.id) // Enter edit
    setDraft(m.content) // Seed draft
  }

  const commitEdit = async () => {
    if (!editingId) return // Guard
    const id = editingId // Capture
    const text = draft.trim() // Normalize
    if (!text) return // Require content
    setBusyId(id) // Busy
    try {
      await onEditUserMessage(id, text) // Truncate + regenerate
      setEditingId(null) // Exit
    } finally {
      setBusyId(null) // Clear
    }
  }

  const onDragStart = (event: React.DragEvent, m: AiMessage) => {
    const plain = m.content || '' // Plain body
    const html =
      typeof m.metadata?.html === 'string' ? (m.metadata.html as string) : plainToHtml(plain) // Prefer stored html
    const payload: AiChatBlockDragPayload = {
      source: 'ai-chat-block', // Discriminator
      messageId: m.id, // Origin
      plain, // Text
      html, // HTML
    }
    event.dataTransfer.setData(AI_CHAT_BLOCK_MIME, JSON.stringify(payload)) // Primary MIME
    event.dataTransfer.setData('text/plain', plain) // Fallback
    event.dataTransfer.effectAllowed = 'copy' // Copy onto page
  }

  if (messages.length === 0) return null // Empty handled by parent

  return (
    <div className="flex flex-col gap-3 w-full max-w-[320px] mx-auto">
      {messages.map((m) => {
        const isUser = m.role === 'user' // Role
        const isStreaming = m.id === streamingId || m.status === 'streaming' // Stream flag
        return (
          <div
            key={m.id}
            className={cn(
              'group relative rounded-lg border border-transparent px-2 py-2',
              'hover:border-black/10 dark:hover:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]',
              isUser ? 'bg-black/[0.03] dark:bg-white/[0.04]' : ''
            )}
          >
            <div className="flex items-start gap-1.5">
              <button
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, m)}
                className="mt-0.5 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing"
                title="Drag onto page as a frame"
                aria-label="Drag chat block onto page"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                  {isUser ? 'You' : 'Thinktable'}
                  {isStreaming && (
                    <Loader2 className="inline ml-1 h-3 w-3 animate-spin" />
                  )}
                </div>

                {editingId === m.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="w-full min-h-[72px] text-sm rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-[#1a1a1a] px-2 py-1.5 resize-y"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === m.id || !draft.trim()}
                        onClick={() => void commitEdit()}
                        className="text-xs font-medium px-2 py-1 rounded-md bg-[#2383e2] text-white disabled:opacity-50"
                      >
                        Save & regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs px-2 py-1 rounded-md text-gray-600 dark:text-gray-300 hover:bg-black/[0.04]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      'text-sm whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100',
                      isUser && 'cursor-text'
                    )}
                    onDoubleClick={() => startEdit(m)}
                    title={isUser ? 'Double-click to edit and regenerate' : undefined}
                  >
                    {m.content || (isStreaming ? '…' : '')}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/[0.04]"
                title="Save as context snapshot"
                aria-label="Save as context snapshot"
                disabled={busyId === m.id}
                onClick={async () => {
                  setBusyId(m.id)
                  try {
                    await onSaveSnapshot(m)
                  } finally {
                    setBusyId(null)
                  }
                }}
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
