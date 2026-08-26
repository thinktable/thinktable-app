'use client'

// Floating menu for a selected image block — resize, crop, remove background, blur, replace.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Crop,
  Eraser,
  EyeOff,
  ImagePlus,
  Scaling,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { applyMenuPlacement, watchMenuSafeRect } from '@/lib/menu-placement'

export type ImageBlockMenuAction =
  | 'resize'
  | 'crop'
  | 'removeBackground'
  | 'blur'
  | 'replace'

export type ImageResizePreset = 25 | 50 | 75 | 100

type ImageBlockMenuProps = {
  anchor: { left: number; top: number; width: number; height: number }
  widthPct: number
  hazed: boolean
  onAction: (action: ImageBlockMenuAction, payload?: { widthPct?: ImageResizePreset }) => void
  onClose: () => void
}

const RESIZE_PRESETS: { pct: ImageResizePreset; label: string }[] = [
  { pct: 25, label: 'Small' },
  { pct: 50, label: 'Medium' },
  { pct: 75, label: 'Large' },
  { pct: 100, label: 'Full width' },
]

/** Notion-style menu anchored to the selected image. */
export function ImageBlockMenu({
  anchor,
  widthPct,
  hazed,
  onAction,
  onClose,
}: ImageBlockMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [openSubmenu, setOpenSubmenu] = useState<'resize' | null>(null)
  const anchorX = anchor.left + anchor.width / 2
  const anchorY = anchor.top + anchor.height / 2

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const place = () =>
      applyMenuPlacement(root, {
        anchorX,
        anchorY,
        openLeft: false,
        fromExisting: openSubmenu != null,
      })
    place()
    const raf = requestAnimationFrame(place)
    const stop = watchMenuSafeRect(place)
    return () => {
      cancelAnimationFrame(raf)
      stop()
    }
  }, [anchorX, anchorY, openSubmenu])

  const rows = [
    {
      id: 'resize' as const,
      label: 'Resize',
      icon: <Scaling className="h-4 w-4" />,
      submenu: 'resize' as const,
    },
    {
      id: 'crop' as const,
      label: 'Crop',
      icon: <Crop className="h-4 w-4" />,
    },
    {
      id: 'removeBackground' as const,
      label: 'Remove background',
      icon: <Eraser className="h-4 w-4" />,
    },
    {
      id: 'blur' as const,
      label: hazed ? 'Unblur' : 'Blur',
      icon: <EyeOff className="h-4 w-4" />,
    },
    {
      id: 'replace' as const,
      label: 'Replace',
      icon: <ImagePlus className="h-4 w-4" />,
    },
  ]

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      data-tt-image-menu
      className="fixed z-[1001] w-[200px] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 outline-none"
      onMouseDown={(e) => {
        e.preventDefault() // Keep editor node selection while interacting with the menu
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (openSubmenu) setOpenSubmenu(null)
          else onClose()
        }
      }}
    >
      <div className="px-2.5 pt-1.5 pb-1 text-xs text-gray-500 dark:text-gray-400">Image</div>
      <div data-tt-menu-body className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-0.5 pb-0.5">
        {rows.map((row) => {
          const hasSub = row.submenu === 'resize'
          const resizeOpen = hasSub && openSubmenu === 'resize'
          return (
            <Button
              key={row.id}
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (hasSub) setOpenSubmenu('resize')
                else setOpenSubmenu(null)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (hasSub) {
                  setOpenSubmenu((s) => (s === 'resize' ? null : 'resize'))
                  return
                }
                onAction(row.id)
              }}
              className={cn(
                'h-8 shrink-0 justify-start px-2 text-sm font-normal',
                resizeOpen && 'bg-gray-100 dark:bg-[#2a2a2a]'
              )}
            >
              <span className="mr-2 text-gray-500 dark:text-gray-400">{row.icon}</span>
              <span className="flex-1 text-left">{row.label}</span>
              {hasSub && <ChevronRight className="h-3.5 w-3.5 ml-1 text-gray-400" />}
            </Button>
          )
        })}
      </div>

      {openSubmenu === 'resize' && (
        <div
          data-tt-menu-flyout="main"
          data-tt-image-menu
          className="absolute z-[1002] min-w-[160px] tt-menu-surface rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('resize')}
        >
          {RESIZE_PRESETS.map((opt) => (
            <Button
              key={opt.pct}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAction('resize', { widthPct: opt.pct })
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal w-full',
                widthPct === opt.pct && 'bg-blue-50 dark:bg-blue-950/40'
              )}
            >
              <span className="flex-1 text-left">{opt.label}</span>
              <span className="text-[11px] text-gray-400 tabular-nums">{opt.pct}%</span>
            </Button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
