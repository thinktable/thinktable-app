'use client'

// Page preview via iframe. Nested RF inside a host node cannot pan/zoom (host `nopan`).
// Iframes inside a CSS-transformed RF node also get broken hit-testing — so the whole
// preview shell (chrome + iframe) is portaled to document.body and screen-synced to
// an in-item spacer. Keeping chrome+iframe in one fixed box stops the map from
// painting over the title bar.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow } from 'reactflow'
import { Expand, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useReactFlowContext } from '@/components/react-flow-context'
import {
  PREVIEW_READY_MESSAGE,
  PREVIEW_RESIZE_MESSAGE,
  PREVIEW_STYLE_MESSAGE,
  usePreviewFocus,
} from '@/lib/preview-focus-context'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const PREVIEW_HEIGHT = 360
const CHROME_HEIGHT = 32
const WARM_WIDTH = 480

type NestedBoardPreviewProps = {
  conversationId: string
  title: string
  onClose: () => void
  visible?: boolean
  fill?: boolean
  hostNodeId?: string // Host map item — chrome drag moves this node
}

type FrameBox = {
  top: number
  left: number
  width: number // Layout width (unscaled) — iframe resolution stays stable during host zoom
  height: number
  scale: number // Host zoom factor: visual size = layout × scale
}

function isPreviewFocusChrome(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('[data-page-preview]') ||
      target.closest('[data-page-preview-frame]') ||
      target.closest('[data-preview-style-chrome]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[role="menu"]') ||
      target.closest('[role="listbox"]')
  )
}

