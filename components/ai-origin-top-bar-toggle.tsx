'use client'

// Top-bar sparkles toggle — pinned left of Share; right-click / phone hold unpins to More menu

import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAiEditSession } from '@/lib/ai/edit-session'
import { createLongPressController } from '@/lib/long-press'
import { usePhoneModeMenu } from './phone-mode-menu-context'
import { useSidebarContext } from './sidebar-context'

export function AiOriginTopBarToggle() {
  const {
    showAiOrigin,
    setShowAiOrigin,
    hasAiContent,
    aiTopBarPinned,
    setAiTopBarPinned,
  } = useAiEditSession()
  const { shareCompact } = usePhoneModeMenu() // Fold into board More with copy/star when the bar is tight
  const { isMobileMode } = useSidebarContext()
  const collapseToMore = isMobileMode || shareCompact
  const btnRef = useRef<HTMLButtonElement>(null)
  const longPressRef = useRef<ReturnType<typeof createLongPressController> | null>(null)

  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const lp = createLongPressController({
      onLongPress: () => {
        setAiTopBarPinned(false)
        return true
      },
    })
    longPressRef.current = lp
    const onDown = (e: PointerEvent) => lp.pointerDown(e)
    const onMove = (e: PointerEvent) => lp.pointerMove(e)
    const onUp = (e: PointerEvent) => lp.pointerUp(e)
    const onCancel = (e: PointerEvent) => lp.pointerCancel(e)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      lp.cancel()
      longPressRef.current = null
    }
  }, [setAiTopBarPinned])

  if (!hasAiContent || !aiTopBarPinned || collapseToMore) return null

  return (
    <div data-top-bar-ai-origin className="flex items-center px-1 flex-shrink-0">
      <Button
        ref={btnRef}
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 w-7 p-0 flex-shrink-0',
          showAiOrigin
            ? 'text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
        )}
        title={showAiOrigin ? 'Hide AI content highlight (right-click to unpin)' : 'Show AI-written content (right-click to unpin)'}
        aria-pressed={showAiOrigin}
        onClick={() => {
          if (longPressRef.current?.consumeFired()) return
          setShowAiOrigin(!showAiOrigin)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setAiTopBarPinned(false)
        }}
      >
        <Sparkles className="h-4 w-4" />
      </Button>
    </div>
  )
}
