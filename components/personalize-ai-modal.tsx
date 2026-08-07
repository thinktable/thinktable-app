'use client'

// Notion-style "Personalize your AI" sample — logo preview + topper grid
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Lock, Pencil, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** localStorage key for the selected topper id (sample persistence) */
export const TT_TOPPER_STORAGE_KEY = 'thinktable-ai-topper'

/**
 * Sample toppers — swap `emoji` for `src` when you drop assets in /public/toppers/
 * e.g. { id: 'duck', label: 'Duck', src: '/toppers/duck.png' }
 */
export const SAMPLE_TOPPERS: Array<{
  id: string
  label: string
  emoji?: string
  src?: string // Optional image under /public/toppers/
  locked?: boolean
}> = [
  { id: 'hardhat', label: 'Hard hat', emoji: '⛑️' },
  { id: 'mustache', label: 'Mustache', emoji: '🥸' },
  { id: 'sweatband', label: 'Sweatband', emoji: '🎽' },
  { id: 'flower', label: 'Flower', emoji: '🌸' },
  { id: 'pencil', label: 'Pencil', emoji: '✏️' },
  { id: 'duck', label: 'Duck', emoji: '🦆' },
  { id: 'pepper', label: 'Pepper', emoji: '🌶️' },
  { id: 'cat', label: 'Cat', emoji: '🐱' },
  { id: 'crown', label: 'Crown', emoji: '👑' },
  { id: 'apple', label: 'Apple', emoji: '🍎' },
  { id: 'leaf', label: 'Leaf', emoji: '🍃' },
  { id: 'wand', label: 'Wand', emoji: '🪄' },
  { id: 'bowtie', label: 'Bow tie', emoji: '🎀' },
  { id: 'cowboy', label: 'Cowboy', emoji: '🤠' },
  { id: 'propeller', label: 'Propeller', emoji: '✈️' },
  { id: 'locked', label: 'Coming soon', locked: true },
]

/** Read persisted topper id (client-only) */
export function getStoredTopperId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TT_TOPPER_STORAGE_KEY)
}

/** Resolve a topper definition by id */
export function getTopperById(id: string | null) {
  if (!id) return null
  return SAMPLE_TOPPERS.find((t) => t.id === id && !t.locked) ?? null
}

type ThinktableBrandMarkProps = {
  topperId?: string | null
  size?: number // Logo box size in px
  className?: string
}

/** Logo + optional topper overlay (shared by sidebar + modal preview) */
export function ThinktableBrandMark({
  topperId = null,
  size = 56,
  className,
}: ThinktableBrandMarkProps) {
  const topper = getTopperById(topperId)
  const topperSize = Math.round(size * 0.42) // Topper scales with logo

  return (
    <div
      className={cn('relative flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <Image
        src="/thinktable-logo.svg"
        alt="Thinktable"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority
      />
      {/* Topper sits on the upper edge, Notion-style */}
      {topper && (
        <span
          className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none select-none leading-none"
          style={{
            top: -Math.round(topperSize * 0.45),
            width: topperSize,
            height: topperSize,
            fontSize: topperSize,
          }}
          aria-hidden
        >
          {topper.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={topper.src} alt="" className="h-full w-full object-contain" />
          ) : (
            topper.emoji
          )}
        </span>
      )}
    </div>
  )
}

type PersonalizeAiModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  topperId: string | null
  onTopperChange: (id: string | null) => void
}

export function PersonalizeAiModal({
  open,
  onOpenChange,
  topperId,
  onTopperChange,
}: PersonalizeAiModalProps) {
  // Draft selection while modal is open (commit on Done)
  const [draftId, setDraftId] = useState<string | null>(topperId)
  const [displayName, setDisplayName] = useState('Thinktable')

  // Sync draft when opening
  useEffect(() => {
    if (open) setDraftId(topperId)
  }, [open, topperId])

  const unlocked = SAMPLE_TOPPERS.filter((t) => !t.locked)
  const draftIndex = unlocked.findIndex((t) => t.id === draftId)

  const cycle = (dir: -1 | 1) => {
    if (unlocked.length === 0) return
    const next =
      draftIndex < 0
        ? dir === 1
          ? 0
          : unlocked.length - 1
        : (draftIndex + dir + unlocked.length) % unlocked.length
    setDraftId(unlocked[next].id)
  }

  const handleDone = () => {
    onTopperChange(draftId) // Parent (sidebar context) persists + syncs open icon
    onOpenChange(false)
  }

  const handleReset = () => {
    setDraftId(null)
    setDisplayName('Thinktable')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-[420px] p-0 gap-0 overflow-hidden',
          'bg-[#1a1a1a] border-white/10 text-gray-100',
          '[&>button]:hidden' // Hide default close; we render our own
        )}
      >
        <DialogTitle className="sr-only">Personalize your Thinktable AI</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a topper for your Thinktable AI avatar
        </DialogDescription>

        {/* Header */}
        <div className="relative flex items-center justify-center px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-gray-100">
            Personalize your Thinktable AI
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview + name */}
        <div className="flex flex-col items-center gap-4 px-6 pt-4 pb-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => cycle(-1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
              aria-label="Previous topper"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <ThinktableBrandMark topperId={draftId} size={88} className="my-2" />

            <button
              type="button"
              onClick={() => cycle(1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
              aria-label="Next topper"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Display name pill */}
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={cn(
              'w-full max-w-[220px] h-9 rounded-full px-4 text-center text-sm',
              'bg-[#2a2a2a] border border-white/10 text-gray-100',
              'placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50'
            )}
            placeholder="Name"
            aria-label="AI display name"
          />
        </div>

        {/* Instructions stub (sample) */}
        <div className="px-5 pb-4">
          <p className="text-xs font-medium text-gray-400 mb-2">Instructions</p>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#252525] border border-white/5 px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none" aria-hidden>
                🎓
              </span>
              <span className="text-sm text-gray-200 truncate">Default</span>
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 flex-shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
              title="Sample — edit coming later"
            >
              <Pencil className="h-3 w-3" />
              Edit instructions
            </button>
          </div>
        </div>

        {/* Topper grid */}
        <div className="px-5 pb-4">
          <div className="grid grid-cols-8 gap-1.5">
            {SAMPLE_TOPPERS.map((topper) => {
              const selected = !topper.locked && draftId === topper.id
              return (
                <button
                  key={topper.id}
                  type="button"
                  disabled={topper.locked}
                  onClick={() => {
                    if (!topper.locked) setDraftId(topper.id === draftId ? null : topper.id)
                  }}
                  title={topper.label}
                  aria-label={topper.label}
                  aria-pressed={selected}
                  className={cn(
                    'aspect-square rounded-lg flex items-center justify-center text-lg',
                    'bg-[#2a2a2a] border transition-colors',
                    topper.locked && 'opacity-40 cursor-not-allowed',
                    selected
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-transparent hover:border-white/20'
                  )}
                >
                  {topper.locked ? (
                    <Lock className="h-3.5 w-3.5 text-gray-500" />
                  ) : topper.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={topper.src} alt="" className="h-5 w-5 object-contain" />
                  ) : (
                    <span className="leading-none">{topper.emoji}</span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Drop custom toppers in <code className="text-gray-400">/public/toppers/</code> and set{' '}
            <code className="text-gray-400">src</code> on each entry.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-gray-400 hover:text-gray-100 transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="h-8 px-4 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
