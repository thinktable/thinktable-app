'use client'

// Property type glyph with a delayed portaled name tooltip (top strip + in-frame cells).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import {
  propertyTypeIcon,
  propertyTypeLabel,
  type PropertyTypeId,
} from '@/lib/blocks/property'

export const PROPERTY_TOOLTIP_DWELL_MS = 200 // Short hover before the name popup

export function PropertyIconWithTooltip({
  type,
  name = '',
  className,
  iconClassName = 'h-4 w-4',
  onPointerDown,
}: {
  type: PropertyTypeId
  name?: string // Notion column name when set
  className?: string
  iconClassName?: string
  onPointerDown?: (e: React.PointerEvent<HTMLSpanElement>) => void
}) {
  const label = name.trim() || propertyTypeLabel(type)
  const iconRef = useRef<HTMLSpanElement>(null)
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showTip, setShowTip] = useState(false)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)

  const placeTip = useCallback(() => {
    const el = iconRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTipPos({ left: r.left + r.width / 2, top: r.bottom + 6 })
  }, [])

  const clearDwell = useCallback(() => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current)
      dwellRef.current = null
    }
  }, [])

  useEffect(() => () => clearDwell(), [clearDwell])

  useEffect(() => {
    if (!showTip) {
      setTipPos(null)
      return
    }
    placeTip()
    const onReposition = () => placeTip()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [showTip, placeTip])

  return (
    <>
      <span
        ref={iconRef}
        data-tt-property-icon
        className={className}
        aria-label={`Property · ${label}`}
        onMouseEnter={() => {
          clearDwell()
          dwellRef.current = setTimeout(() => {
            placeTip()
            setShowTip(true)
          }, PROPERTY_TOOLTIP_DWELL_MS)
        }}
        onMouseLeave={() => {
          clearDwell()
          setShowTip(false)
        }}
        onPointerDown={onPointerDown}
      >
        {propertyTypeIcon(type, iconClassName)}
      </span>
      {showTip &&
        tipPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: tipPos.left,
              top: tipPos.top,
              transform: 'translateX(-50%)',
              zIndex: 100,
            }}
            className={cn(
              'pointer-events-none w-max max-w-[220px] rounded-md px-2 py-1 text-[11px] leading-snug',
              'bg-gray-900 text-gray-50 shadow-lg dark:bg-gray-100 dark:text-gray-900'
            )}
          >
            {label}
          </span>,
          document.body
        )}
    </>
  )
}
