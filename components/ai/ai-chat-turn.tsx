'use client'

// One AI chat turn as a frame-like box: select → blue adjust + connection points;
// TipTap body with board-style ⋮⋮; drag when selected; threads to board frames.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { ReactFlowProvider } from 'reactflow'
import { Loader2 } from 'lucide-react'
import type { AiMessage, AiChatBlockDragPayload } from '@/lib/ai/types'
import { AI_CHAT_BLOCK_MIME } from '@/lib/ai/types'
import { markdownToTipTapHtml } from '@/lib/ai/markdown-to-tiptap'
import { createPanelExtensions } from '@/lib/tiptap/extensions'
import { TipTapBlockHandles } from '@/components/tiptap-block-handles'
import { BLOCK_HANDLE_GUTTER_W } from '@/lib/frame-adjust-box'
import { useReactFlowContext } from '@/components/react-flow-context'
import { cn } from '@/lib/utils'
import {
  type AiChatBoardLink,
  type ChatTurnSide,
  chatThreadPath,
  chatThreadSeamCrossYs,
  nearestFrameSide,
  newChatBoardLinkId,
  readChatBoardLinks,
  sideAnchor,
  withChatBoardLinks,
} from '@/lib/ai/chat-board-links'
import {
  chatSidebarSeamX,
  clearChatSeamGaps,
  publishChatSeamGaps,
} from '@/lib/ai/chat-sidebar-seam'

const SIDES: ChatTurnSide[] = ['left', 'right', 'top', 'bottom']

type AiChatTurnProps = {
  message: AiMessage
  selected: boolean
  streaming?: boolean
  conversationId?: string // Board id — ⋮⋮ drop onto map creates a frame
  onSelect: (id: string) => void
  onSoftSave: (messageId: string, patch: { content: string; html: string; metadata?: Record<string, unknown> }) => Promise<void>
  onLinksChange: (messageId: string, links: AiChatBoardLink[]) => void
}

