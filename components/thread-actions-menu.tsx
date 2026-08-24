'use client'

// Thread click menu — same Notion-style chrome as BlockActionsMenu / text-select popup.

import { useEffect, useLayoutEffect, useRef, useState } from 'react' // Escape close + arrange flyout + in-window place
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Info,
  Link2,
  Lock,
  PaintRoller,
  Plus,
  ClipboardPaste,
  Trash2,
  Upload,
  Spline,
  Minus,
} from 'lucide-react' // Row icons matching FigJam-style action list
import { Button } from '@/components/ui/button' // Ghost row buttons
import { cn } from '@/lib/utils' // Class merge
import { applyMenuPlacement, getThreadCoverRects, watchMenuSafeRect } from '@/lib/menu-placement' // Stay in-window, miss top bar / chat / thread curve

/** Actions the thread menu can emit (wired + stubs). */
export type ThreadActionId =
  | 'copy'
  | 'copyLink'
  | 'duplicate'
  | 'delete'
  | 'copyStyle'
  | 'pasteStyle'
  | 'lock'
  | 'insertBetween'
  | 'saveAsTemplate'
  | 'info'
  | 'collapse'
  | 'toggleDotted'
  | 'styleSmooth'
  | 'styleSharp'
  | 'styleLinear'
  | 'thickness1'
  | 'thickness2'
  | 'thickness3'
  | 'thickness4'

export type ThreadActionsMenuProps = {
  x: number // Pane-relative screen x (click point)
  y: number // Pane-relative screen y (click point)
  isDotted?: boolean // Current dash state for Solid/Dotted label
  isCollapsedLabel?: 'Collapse' | 'Expand' // Connected-frames collapse toggle
  canPasteStyle?: boolean // Enables Paste style when a style was copied
  currentStyle?: 'smooth' | 'sharp' | 'linear' // Checkmark in Style → path style
  currentStrokeWidth?: number // Checkmark in Thickness flyout (1–4)
  onAction: (action: ThreadActionId) => void // Parent wires delete / insert / style
  onClose: () => void // Dismiss on Escape / outside
  edgeId?: string // Clicked thread RF id — avoid its path even before .selected
  sourceId?: string // Source frame id — don't cover the snapped pair
  targetId?: string // Target frame id
  className?: string
}

type RowDef =
  | {
      kind: 'action'
      id: ThreadActionId
      label: string
      shortcut?: string
      icon: React.ReactNode
      danger?: boolean
      disabled?: boolean
      submenu?: 'arrange' | 'info' | 'thickness'
      trailingIcon?: React.ReactNode // e.g. save-as-template glyph
    }
  | { kind: 'separator' }

