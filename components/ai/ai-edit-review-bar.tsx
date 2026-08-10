'use client'

// Bottom-of-page AI edit review bar (Excel Copilot-style)
import { Eye, EyeOff, Trash2, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAiEditSession } from '@/lib/ai/edit-session'
import { cn } from '@/lib/utils'

export function AiEditReviewBar() {
  const {
    pendingEdits,
    previewOriginal,
    setPreviewOriginal,
    saveAll,
    discardAll,
    focusedEditId,
    saveEdit,
    discardEdit,
    setFocusedEditId,
  } = useAiEditSession()
  const [busy, setBusy] = useState(false)

  if (pendingEdits.length === 0) return null

  const focused = focusedEditId
    ? pendingEdits.find((e) => e.id === focusedEditId)
    : null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'absolute bottom-4 left-1/2 -translate-x-1/2 z-30',
        'flex flex-col items-center gap-2 pointer-events-auto'
      )}
    >
      {focused && (
        <div className="flex items-center gap-1 rounded-full bg-white/95 dark:bg-[#1a1a1a]/95 border border-black/10 dark:border-white/10 shadow-lg px-2 py-1.5 text-xs">
          <span className="px-2 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">
            {focused.summary || 'Edit'}
          </span>
          <button
            type="button"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-black/[0.06]"
            title={previewOriginal ? 'Show proposed' : 'Show original'}
            onClick={() => setPreviewOriginal(!previewOriginal)}
          >
            {previewOriginal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-7 px-2 rounded-full flex items-center gap-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            title="Remove this change"
            onClick={() => void run(() => discardEdit(focused.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-7 px-2 rounded-full flex items-center gap-1 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            title="Save this change"
            onClick={() => void run(() => saveEdit(focused.id))}
          >
            <Check className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded-full text-gray-500 hover:bg-black/[0.06]"
            onClick={() => setFocusedEditId(null)}
          >
            Done
          </button>
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-1 rounded-full',
          'bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur',
          'border border-black/10 dark:border-white/10 shadow-xl',
          'px-2 py-1.5'
        )}
      >
        <span className="px-2 text-xs font-medium text-gray-700 dark:text-gray-200">
          {pendingEdits.length} AI edit{pendingEdits.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center transition-colors',
            previewOriginal
              ? 'bg-black/[0.08] dark:bg-white/[0.12]'
              : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'
          )}
          title={previewOriginal ? 'Showing original — click to see edits' : 'Preview original before edits'}
          onClick={() => setPreviewOriginal(!previewOriginal)}
        >
          {previewOriginal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          disabled={busy}
          className="h-8 px-3 rounded-full text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
          title="Remove all AI changes"
          onClick={() => void run(() => discardAll())}
        >
          Remove changes
        </button>
        <button
          type="button"
          disabled={busy}
          className="h-8 px-3 rounded-full text-xs font-medium bg-[#2383e2] text-white hover:bg-[#1a6fc9] disabled:opacity-50 flex items-center gap-1.5"
          title="Save all AI changes"
          onClick={() => void run(() => saveAll())}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save changes
        </button>
      </div>
    </div>
  )
}