/** Indicator placement — centered on the frame edge (no outset; chat has no resize chrome). */
function indicatorStyle(side: ChatTurnSide): CSSProperties {
  if (side === 'left') return { left: 0, top: '50%', transform: 'translate(-50%, -50%)' }
  if (side === 'right') return { right: 0, top: '50%', transform: 'translate(50%, -50%)' }
  if (side === 'top') return { top: 0, left: '50%', transform: 'translate(-50%, -50%)' }
  return { bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' }
}

export function AiChatTurn({
  message,
  selected,
  streaming,
  conversationId,
  onSelect,
  onSoftSave,
  onLinksChange,
}: AiChatTurnProps) {
  const isUser = message.role === 'user'
  const turnRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { reactFlowInstance } = useReactFlowContext()
  const links = readChatBoardLinks(message.metadata)
  const [rubber, setRubber] = useState<{
    from: { x: number; y: number }
    to: { x: number; y: number }
    side: ChatTurnSide
  } | null>(null)

  const seedHtml = useMemo(() => {
    const stored = typeof message.metadata?.html === 'string' ? (message.metadata.html as string) : ''
    if (stored.trim()) return stored
    return markdownToTipTapHtml(message.content || '')
  }, [message.content, message.metadata?.html])

  const extensions = useMemo(() => createPanelExtensions(''), [])

  const editor = useEditor(
    {
      extensions,
      content: seedHtml,
      editable: selected && !streaming,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class:
            'prose prose-sm dark:prose-invert max-w-none focus:outline-none nokey text-sm text-gray-900 dark:text-gray-100',
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          const html = ed.getHTML()
          const content = ed.getText()
          void onSoftSave(message.id, {
            content,
            html,
            metadata: { ...(message.metadata || {}), html },
          })
        }, 500)
      },
    },
    [extensions]
  )

  // Sync editable when selection flips
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(selected && !streaming)
  }, [editor, selected, streaming])

  // Soft-replace content when the server message changes (stream / regenerate)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const cur = editor.getHTML()
    if (seedHtml && seedHtml !== cur && !editor.isFocused) {
      editor.commands.setContent(seedHtml, { emitUpdate: false })
    }
  }, [editor, seedHtml])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const startDrag = useCallback(
    (event: React.DragEvent) => {
      if (!selected) {
        event.preventDefault()
        return
      }
      // Text / any ⋮⋮ / indicators own their gestures — turn drag is chrome only
      const t = event.target as HTMLElement
      if (
        t.closest('.ProseMirror') ||
        t.closest('[data-tt-block-handle]') ||
        t.closest('[data-tt-gutter-hover]') ||
        t.closest('[data-tt-chat-indicator]')
      ) {
        event.preventDefault()
        return
      }
      const plain = editor?.getText() || message.content || ''
      const html = editor?.getHTML() || seedHtml
      const payload: AiChatBlockDragPayload = {
        source: 'ai-chat-block',
        messageId: message.id,
        plain,
        html,
        role: message.role,
      }
      event.dataTransfer.setData(AI_CHAT_BLOCK_MIME, JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
      const turn = turnRef.current
      if (!turn) return
      const rect = turn.getBoundingClientRect()
      const ghost = turn.cloneNode(true) as HTMLElement
      const radius = getComputedStyle(turn).borderRadius || '0.5rem'
      Object.assign(ghost.style, {
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        width: `${rect.width}px`,
        boxSizing: 'border-box',
        borderRadius: radius,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
      })
      document.body.appendChild(ghost)
      event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top)
      requestAnimationFrame(() => ghost.remove())
    },
    [selected, editor, message, seedHtml]
  )

  const onTurnPointerDown = (event: React.PointerEvent) => {
    // Select on press (board-like); don't steal ⋮⋮ / indicator / link clicks
    const t = event.target as HTMLElement
    if (t.closest('[data-tt-block-handle]') || t.closest('[data-tt-chat-indicator]')) return
    if (!selected) {
      event.stopPropagation()
      onSelect(message.id)
    }
  }

  const beginConnect = (side: ChatTurnSide, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const turn = turnRef.current
    if (!turn) return
    const from = sideAnchor(turn.getBoundingClientRect(), side)
    setRubber({ from, to: { x: event.clientX, y: event.clientY }, side })
    const pointerId = event.pointerId

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      setRubber((r) => (r ? { ...r, to: { x: ev.clientX, y: ev.clientY } } : null))
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerup', onUp)
      doc.removeEventListener('pointercancel', onUp)
      setRubber(null)
      // Hit a board frame under the pointer
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const nodeEl = el?.closest('.react-flow__node-chatPanel') as HTMLElement | null
      if (!nodeEl) return
      const frameMessageId =
        nodeEl.getAttribute('data-id') ||
        nodeEl.id?.replace(/^reactflow__node-/, '') ||
        ''
      // Prefer prompt message id from RF node data when available
      let resolvedId = frameMessageId
      try {
        const nodes = reactFlowInstance?.getNodes() || []
        const n = nodes.find((x) => x.id === frameMessageId || x.id === nodeEl.getAttribute('data-id'))
        const mid = n?.data?.promptMessage?.id as string | undefined
        if (mid) resolvedId = mid
        // RF node id is often the prompt message id already
        if (!mid && n?.id) resolvedId = n.id
      } catch {
        /* ignore */
      }
      if (!resolvedId || resolvedId === message.id) return
      const frameRect = nodeEl.getBoundingClientRect()
      const frameSide = nearestFrameSide(frameRect, ev.clientX, ev.clientY)
      const next: AiChatBoardLink = {
        id: newChatBoardLinkId(),
        frameMessageId: resolvedId,
        turnSide: side,
        frameSide,
      }
      // Replace link to the same frame if one exists
      const merged = [...links.filter((l) => l.frameMessageId !== resolvedId), next]
      onLinksChange(message.id, merged)
      void onSoftSave(message.id, {
        content: editor?.getText() || message.content,
        html: editor?.getHTML() || seedHtml,
        metadata: withChatBoardLinks(message.metadata, merged),
      })
    }
    const doc = document
    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
    doc.addEventListener('pointercancel', onUp)
  }

  // Thread overlay geometry when this turn is selected (+ punch sidebar seam gaps)
  const [threadPaths, setThreadPaths] = useState<string[]>([])
  const seamSourceId = `turn-${message.id}` // Settled threads for this turn
  const rubberSourceId = `rubber-${message.id}` // In-progress connect rubber band
  useEffect(() => {
    if (!selected || links.length === 0) {
      setThreadPaths([])
      clearChatSeamGaps(seamSourceId) // No visible threads → restore solid seam
      return
    }
    const paint = () => {
      const turn = turnRef.current
      if (!turn) return
      const turnRect = turn.getBoundingClientRect()
      const paths: string[] = []
      const seamYs: number[] = []
      const seamX = chatSidebarSeamX() // Left edge of chat column (client X)
      for (const link of links) {
        const nodes = reactFlowInstance?.getNodes() || []
        const n = nodes.find(
          (x) =>
            x.id === link.frameMessageId ||
            x.data?.promptMessage?.id === link.frameMessageId
        )
        const nodeEl = n
          ? (document.querySelector(`.react-flow__node[data-id="${n.id}"]`) as HTMLElement | null)
          : (document.querySelector(
              `.react-flow__node-chatPanel[data-id="${link.frameMessageId}"]`
            ) as HTMLElement | null)
        if (!nodeEl) continue
        const a = sideAnchor(turnRect, link.turnSide)
        const b = sideAnchor(nodeEl.getBoundingClientRect(), link.frameSide)
        paths.push(chatThreadPath(a, b, link.turnSide, link.frameSide))
        if (seamX != null) {
          seamYs.push(...chatThreadSeamCrossYs(a, b, link.turnSide, link.frameSide, seamX))
        }
      }
      setThreadPaths(paths)
      publishChatSeamGaps(seamSourceId, seamYs) // Gap divider where strokes cross
    }
    paint()
    const root = document.querySelector('.react-flow__viewport')
    const scroller = document.querySelector('[data-ai-transcript-scroll]')
    const ro = new ResizeObserver(paint)
    if (turnRef.current) ro.observe(turnRef.current)
    window.addEventListener('scroll', paint, true)
    window.addEventListener('resize', paint)
    root?.addEventListener('transitionend', paint)
    scroller?.addEventListener('scroll', paint)
    const id = window.setInterval(paint, 200) // Catch RF pan/zoom without store sub
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', paint, true)
      window.removeEventListener('resize', paint)
      root?.removeEventListener('transitionend', paint)
      scroller?.removeEventListener('scroll', paint)
      clearInterval(id)
      clearChatSeamGaps(seamSourceId)
    }
  }, [selected, links, reactFlowInstance, seamSourceId])

  // Rubber-band also punches the seam while dragging a new thread
  useEffect(() => {
    if (!rubber) {
      clearChatSeamGaps(rubberSourceId)
      return
    }
    const seamX = chatSidebarSeamX()
    if (seamX == null) {
      clearChatSeamGaps(rubberSourceId)
      return
    }
    const ys = chatThreadSeamCrossYs(rubber.from, rubber.to, rubber.side, 'left', seamX)
    publishChatSeamGaps(rubberSourceId, ys)
    return () => clearChatSeamGaps(rubberSourceId)
  }, [rubber, rubberSourceId])

  const hostId = `ai-turn-${message.id}` // TipTapBlockHandles register + findHostEditorAtPoint

  // Always reserve L/R ⋮⋮ column so select only paints the blue ring (no content jump)
  const gutter = BLOCK_HANDLE_GUTTER_W

  return (
    <>
      <div
        ref={turnRef}
        data-ai-turn={message.id}
        data-tt-host-id={hostId} // Block-drag drop target (same registry as board frames)
        data-ai-turn-selected={selected ? 'true' : undefined}
        draggable={selected}
        onDragStart={startDrag}
        onPointerDown={onTurnPointerDown}
        className={cn(
          'group relative rounded-lg', // Same radius as drag ghost
          selected ? 'z-10' : 'z-0',
          // Unselected prompts: light blue; responses clear
          !selected && isUser && 'bg-[#eaf4fc] dark:bg-[#152536]',
          selected && 'bg-white dark:bg-[#1a1a1a]'
        )}
        style={{
          paddingLeft: gutter, // ⋮⋮ column — same selected or not
          paddingRight: gutter, // Match board even L/R adjust chrome
          paddingTop: 4,
          paddingBottom: 4,
          ...(selected ? { boxShadow: 'inset 0 0 0 2px #3b82f6' } : null), // Blue ring only when selected
        }}
      >
        {/* Unselected link indicator */}
        {!selected && links.length > 0 && (
          <span
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500 border-2 border-white dark:border-[#202020]"
            title={`${links.length} thread${links.length === 1 ? '' : 's'} to board`}
            aria-label="Has board threads"
          />
        )}

        {/* Connection indicators — only while selected */}
        {selected &&
          SIDES.map((side) => (
            <div
              key={side}
              data-tt-chat-indicator={side}
              className="absolute z-30 h-3 w-3 rounded-full border border-white bg-blue-500 shadow-sm cursor-crosshair hover:bg-blue-600"
              style={indicatorStyle(side)}
              onPointerDown={(e) => beginConnect(side, e)}
            />
          ))}

        <ReactFlowProvider>
          <div className="relative w-full overflow-visible min-w-0">
            {selected && (
              <TipTapBlockHandles
                editor={editor}
                enabled
                isPanelSelected
                hostNodeId={hostId}
                conversationId={conversationId}
                handleGutterFlow={gutter}
                contentPadLeft={0}
                blockDragFromGrip // ⋮⋮ moves block(s), never the chat turn; drop→board copies a frame
                chatMessageRole={message.role}
                chatMessageId={message.id}
              />
            )}
            <EditorContent editor={editor} className="block w-full min-w-0" />
            {streaming && (
              <Loader2 className="absolute -top-0.5 right-0 h-3 w-3 animate-spin text-gray-400" />
            )}
          </div>
        </ReactFlowProvider>
      </div>

      {/* Rubber-band while connecting */}
      {rubber &&
        typeof document !== 'undefined' &&
        createPortal(
          <svg className="pointer-events-none fixed inset-0 z-[200]" width="100%" height="100%">
            <path
              d={chatThreadPath(rubber.from, rubber.to, rubber.side, 'left')}
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="6 4"
            />
          </svg>,
          document.body
        )}

      {/* Settled threads — only while this turn is selected */}
      {selected &&
        threadPaths.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <svg className="pointer-events-none fixed inset-0 z-[90]" width="100%" height="100%">
            {threadPaths.map((d, i) => (
              <path key={i} d={d} stroke="#3b82f6" strokeWidth="2" fill="none" />
            ))}
          </svg>,
          document.body
        )}
    </>
  )
}