/** Notion-style floating menu for a selected thread (RF edge). */
export function ThreadActionsMenu({
  x,
  y,
  isDotted = false,
  isCollapsedLabel = 'Collapse',
  canPasteStyle = false,
  currentStyle = 'smooth',
  currentStrokeWidth = 2,
  onAction,
  onClose,
  edgeId,
  sourceId,
  targetId,
  className,
}: ThreadActionsMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<'arrange' | 'info' | 'thickness' | null>(null) // Flyout
  const rootRef = useRef<HTMLDivElement>(null) // Root for Escape focus

  useEffect(() => {
    rootRef.current?.focus() // Keyboard Escape works immediately
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current // Menu shell
    if (!root) return // Not mounted
    const place = () =>
      applyMenuPlacement(root, {
        anchorX: x, // Click on the thread
        anchorY: y,
        openLeft: false, // Prefer the right of the curve
        fromExisting: false, // Re-score every time so a tall card cannot clamp onto the arch
        extraHard: getThreadCoverRects(edgeId, sourceId, targetId), // Never cover the curve or its frames
      })
    place()
    return watchMenuSafeRect(place)
  }, [x, y, openSubmenu, edgeId, sourceId, targetId])

  // FigJam-shaped list, product terms (thread / frame), Thinktable row chrome
  const rows: RowDef[] = [
    {
      kind: 'action',
      id: 'copy',
      label: 'Copy',
      shortcut: '⌘C',
      icon: <Copy className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'copyLink',
      label: 'Copy link',
      shortcut: '⌘⌥⇧C',
      icon: <Link2 className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: '⌘D',
      icon: <Copy className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'delete',
      label: 'Delete',
      shortcut: 'Del',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'copyStyle',
      label: 'Copy style',
      shortcut: '⌘⌥C',
      icon: <PaintRoller className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'pasteStyle',
      label: 'Paste style',
      shortcut: '⌘⌥V',
      icon: <ClipboardPaste className="h-4 w-4" />,
      disabled: !canPasteStyle,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'styleSmooth', // Host opens Style submenu; id unused for click when submenu set
      label: 'Style',
      icon: <Spline className="h-4 w-4" />,
      submenu: 'arrange',
    },
    {
      kind: 'action',
      id: 'thickness2', // Host opens Thickness submenu; id unused for click when submenu set
      label: 'Thickness',
      icon: <Minus className="h-4 w-4" />,
      submenu: 'thickness',
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'lock',
      label: 'Lock',
      shortcut: '⌘⇧L',
      icon: <Lock className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'insertBetween',
      label: 'Insert frame',
      icon: <Plus className="h-4 w-4" />,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'toggleDotted',
      label: isDotted ? 'Solid' : 'Dotted',
      icon: <PaintRoller className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'collapse',
      label: isCollapsedLabel,
      icon:
        isCollapsedLabel === 'Collapse' ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        ),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'saveAsTemplate',
      label: 'Save as template',
      icon: <Upload className="h-4 w-4" />,
      trailingIcon: <Upload className="h-3.5 w-3.5 text-gray-400" />,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'info',
      label: 'Info',
      icon: <Info className="h-4 w-4" />,
      submenu: 'info',
    },
  ]

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cn(
        // Same shell as BlockActionsMenu — white card, soft shadow, constant screen size
        'thread-actions-menu edge-popup node-popup z-[1000] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[240px] outline-none',
        'absolute',
        className
      )}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(8px, -50%)', // First paint: right of click, not on the arch
        transformOrigin: 'left center',
      }}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (openSubmenu) setOpenSubmenu(null)
          else onClose()
        }
      }}
    >
      <div className="px-2.5 pt-1.5 pb-1 text-xs text-gray-500 dark:text-gray-400">Thread</div>

      <div data-tt-menu-body className="flex flex-col gap-0.5 overflow-y-auto px-0.5 pb-0.5">
        {rows.map((row, index) => {
          if (row.kind === 'separator') {
            return (
              <div
                key={`sep-${index}`}
                className="my-1 h-px bg-gray-100 dark:bg-[#2f2f2f] mx-1"
              />
            )
          }
          const hasSub = Boolean(row.submenu)
          const isArrangeOpen = row.submenu === 'arrange' && openSubmenu === 'arrange'
          const isInfoOpen = row.submenu === 'info' && openSubmenu === 'info'
          const isThicknessOpen = row.submenu === 'thickness' && openSubmenu === 'thickness'
          return (
            <Button
              key={`${row.id}-${row.label}`}
              variant="ghost"
              size="sm"
              disabled={row.disabled}
              onMouseEnter={() => {
                if (row.submenu === 'arrange') setOpenSubmenu('arrange')
                else if (row.submenu === 'info') setOpenSubmenu('info')
                else if (row.submenu === 'thickness') setOpenSubmenu('thickness')
                else setOpenSubmenu(null)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (row.disabled) return
                if (row.submenu === 'arrange') {
                  setOpenSubmenu((s) => (s === 'arrange' ? null : 'arrange'))
                  return
                }
                if (row.submenu === 'info') {
                  setOpenSubmenu((s) => (s === 'info' ? null : 'info'))
                  return
                }
                if (row.submenu === 'thickness') {
                  setOpenSubmenu((s) => (s === 'thickness' ? null : 'thickness'))
                  return
                }
                onAction(row.id)
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal',
                row.danger && 'text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
                row.disabled && 'opacity-40 pointer-events-none',
                (isArrangeOpen || isInfoOpen || isThicknessOpen) && 'bg-gray-100 dark:bg-[#2a2a2a]'
              )}
            >
              <span className="mr-2 text-gray-500 dark:text-gray-400">{row.icon}</span>
              <span className="flex-1 text-left">{row.label}</span>
              {row.trailingIcon && !hasSub && (
                <span className="ml-2">{row.trailingIcon}</span>
              )}
              {row.shortcut && !hasSub && (
                <span className="ml-3 text-[11px] text-gray-400 tabular-nums">{row.shortcut}</span>
              )}
              {hasSub && <ChevronRight className="h-3.5 w-3.5 ml-1 text-gray-400" />}
            </Button>
          )
        })}
      </div>

      {/* Style → path style (Smooth / Sharp / Linear) */}
      {openSubmenu === 'arrange' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] min-w-[180px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('arrange')}
        >
          {(
            [
              { id: 'styleSmooth' as const, label: 'Smooth' },
              { id: 'styleSharp' as const, label: 'Sharp' },
              { id: 'styleLinear' as const, label: 'Linear' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAction(opt.id)
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal w-full',
                currentStyle ===
                  (opt.id === 'styleSmooth'
                    ? 'smooth'
                    : opt.id === 'styleSharp'
                      ? 'sharp'
                      : 'linear') && 'bg-blue-50 dark:bg-blue-950/40'
              )}
            >
              <span className="flex-1 text-left">{opt.label}</span>
            </Button>
          ))}
        </div>
      )}

      {/* Thickness → 1–4px stroke */}
      {openSubmenu === 'thickness' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] min-w-[140px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1"
          onMouseEnter={() => setOpenSubmenu('thickness')}
        >
          {(
            [
              { id: 'thickness1' as const, label: '1px', width: 1 },
              { id: 'thickness2' as const, label: '2px', width: 2 },
              { id: 'thickness3' as const, label: '3px', width: 3 },
              { id: 'thickness4' as const, label: '4px', width: 4 },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAction(opt.id)
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal w-full',
                currentStrokeWidth === opt.width && 'bg-blue-50 dark:bg-blue-950/40'
              )}
            >
              <span className="flex-1 text-left">{opt.label}</span>
            </Button>
          ))}
        </div>
      )}

      {/* Info stub flyout — placeholder until thread metadata UI exists */}
      {openSubmenu === 'info' && (
        <div
          data-tt-menu-flyout="main"
          className="absolute z-[1001] min-w-[180px] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2 text-xs text-gray-500"
          onMouseEnter={() => setOpenSubmenu('info')}
        >
          Thread info coming soon
        </div>
      )}
    </div>
  )
}
