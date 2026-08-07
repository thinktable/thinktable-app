'use client'

// Page preview via iframe. Nested RF inside a host node cannot pan/zoom (host `nopan`).
// Critical: an iframe *descendant of a CSS-transformed RF node* has broken hit-testing —
// the map paints fully but only a sub-rect receives events (dead “white” zone until pan).
// Always portal the iframe to document.body and sync its box to an in-item slot.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
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
const WARM_WIDTH = 480 // Real size while warming so RF doesn’t init at 0×0

type NestedBoardPreviewProps = {
  conversationId: string
  title: string
  onClose: () => void
  visible?: boolean
}

type FrameBox = { top: number; left: number; width: number; height: number }

function isPreviewFocusChrome(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('[data-page-preview]') ||
      target.closest('[data-page-preview-frame]') || // Portaled iframe (not under data-page-preview)
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
}: NestedBoardPreviewProps) {
  const previewFocus = usePreviewFocus()
  const { setEditMenuPillMode } = useReactFlowContext()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const slotRef = useRef<HTMLDivElement>(null) // In-item box the portaled iframe mirrors
  const [frameBox, setFrameBox] = useState<FrameBox | null>(null)
  const [loadedRule, setLoadedRule] = useState<'wide' | 'college' | 'narrow'>('college')
  const [loadedStyle, setLoadedStyle] = useState<'none' | 'dotted' | 'lined' | 'grid'>('dotted')
  const [navReady, setNavReady] = useState(false)
  const [mounted, setMounted] = useState(false) // Portal only after client mount
  const isFocused = previewFocus?.focusedPageId === conversationId
  const embedSrc = `/embed/${conversationId}`

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setNavReady(false)
  }, [conversationId])

  // Track slot screen box every frame while open (host pan/zoom/drag moves the item)
  useEffect(() => {
    if (!mounted) return
    let raf = 0
    const tick = () => {
      if (visible && slotRef.current) {
        const rect = slotRef.current.getBoundingClientRect()
        const next = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }
        setFrameBox((prev) => {
          if (
            prev &&
            Math.abs(prev.top - next.top) < 0.5 &&
            Math.abs(prev.left - next.left) < 0.5 &&
            Math.abs(prev.width - next.width) < 0.5 &&
            Math.abs(prev.height - next.height) < 0.5
          ) {
            return prev
          }
          return next
        })
      } else if (!visible) {
        // Warm off-screen in true viewport coords (not inside RF transform)
        setFrameBox({
          top: -10000,
          left: -10000,
          width: WARM_WIDTH,
          height: PREVIEW_HEIGHT - CHROME_HEIGHT,
        })
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [mounted, visible])

  // When the portaled iframe’s box changes, ask embed to remasure its RF pane
  useEffect(() => {
    if (!frameBox || !iframeRef.current?.contentWindow) return
    if (frameBox.width < 16 || frameBox.height < 16) return
    iframeRef.current.contentWindow.postMessage(
      { type: PREVIEW_RESIZE_MESSAGE, pageId: conversationId },
      window.location.origin
    )
  }, [
    conversationId,
    frameBox?.width,
    frameBox?.height,
    visible,
    navReady,
  ])

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
      // Clicks on the portaled iframe element count as preview chrome
      if (event.target === iframeRef.current) return
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

  const iframePortal =
    mounted &&
    frameBox &&
    createPortal(
      <iframe
        ref={iframeRef}
        data-page-preview-frame={conversationId}
        title={title || 'Page preview'}
        src={embedSrc}
        className="border-0 bg-gray-50 dark:bg-[#0f0f0f]"
        style={{
          position: 'fixed',
          top: frameBox.top,
          left: frameBox.left,
          width: frameBox.width,
          height: frameBox.height,
          // Above map nodes, below modal dialogs
          zIndex: visible ? 40 : -1,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
        }}
        onLoad={() => {
          const win = iframeRef.current?.contentWindow
          if (!win) return
          win.postMessage(
            { type: PREVIEW_RESIZE_MESSAGE, pageId: conversationId },
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
      />,
      document.body
    )

  return (
    <>
      {/* In-item chrome + slot (chrome stays in RF node so dragging moves the item) */}
      <div
        data-page-preview={conversationId}
        className={cn(
          'mt-2 w-full rounded-xl border overflow-hidden bg-gray-50 dark:bg-[#0f0f0f] flex flex-col',
          !visible && 'hidden',
          isFocused
            ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-400/40'
            : 'border-gray-200 dark:border-[#2f2f2f]'
        )}
        style={{ height: PREVIEW_HEIGHT, minWidth: 280 }}
        aria-hidden={!visible}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-center justify-between px-2 border-b shrink-0 cursor-grab active:cursor-grabbing',
            isFocused
              ? 'border-blue-400 bg-blue-50/90 dark:bg-blue-950/50'
              : 'border-gray-200 dark:border-[#2f2f2f] bg-white/80 dark:bg-[#1f1f1f]/80 hover:bg-gray-50 dark:hover:bg-[#2a2a2a]'
          )}
          style={{ height: CHROME_HEIGHT }}
          onClick={(e) => {
            e.stopPropagation()
            handleSelectChrome()
          }}
          title="Drag to move item · click to edit page style"
        >
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
            {title || 'Page'}
          </span>
          <button
            type="button"
            className="nodrag nopan h-6 w-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
            title="Close preview"
            onClick={(e) => {
              e.stopPropagation()
              previewFocus?.clearPreviewFocus()
              onClose()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Empty slot: portaled iframe paints here in screen space */}
        <div ref={slotRef} className="relative flex-1 min-h-0 bg-gray-50 dark:bg-[#0f0f0f]">
          {visible && !navReady && (
            <div className="nodrag nopan nowheel pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading page…
            </div>
          )}
        </div>
      </div>

      {iframePortal}
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
