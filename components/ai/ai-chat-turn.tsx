'use client'

// One AI chat turn as a frame-like box: hover → frame drag grip; select → blue
// adjust + ⋮⋮ block grips (drag body = whole turn); threads to board frames.

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
import { GripVertical, Loader2 } from 'lucide-react'
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
  flowSideAnchor,
  nearestFrameSide,
  newChatBoardLinkId,
  readChatBoardLinks,
  sideAnchor,
  withChatBoardLinks,
} from '@/lib/ai/chat-board-links'
import {
  clipChatThread,
  clientToThreadSvgSpace,
  chatSidebarColumnEl,
  chatSidebarColumnRect,
} from '@/lib/ai/chat-thread-clip'
import {
  chatSidebarSeamX,
  clearChatSeamGaps,
  publishChatSeamGaps,
} from '@/lib/ai/chat-sidebar-seam'
import {
  clearChatFrameThreadVisible,
  publishChatFrameThreadVisible,
} from '@/lib/ai/chat-frame-link-cues'

/** Grey simulated connection point when a thread stubs on the chat window edge. */
const STUB_FILL = '#9ca3af' // gray-400 — distinct from live blue indicators
const STUB_R = 6 // Same visual weight as the 12px chat-turn indicators

/** Brand T stroke from `connection logo 1.svg` — same mark as board ChatLinkConnectionCue. */
const LINK_LOGO_VIEWBOX = '0 0 306 453'
const LINK_LOGO_PATH =
  'M305.69,370.69v81.89c-23.91.07-47.52,1.1-70.92-4.46-53.59-12.87-89.49-54.84-93.95-109.89l.07-261.31H0V0h220.8v325.21c0,17.47,18.28,45.48,37.43,45.48h47.45Z'

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
      // Frame grip may drag while unselected; body drag only when selected
      const t = event.target as HTMLElement
      const fromFrameGrip = !!t.closest('[data-tt-frame-drag-handle]')
      if (!selected && !fromFrameGrip) {
        event.preventDefault()
        return
      }
      // Text / ⋮⋮ / thread indicators own their gestures — turn drag is chrome only
      if (
        !fromFrameGrip &&
        (t.closest('.ProseMirror') ||
          t.closest('[data-tt-block-handle]') ||
          t.closest('[data-tt-gutter-hover]') ||
          t.closest('[data-tt-chat-indicator]'))
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
    // Select on press (board-like); don't steal frame-grip / ⋮⋮ / indicator gestures
    const t = event.target as HTMLElement
    if (
      t.closest('[data-tt-frame-drag-handle]') ||
      t.closest('[data-tt-block-handle]') ||
      t.closest('[data-tt-chat-indicator]')
    ) {
      return
    }
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

  // Thread overlay: fixed SVG must track chat scroll without React setState lag
  const linksRef = useRef(links) // Latest links for paint without effect churn
  linksRef.current = links // Keep paint closure fresh across soft-saves
  const linksKey = links.map((l) => `${l.id}:${l.frameMessageId}:${l.turnSide}:${l.frameSide}`).join('|') // Stable effect dep
  const showThreadOverlay = selected && links.length > 0 // Mount empty SVG; fill imperatively
  const seamSourceId = `turn-${message.id}` // Settled threads for this turn
  const rubberSourceId = `rubber-${message.id}` // In-progress connect rubber band
  // Body (overlap when board free) + under-chrome (phone dock / desktop sidebar)
  const threadSvgRef = useRef<SVGSVGElement | null>(null)
  const threadUnderSvgRef = useRef<SVGSVGElement | null>(null)
  const [underHostEl, setUnderHostEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!showThreadOverlay) {
      setUnderHostEl(null)
      return
    }
    const sync = () => {
      const dock = document.querySelector('[data-chat-map-dock]')
      const root = document.querySelector('[data-board-root]') as HTMLElement | null
      if (dock && root) {
        setUnderHostEl(root) // Phone: stroke under the map dock cards
        return
      }
      setUnderHostEl(chatSidebarColumnEl()) // Desktop: stroke under the sidebar column
    }
    sync()
    const id = window.setInterval(sync, 400)
    return () => clearInterval(id)
  }, [showThreadOverlay])

  /** Clip scrolled-away desktop strokes to the map left of the sidebar seam only. */
  const syncLeftOfSeamClip = (svg: SVGSVGElement, seamX: number | null) => {
    let defs = svg.querySelector('defs')
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      svg.insertBefore(defs, svg.firstChild)
    }
    let cp = svg.querySelector('#tt-thread-left-of-seam') as SVGClipPathElement | null
    if (!cp) {
      cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
      cp.setAttribute('id', 'tt-thread-left-of-seam')
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', '0')
      rect.setAttribute('y', '0')
      cp.appendChild(rect)
      defs.appendChild(cp)
    }
    const rect = cp.querySelector('rect')
    if (!rect) return
    rect.setAttribute('width', String(seamX != null && seamX > 0 ? seamX : 0))
    rect.setAttribute('height', String(Math.max(window.innerHeight, 1)))
  }

  /** Sync path + stub children on one SVG root. */
  const syncSvgChildren = (
    svg: SVGSVGElement,
    paths: { d: string; clipLeftOfSeam?: boolean }[],
    stubs: { x: number; y: number }[]
  ) => {
    let pathCount = 0
    let stubCount = 0
    for (let i = 0; i < svg.childNodes.length; i++) {
      const el = svg.childNodes[i] as Element
      if (el.tagName.toLowerCase() === 'path') pathCount++
      else if (el.tagName.toLowerCase() === 'circle') stubCount++
    }
    while (pathCount < paths.length) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('stroke', '#3b82f6')
      p.setAttribute('stroke-width', '2')
      p.setAttribute('fill', 'none')
      const firstCircle = svg.querySelector('circle')
      if (firstCircle) svg.insertBefore(p, firstCircle)
      else svg.appendChild(p)
      pathCount++
    }
    while (pathCount > paths.length) {
      const pathsEls = svg.querySelectorAll('path')
      pathsEls[pathsEls.length - 1]?.remove()
      pathCount--
    }
    while (stubCount < stubs.length) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      c.setAttribute('r', String(STUB_R))
      c.setAttribute('fill', STUB_FILL)
      c.setAttribute('stroke', '#fff')
      c.setAttribute('stroke-width', '1')
      svg.appendChild(c)
      stubCount++
    }
    while (stubCount > stubs.length) {
      const circles = svg.querySelectorAll('circle')
      circles[circles.length - 1]?.remove()
      stubCount--
    }
    const pathEls = svg.querySelectorAll('path')
    for (let i = 0; i < paths.length; i++) {
      const el = pathEls[i]
      if (!el) continue
      el.setAttribute('d', paths[i].d)
      if (paths[i].clipLeftOfSeam) {
        el.setAttribute('clip-path', 'url(#tt-thread-left-of-seam)')
      } else {
        el.removeAttribute('clip-path')
      }
    }
    const circleEls = svg.querySelectorAll('circle')
    for (let i = 0; i < stubs.length; i++) {
      circleEls[i]?.setAttribute('cx', String(stubs[i].x))
      circleEls[i]?.setAttribute('cy', String(stubs[i].y))
    }
  }

  /** Write path `d` attrs (+ optional seam/logo publish) from live DOM rects. */
  const paintThreads = useCallback(
    (opts?: { skipPublish?: boolean }) => {
      const turn = turnRef.current
      const overlapSvg = threadSvgRef.current
      const underSvg = threadUnderSvgRef.current
      if (!turn || !overlapSvg) return
      const toUnder = (p: { x: number; y: number }) =>
        clientToThreadSvgSpace(p, underSvg?.parentElement ?? null)
      const turnRect = turn.getBoundingClientRect()
      const currentLinks = linksRef.current
      const overlapPaths: { d: string; clipLeftOfSeam?: boolean }[] = []
      const overlapStubs: { x: number; y: number }[] = []
      const underPaths: { d: string; clipLeftOfSeam?: boolean }[] = []
      const visibleBoardCues: { frameMessageId: string; side: ChatTurnSide }[] = []
      const seamYs: number[] = []
      const seamX = chatSidebarSeamX()
      const nodes = reactFlowInstance?.getNodes() || []
      const desktopSidebar = !!chatSidebarColumnRect()
      for (const link of currentLinks) {
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
        const aClient = sideAnchor(turnRect, link.turnSide)
        let bClient: { x: number; y: number } | null = null
        if (nodeEl) {
          bClient = sideAnchor(nodeEl.getBoundingClientRect(), link.frameSide)
        } else if (n && reactFlowInstance?.flowToScreenPosition) {
          const meta = n.data?.promptMessage?.metadata as Record<string, unknown> | undefined
          const dims = meta?.resizeDimensions as { width?: number; height?: number } | undefined
          const measured = (n as { measured?: { width?: number; height?: number } }).measured
          const w = n.width ?? measured?.width ?? dims?.width ?? 0
          const h = n.height ?? measured?.height ?? dims?.height ?? 0
          if (w > 0 && h > 0) {
            const pos = {
              x: n.positionAbsolute?.x ?? n.position.x,
              y: n.positionAbsolute?.y ?? n.position.y,
            }
            const flow = flowSideAnchor(pos, w, h, link.frameSide)
            bClient = reactFlowInstance.flowToScreenPosition(flow)
          }
        }
        if (!bClient) continue
        const clipped = clipChatThread(aClient, bClient, link.turnSide, link.frameSide)
        if (clipped.boardCovered && underSvg) {
          // Board behind/past chat — stroke under chrome, ends at side stub (phone + desktop)
          if (clipped.stub) {
            underPaths.push({
              d: chatThreadPath(
                toUnder(bClient),
                toUnder(clipped.stub),
                link.frameSide,
                clipped.stub.side
              ),
            })
            // Map-side tip left of the seam so the thread doesn’t vanish under the column
            if (desktopSidebar) {
              overlapPaths.push({
                d: chatThreadPath(bClient, clipped.stub, link.frameSide, clipped.stub.side),
                clipLeftOfSeam: true,
              })
            }
            overlapStubs.push({ x: clipped.stub.x, y: clipped.stub.y })
          } else if (clipped.path) {
            underPaths.push({
              d: chatThreadPath(toUnder(aClient), toUnder(bClient), link.turnSide, link.frameSide),
            })
          }
        } else if (clipped.stub && !clipped.reachesChat) {
          // Turn scrolled away — meet the grey dot; desktop keeps stroke left of the seam
          const d = chatThreadPath(bClient, clipped.stub, link.frameSide, clipped.stub.side)
          overlapPaths.push({ d, clipLeftOfSeam: desktopSidebar })
          overlapStubs.push({ x: clipped.stub.x, y: clipped.stub.y })
        } else if (clipped.path) {
          // Board free + turn visible — stroke may overlap chat to reach the turn
          overlapPaths.push({ d: clipped.path })
        }
        if (clipped.reachesBoard) {
          visibleBoardCues.push({ frameMessageId: link.frameMessageId, side: link.frameSide })
        }
        if (!opts?.skipPublish && seamX != null && clipped.path) {
          if (clipped.stub && !clipped.reachesChat) {
            seamYs.push(
              ...chatThreadSeamCrossYs(
                bClient,
                clipped.stub,
                link.frameSide,
                clipped.stub.side,
                seamX
              )
            )
          } else {
            seamYs.push(
              ...chatThreadSeamCrossYs(aClient, bClient, link.turnSide, link.frameSide, seamX)
            )
          }
        } else if (!opts?.skipPublish && seamX != null && clipped.stub) {
          seamYs.push(clipped.stub.y)
        }
      }
      syncLeftOfSeamClip(overlapSvg, desktopSidebar ? seamX : null)
      syncSvgChildren(overlapSvg, overlapPaths, overlapStubs)
      if (underSvg) syncSvgChildren(underSvg, underPaths, [])
      if (!opts?.skipPublish) {
        publishChatSeamGaps(seamSourceId, seamYs)
        publishChatFrameThreadVisible(seamSourceId, visibleBoardCues)
      }
    },
    [reactFlowInstance, seamSourceId]
  )

  // Board-side logo visibility is published inside paintThreads (respects clip stubs).
  // Link cues themselves are synced from ChatSidebar (survive desktop chat close).
  // Clear thread-visible marks on deselect / unmount so logos return when the overlay is gone.
  useEffect(() => {
    if (!showThreadOverlay) {
      clearChatFrameThreadVisible(seamSourceId)
      return
    }
    return () => {
      clearChatFrameThreadVisible(seamSourceId)
    }
  }, [showThreadOverlay, seamSourceId])

  useEffect(() => {
    if (!showThreadOverlay) {
      clearChatSeamGaps(seamSourceId) // No visible threads → restore solid seam
      return
    }
    let raf = 0 // Coalesce bursty events into one paint per frame
    let navSettle: number | undefined // After viewport stops mutating, flush seam/logo
    let midNav = false // True while RF transform is actively changing
    const schedule = (full = false) => {
      if (raf) return // Already queued for this frame
      raf = requestAnimationFrame(() => {
        raf = 0
        // Mid-nav: geometry only (skip React seam/logo publishes — those lagged + jumped)
        paintThreads({ skipPublish: midNav && !full })
      })
    }
    const onScrollOrResize = () => schedule(true) // Transcript / window — full publish
    const onViewportStyle = () => {
      midNav = true
      schedule(false) // Geometry only while panning/zooming
      if (navSettle !== undefined) window.clearTimeout(navSettle)
      navSettle = window.setTimeout(() => {
        midNav = false
        schedule(true) // Flush seam gaps + logo visibility after settle
      }, 120)
    }
    paintThreads() // Immediate first paint (portal may still be null)
    const boot = requestAnimationFrame(() => paintThreads()) // Retry after SVG portal commits
    const root = document.querySelector('.react-flow__viewport') as HTMLElement | null // RF camera
    const scroller = document.querySelector('[data-ai-transcript-scroll]') // Chat transcript
    const ro = new ResizeObserver(onScrollOrResize) // Turn size / streaming growth
    if (turnRef.current) ro.observe(turnRef.current)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    scroller?.addEventListener('scroll', onScrollOrResize, { passive: true })
    root?.addEventListener('transitionend', onScrollOrResize) // Animated fitView / etc.
    // RF pan/zoom mutates viewport style every frame — remasure in lockstep with the board frame
    const mo =
      root && new MutationObserver(onViewportStyle) // Same signal as selection-format-popup nav hide
    mo?.observe(root!, { attributes: true, attributeFilter: ['style'] })
    return () => {
      ro.disconnect()
      mo?.disconnect()
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      scroller?.removeEventListener('scroll', onScrollOrResize)
      root?.removeEventListener('transitionend', onScrollOrResize)
      if (navSettle !== undefined) window.clearTimeout(navSettle)
      cancelAnimationFrame(boot)
      if (raf) cancelAnimationFrame(raf)
      clearChatSeamGaps(seamSourceId)
    }
  }, [showThreadOverlay, linksKey, paintThreads, seamSourceId, underHostEl])

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
        {/* Frame drag grip — unselected only (hover on pointer; always on touch). Selected → ⋮⋮.
            Threaded turns: same brand line + blue simulator as board ChatLinkConnectionCue. */}
        {!selected && (
          <button
            type="button"
            data-tt-frame-drag-handle
            draggable
            onDragStart={startDrag}
            className={cn(
              'absolute left-0.5 top-1 z-20 flex h-5 items-center justify-center rounded',
              links.length > 0 ? 'w-auto min-w-5 px-0.5' : 'w-5', // Logo needs line+dot width
              links.length > 0
                ? null // Blue mark — no gray icon tint
                : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
              'cursor-grab active:cursor-grabbing',
              // Linked mark stays visible; unlinked grip: hover devices hide until turn hover
              links.length > 0
                ? 'opacity-100'
                : cn(
                    'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:pointer-events-none',
                    '[@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:pointer-events-auto',
                    'focus-visible:opacity-100 focus-visible:pointer-events-auto'
                  )
            )}
            title="Drag onto board as a frame, or onto the input as context"
            aria-label="Drag chat turn as frame"
          >
            {links.length > 0 ? (
              // Prior visual size (w=8); height matches aspect so meet doesn't letterbox above the stroke
              <span className="pointer-events-none flex flex-row items-start" aria-hidden>
                <svg
                  viewBox={LINK_LOGO_VIEWBOX}
                  preserveAspectRatio="xMinYMin meet"
                  className="shrink-0 block"
                  style={{ width: 8, height: 8 * (453 / 306), marginRight: 0.5 }}
                >
                  <path fill="#3b83f6" d={LINK_LOGO_PATH} />
                </svg>
                {/* Top of disc flush with top of T stroke */}
                <span
                  className="shrink-0 self-start rounded-full bg-[#3b83f6]"
                  style={{ width: 5, height: 5 }}
                />
              </span>
            ) : (
              <GripVertical className="h-3.5 w-3.5 pointer-events-none" />
            )}
          </button>
        )}

        {/* Connection indicators — only while selected (thread chrome, not the drag grip) */}
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
            {/* Block ⋮⋮ grips — only while the chat frame is selected */}
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

      {/* Settled threads: overlap (board free) + under-chrome (board behind dock/sidebar) */}
      {showThreadOverlay &&
        typeof document !== 'undefined' &&
        createPortal(
          <svg
            ref={threadSvgRef}
            className="pointer-events-none fixed inset-0 z-[90]"
            width="100%"
            height="100%"
          />,
          document.body
        )}
      {showThreadOverlay &&
        underHostEl &&
        createPortal(
          <svg
            ref={threadUnderSvgRef}
            data-tt-thread-under-dock="true"
            className={
              underHostEl.hasAttribute('data-board-root')
                ? 'pointer-events-none absolute inset-0 z-[40]' // Under phone dock (z-45)
                : 'pointer-events-none absolute inset-0 z-0' // Under desktop sidebar chrome
            }
            width="100%"
            height="100%"
          />,
          underHostEl
        )}
    </>
  )
}