export function NestedBoardPreview({
  conversationId,
  title,
  onClose,
  visible = true,
  fill = false,
  hostNodeId,
}: NestedBoardPreviewProps) {
  const previewFocus = usePreviewFocus()
  const { setEditMenuPillMode, getSetNodes, reactFlowInstance } = useReactFlowContext()
  const { getNode } = useReactFlow() // Host node position for chrome-drag
  const router = useRouter()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null) // In-item box the portaled shell mirrors
  const dragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const [frameBox, setFrameBox] = useState<FrameBox | null>(null)
  const [loadedRule, setLoadedRule] = useState<'wide' | 'college' | 'narrow'>('college')
  const [loadedStyle, setLoadedStyle] = useState<'none' | 'dotted' | 'lined' | 'grid'>('dotted')
  const [navReady, setNavReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const isFocused = previewFocus?.focusedPageId === conversationId
  const embedSrc = `/embed/${conversationId}`

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setNavReady(false)
  }, [conversationId])

  // Sync portaled shell to spacer. Use layout size + CSS scale so host zoom doesn’t
  // change the iframe’s internal resolution (that was re-fitViewing nested items every frame).
  useEffect(() => {
    if (!mounted) return
    let raf = 0
    const tick = () => {
      if (visible && spacerRef.current) {
        const el = spacerRef.current
        const rect = el.getBoundingClientRect()
        const layoutW = Math.max(el.offsetWidth, 1)
        const layoutH = Math.max(el.offsetHeight, 1)
        // Screen size / layout size ≈ host viewport zoom (uniform under RF transform)
        const scale = rect.width / layoutW
        const next = {
          top: rect.top,
          left: rect.left,
          width: layoutW,
          height: layoutH,
          scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        }
        setFrameBox((prev) => {
          if (
            prev &&
            Math.abs(prev.top - next.top) < 0.5 &&
            Math.abs(prev.left - next.left) < 0.5 &&
            Math.abs(prev.width - next.width) < 0.5 &&
            Math.abs(prev.height - next.height) < 0.5 &&
            Math.abs(prev.scale - next.scale) < 0.001
          ) {
            return prev
          }
          return next
        })
      } else if (!visible) {
        setFrameBox({
          top: -10000,
          left: -10000,
          width: WARM_WIDTH,
          height: PREVIEW_HEIGHT,
          scale: 1,
        })
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [mounted, visible])

  // Only remasure embed when layout box changes — not when host zoom (scale) changes
  const layoutW = frameBox?.width
  const layoutH = frameBox?.height
  useEffect(() => {
    if (!visible || !layoutW || !layoutH || !iframeRef.current?.contentWindow) return
    if (layoutW < 16 || layoutH < CHROME_HEIGHT + 16) return
    iframeRef.current.contentWindow.postMessage(
      { type: PREVIEW_RESIZE_MESSAGE, pageId: conversationId, fit: true },
      window.location.origin
    )
  }, [conversationId, layoutW, layoutH, visible, navReady])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; pageId?: string } | null
      if (!data || data.type !== PREVIEW_READY_MESSAGE) return
      if (data.pageId !== conversationId) return
      setNavReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [conversationId])

  useEffect(() => {
    if (navReady) return
    const t = window.setTimeout(() => setNavReady(true), 1200)
    return () => window.clearTimeout(t)
  }, [navReady, conversationId])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .maybeSingle()
      if (cancelled) return
      const meta = (data?.metadata as Record<string, unknown>) || {}
      const rule = meta.boardRule
      const style = meta.boardStyle
      if (rule === 'wide' || rule === 'college' || rule === 'narrow') setLoadedRule(rule)
      if (style === 'none' || style === 'dotted' || style === 'lined' || style === 'grid') {
        setLoadedStyle(style)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  useEffect(() => {
    if (!isFocused || !previewFocus) return
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(
      {
        type: PREVIEW_STYLE_MESSAGE,
        boardRule: previewFocus.boardRule,
        boardStyle: previewFocus.boardStyle,
      },
      window.location.origin
    )
  }, [isFocused, previewFocus, previewFocus?.boardRule, previewFocus?.boardStyle])

  useEffect(() => {
    if (!visible || !isFocused || !previewFocus) return
    const onPointerDown = (event: PointerEvent) => {
      if (isPreviewFocusChrome(event.target)) return
      previewFocus.clearPreviewFocus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [visible, isFocused, previewFocus])

  useEffect(() => {
    return () => {
      if (previewFocus?.focusedPageId === conversationId) {
        previewFocus.clearPreviewFocus()
      }
    }
  }, [conversationId, previewFocus])

  const handleSelectChrome = () => {
    if (!previewFocus) return
    previewFocus.selectPreview({
      pageId: conversationId,
      title,
      boardRule: loadedRule,
      boardStyle: loadedStyle,
    })
    setEditMenuPillMode('view')
  }

  // Chrome is outside the RF node — drag here moves the host item manually
  const onChromePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (!hostNodeId) return
    const node = getNode(hostNodeId)
    if (!node) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onChromePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !hostNodeId) return
    const setNodes = getSetNodes()
    if (!setNodes) return
    // Convert screen delta → flow delta using current host zoom
    const zoom = reactFlowInstance?.getViewport?.()?.zoom || 1
    const dx = (e.clientX - dragRef.current.startX) / zoom
    const dy = (e.clientY - dragRef.current.startY) / zoom
    const nextX = dragRef.current.origX + dx
    const nextY = dragRef.current.origY + dy
    setNodes((nodes: any[]) =>
      nodes.map((n) =>
        n.id === hostNodeId ? { ...n, position: { x: nextX, y: nextY } } : n
      )
    )
  }

  const onChromePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) {
      // Click (no drag) → style focus
      handleSelectChrome()
      return
    }
    const moved =
      Math.abs(e.clientX - dragRef.current.startX) > 3 ||
      Math.abs(e.clientY - dragRef.current.startY) > 3
    dragRef.current = null
    if (!moved) handleSelectChrome()
  }

  const shell =
    mounted &&
    frameBox &&
    createPortal(
      <div
        data-page-preview={conversationId}
        className={cn(
          'flex flex-col overflow-hidden rounded-xl border bg-gray-50 dark:bg-[#0f0f0f]',
          isFocused
            ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-400/40'
            : 'border-gray-200 dark:border-[#2f2f2f]'
        )}
        style={{
          position: 'fixed',
          top: frameBox.top,
          left: frameBox.left,
          width: frameBox.width,
          height: frameBox.height,
          // Scale with host zoom; origin top-left so top/left stay glued to the spacer
          transform: frameBox.scale !== 1 ? `scale(${frameBox.scale})` : undefined,
          transformOrigin: 'top left',
          // Above map content; below page chrome (top bar / minimap / nav / brand = z-10+)
          zIndex: visible ? 5 : -1,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-center justify-between px-2 border-b shrink-0 cursor-grab active:cursor-grabbing',
            isFocused
              ? 'border-blue-400 bg-blue-50/90 dark:bg-blue-950/50'
              : 'border-gray-200 dark:border-[#2f2f2f] bg-white/80 dark:bg-[#1f1f1f]/80'
          )}
          style={{ height: CHROME_HEIGHT }}
          onPointerDown={onChromePointerDown}
          onPointerMove={onChromePointerMove}
          onPointerUp={onChromePointerUp}
          onPointerCancel={() => {
            dragRef.current = null
          }}
          title="Drag to move item · click to edit page style"
        >
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
            {title || 'Page'}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
              title="Open page map"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/board/${conversationId}`)
              }}
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
              title="Close preview"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                previewFocus?.clearPreviewFocus()
                onClose()
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0">
          <iframe
            ref={iframeRef}
            data-page-preview-frame={conversationId}
            title={title || 'Page preview'}
            src={embedSrc}
            className="absolute inset-0 w-full h-full border-0 bg-gray-50 dark:bg-[#0f0f0f]"
            onLoad={() => {
              const win = iframeRef.current?.contentWindow
              if (!win) return
              win.postMessage(
                { type: PREVIEW_RESIZE_MESSAGE, pageId: conversationId, fit: true },
                window.location.origin
              )
              if (!isFocused || !previewFocus) return
              win.postMessage(
                {
                  type: PREVIEW_STYLE_MESSAGE,
                  boardRule: previewFocus.boardRule,
                  boardStyle: previewFocus.boardStyle,
                },
                window.location.origin
              )
            }}
          />
          {visible && !navReady && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/70 dark:bg-[#0f0f0f]/70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading page…
            </div>
          )}
        </div>
      </div>,
      document.body
    )

  return (
    <>
      {/* In-item spacer only — portaled shell paints here in screen space */}
      <div
        ref={spacerRef}
        className={cn(
          'w-full min-w-[280px]',
          fill ? 'flex-1 min-h-0 h-full' : 'shrink-0',
          !visible && 'hidden'
        )}
        style={{ height: fill ? '100%' : PREVIEW_HEIGHT }}
        aria-hidden
      />
      {shell}
    </>
  )
}

/** Prefetch lean embed document so the first open isn’t a cold Next navigation. */
export function prefetchPageEmbed(conversationId: string) {
  if (typeof window === 'undefined' || !conversationId) return
  const href = `/embed/${conversationId}`
  if (document.querySelector(`link[data-tt-embed-prefetch="${conversationId}"]`)) return
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.href = href
  link.as = 'document'
  link.setAttribute('data-tt-embed-prefetch', conversationId)
  document.head.appendChild(link)
}
