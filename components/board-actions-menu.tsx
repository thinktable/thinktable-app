'use client'

// Board right-click menu — empty pane context menu (same Notion chrome as frame/thread menus).

import { useEffect, useRef } from 'react' // Escape close + autofocus
import {
  Scan, // Capture — 4 disconnected rounded corners
  ClipboardPaste,
  Link2,
  Maximize2,
  Plus,
  Redo2,
  SquareMousePointer,
  Undo2,
  ZoomIn,
} from 'lucide-react' // Row icons
import { Button } from '@/components/ui/button' // Ghost row buttons
import { cn } from '@/lib/utils' // Class merge

/** Actions the board menu can emit (wired + stubs). */
export type BoardActionId =
  | 'addFrame'
  | 'paste'
  | 'selectAll'
  | 'undo'
  | 'redo'
  | 'zoomToFit'
  | 'zoomTo100'
  | 'copyLink'
  | 'capture' // Capture the current board view

export type BoardActionsMenuProps = {
  x: number // Pane-relative screen x (click point)
  y: number // Pane-relative screen y (click point)
  canUndo?: boolean // Enables Undo when history exists
  canRedo?: boolean // Enables Redo when history exists
  canPaste?: boolean // Enables Paste when a frame clipboard exists
  onAction: (action: BoardActionId) => void // Parent wires create / zoom / undo
  onClose: () => void // Dismiss on Escape / outside
  className?: string
}

type RowDef =
  | {
      kind: 'action'
      id: BoardActionId
      label: string
      shortcut?: string
      icon: React.ReactNode
      disabled?: boolean
    }
  | { kind: 'separator' }

/** Notion-style floating menu for empty-board right-click. */
export function BoardActionsMenu({
  x,
  y,
  canUndo = false,
  canRedo = false,
  canPaste = false,
  onAction,
  onClose,
  className,
}: BoardActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null) // Root for Escape focus

  useEffect(() => {
    rootRef.current?.focus() // Keyboard Escape works immediately
  }, [])

  const rows: RowDef[] = [
    {
      kind: 'action',
      id: 'addFrame',
      label: 'Add frame',
      icon: <Plus className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'paste',
      label: 'Paste',
      shortcut: '⌘V',
      icon: <ClipboardPaste className="h-4 w-4" />,
      disabled: !canPaste,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'selectAll',
      label: 'Select all',
      shortcut: '⌘A',
      icon: <SquareMousePointer className="h-4 w-4" />,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'undo',
      label: 'Undo',
      shortcut: '⌘Z',
      icon: <Undo2 className="h-4 w-4" />,
      disabled: !canUndo,
    },
    {
      kind: 'action',
      id: 'redo',
      label: 'Redo',
      shortcut: '⌘⇧Z',
      icon: <Redo2 className="h-4 w-4" />,
      disabled: !canRedo,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'zoomToFit',
      label: 'Zoom to fit',
      shortcut: '⇧1',
      icon: <Maximize2 className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'zoomTo100',
      label: 'Zoom to 100%',
      shortcut: '⇧0',
      icon: <ZoomIn className="h-4 w-4" />,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'copyLink',
      label: 'Copy link',
      icon: <Link2 className="h-4 w-4" />,
    },
    {
      kind: 'action',
      id: 'capture',
      label: 'Capture',
      icon: <Scan className="h-4 w-4" />,
    },
  ]

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cn(
        // Same shell as ThreadActionsMenu / BlockActionsMenu
        'board-actions-menu node-popup z-[1000] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 min-w-[240px] outline-none',
        'absolute',
        className
      )}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -100%)', // Anchor above click
        transformOrigin: 'center bottom',
        marginTop: '-8px',
      }}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="px-2.5 pt-1.5 pb-1 text-xs text-gray-500 dark:text-gray-400">Board</div>

      <div className="flex flex-col gap-0.5 max-h-[420px] overflow-y-auto px-0.5 pb-0.5">
        {rows.map((row, index) => {
          if (row.kind === 'separator') {
            return (
              <div
                key={`sep-${index}`}
                className="my-1 h-px bg-gray-100 dark:bg-[#2f2f2f] mx-1"
              />
            )
          }
          return (
            <Button
              key={`${row.id}-${row.label}`}
              variant="ghost"
              size="sm"
              disabled={row.disabled}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (row.disabled) return
                onAction(row.id)
              }}
              className={cn(
                'justify-start text-sm h-8 px-2 font-normal',
                row.disabled && 'opacity-40 pointer-events-none'
              )}
            >
              <span className="mr-2 text-gray-500 dark:text-gray-400">{row.icon}</span>
              <span className="flex-1 text-left">{row.label}</span>
              {row.shortcut && (
                <span className="ml-3 text-[11px] text-gray-400 tabular-nums">{row.shortcut}</span>
              )}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
