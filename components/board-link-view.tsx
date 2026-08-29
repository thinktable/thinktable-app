'use client'

// React NodeView for the boardLink block: clickable page/emoji icon (opens emoji picker) + an
// editable title (click → place caret to edit, NOT navigate) + a hover preview chrome that overlaps
// the text end: a semi-transparent, icon-only control with [preview toggle] + [open-full ↗] buttons.
// Both variants lay the icon to the LEFT of the underlined title ('title' is just larger/bolder).

import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useStore } from 'reactflow' // Live zoom → counter-scale the icon + open menu (screen-relative)
import { navigationZoom } from '@/lib/board-navigating' // Freeze chrome mid-pinch
import { FileText } from 'lucide-react'
import { DEFAULT_BOARD_TITLE } from '@/lib/board-title' // Empty boardLink title hint matches nav +
import { useTheme } from '@/components/theme-provider'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BoardOpenMenu } from '@/components/board-open-menu' // Shared preview/open chrome
import { useBoardLinkActions } from '@/lib/board-link-context'
import { usePropertyHeaderSlot } from '@/lib/property-header-context'
import { elementUniformScale, localToScreen, screenToLocal } from '@/lib/dom-transform' // Rotation-safe zoom×frameScale + local↔screen
import { cn } from '@/lib/utils'

const BOARD_OPEN_MENU_FALLBACK_W = 52 // Approx pill width before first layout (preview + open)

/** Topmost non-empty client rect — FIRST visual text line (glyph box, not the tall line-height box). */
function topmostClientRect(el: HTMLElement): DOMRect | null {
  try {
    const r = el.ownerDocument.createRange()
    r.selectNodeContents(el)
    const rects = r.getClientRects()
    let best: DOMRect | null = null
    for (let i = 0; i < rects.length; i++) {
      const fr = rects[i]
      if (fr.height <= 0 || fr.width <= 0) continue
      if (!best || fr.top < best.top) best = fr
    }
    return best
  } catch {
    return null
  }
}

export function BoardLinkView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const boardId = (node.attrs.boardId as string | null) || null // Linked child page
  const icon = (node.attrs.icon as string | null) || null // Emoji, else default icon
  const variant = (node.attrs.variant as string) === 'title' ? 'title' : 'inline' // Layout mode
  const actions = useBoardLinkActions() // Host frame preview / open / rename / setIcon bridge
  const propertyHeaderSlot = usePropertyHeaderSlot() // Empty property icons — first title link only
  const linkPos = typeof getPos === 'function' ? getPos() ?? -1 : -1 // TipTap getPos() may return undefined mid-teardown
  const isFirstTitleBoardLink = (() => {
    if (variant !== 'title' || !editor || editor.isDestroyed || linkPos < 0) return false
    let firstLinkPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'boardLink') {
        firstLinkPos = pos
        return false
      }
      return true
    })
    return firstLinkPos === linkPos
  })()
  const showPropertyUnderTitle = Boolean(propertyHeaderSlot && isFirstTitleBoardLink)
  const { resolvedTheme } = useTheme() // Emoji picker theme
  const zoom = useStore((s) =>
    navigationZoom(Math.round((s.transform[2] || 1) * 8) / 8)
  ) // Freeze mid-pinch — avoid remounting chrome every tick
  const [chromeScale, setChromeScale] = useState(1) // Comfort counter-scale for icon + open menu (transform-only)

  const [title, setTitle] = useState<string>((node.attrs.title as string) || '') // Local editable label
  const [editing, setEditing] = useState(false) // True while the title span holds focus (caret editing)
  const [iconOpen, setIconOpen] = useState(false) // Emoji picker open
  // Menu left (local CSS px relative to .tt-board-link) — clamped so it stays inside the visible frame
  const [menuLeft, setMenuLeft] = useState<number | null>(null)
  // Menu top (local CSS px) — the center of the TITLE's FIRST text line (not the taller row/block center)
  const [menuTop, setMenuTop] = useState<number | null>(null)
  // Icon vertical shift (local CSS px) → pin the icon to the label's first text line (not flex center)
  const [iconShiftY, setIconShiftY] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null) // .tt-board-link root — measure even when open-menu is absent
  const titleRef = useRef<HTMLSpanElement>(null) // contentEditable span
  const iconRef = useRef<HTMLSpanElement>(null) // Page emoji/icon — menu must not cover this
  const chromeRef = useRef<HTMLSpanElement>(null) // Preview/open menu (measured against the frame)

  // Keep local title in sync when the node attr changes externally (e.g. page rename)
  useEffect(() => {
    const attrTitle = (node.attrs.title as string) || ''
    setTitle(attrTitle)
    if (!editing && titleRef.current && titleRef.current.textContent !== attrTitle) {
      titleRef.current.textContent = attrTitle
    }
  }, [node.attrs.title, editing])

  // Prefer just right of the title; if that would spill past the frame, slide left over the title
  // text only — never past the emoji/icon. Icon scale/shift runs even without the open menu.
  useEffect(() => {
    const wrapper = wrapRef.current
    if (!wrapper) return
    const panel = wrapper.closest('[data-panel-container="true"]') as HTMLElement | null // Frame box
    if (!panel) return

    const measure = () => {
      // Scale is rotation-safe (matrix hypot). Line Y + menu clamp use screenToLocal / localToScreen
      // so glyph alignment works unrotated AND the open menu stays inside the frame when rotated.
      const scale = elementUniformScale(wrapper) // RF zoom × frameScale
      // Comfort counter-scale (same curve as the ⋮⋮ grips): 1 when zoomed out (rides with content),
      // shrinks ∝ 1/√scale when zoomed in so the icon + menu don't balloon with huge text.
      // TRANSFORM ONLY — never marginRight/width compensation: that shrunk the boardLink flow box,
      // which fed locked hug → setResizeDimensions → setNodes (nodes(ref) storm / max update depth).
      const factor = 1 / Math.max(1, Math.sqrt(scale))
      setChromeScale((p) => (Math.abs(p - factor) < 0.01 ? p : factor)) // Avoid setState storms on subpixel drift

      // Vertical: center icon/menu on the TITLE's FIRST glyph line (Range), not lh/2 of the tall
      // line-box — lh/2 sat below the glyphs with block line-height 1.7 and left the icon high.
      const titleEl = titleRef.current
      let lineCenterLocal: number | null = null
      if (titleEl) {
        const fr = topmostClientRect(titleEl)
        if (fr) {
          const mid = screenToLocal(wrapper, (fr.left + fr.right) / 2, (fr.top + fr.bottom) / 2)
          lineCenterLocal = mid.y
        } else {
          const labelLH = parseFloat(getComputedStyle(titleEl).lineHeight)
          const half =
            Number.isFinite(labelLH) && labelLH > 0
              ? labelLH / 2
              : (parseFloat(getComputedStyle(titleEl).fontSize) || 16) / 2
          lineCenterLocal = titleEl.offsetTop + half
        }
      }
      const nextTop = lineCenterLocal != null ? Math.round(lineCenterLocal) : null
      setMenuTop((prev) => (prev != null && nextTop != null && Math.abs(prev - nextTop) < 1 ? prev : nextTop))

      // Icon: row is flex-start; nudge so the icon's center matches the first glyph line (same Y as menu/grip).
      let iconShift = 0
      if (lineCenterLocal != null && iconRef.current) {
        const iconH = iconRef.current.offsetHeight // Local px (transform doesn't affect offset*)
        const iconCenterLocal = iconRef.current.offsetTop + iconH / 2 // flex-start → near wrapper top
        iconShift = lineCenterLocal - iconCenterLocal
      }
      setIconShiftY((prev) => (Math.abs(prev - iconShift) < 0.5 ? prev : iconShift))

      // Open-menu left clamp — only when the pill is mounted (linked page)
      const chrome = chromeRef.current
      if (!chrome) return
      const pad = 4
      const gap = 6
      const chromeLocal = Math.max(chrome.offsetWidth || chrome.scrollWidth, BOARD_OPEN_MENU_FALLBACK_W)
      const chromeVisualLocal = chromeLocal * factor // Menu is visually scaled → reserve scaled width in local px

      // Visible frame edge — prefer the frame's OWN overflow clip (unlocked+narrow), else the panel.
      // Must stay inside the panel: locked frames have no inner clip, so an unscoped
      // `closest('.overflow-hidden')` walked up to the React Flow pane (canvas-wide) → the clamp
      // never fired and the menu escaped past the frame's right edge.
      const clipCandidate = wrapper.closest('.overflow-hidden') as HTMLElement | null
      const clipEl = clipCandidate && panel.contains(clipCandidate) ? clipCandidate : panel
      // Clip/panel right edge → wrapper-local X (rotation-safe). Gutter subtraction was an
      // underestimate and let the pill sit past the blue frame edge when rotated.
      const clipRightScreen = localToScreen(clipEl, clipEl.clientWidth - pad, clipEl.clientHeight / 2)
      const frameRightInWrap = screenToLocal(wrapper, clipRightScreen.x, clipRightScreen.y).x

      // Title right edge in wrapper-local px
      const titleRightLocal = titleEl
        ? titleEl.offsetLeft + Math.max(titleEl.offsetWidth, titleEl.scrollWidth)
        : wrapper.offsetWidth
      // Leftmost the menu may sit: just right of the icon's LAYOUT box (offsetWidth), not the
      // counter-scaled visual — transform shrinks the icon but must not move the clamp.
      const iconLayoutW = iconRef.current?.offsetWidth ?? 0
      const menuMinLeft = iconLayoutW + gap

      // Ideal: just to the right of the title
      let targetLeft = titleRightLocal + gap
      // Not enough room → slide left so the menu’s right edge stays on the frame (overlaps title text)
      if (targetLeft + chromeVisualLocal > frameRightInWrap) {
        targetLeft = frameRightInWrap - chromeVisualLocal
      }
      // Never slide left of the icon — stop overlapping at the title/icon boundary
      targetLeft = Math.max(menuMinLeft, targetLeft)

      // Round to whole CSS px — subpixel flicker was setState-storming BoardFlow
      const nextLeft = Math.round(targetLeft)
      setMenuLeft((prev) => (prev != null && Math.abs(prev - nextLeft) < 1 ? prev : nextLeft))
    }

    measure()
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    ro.observe(panel)
    ro.observe(wrapper)
    if (chromeRef.current) ro.observe(chromeRef.current)
    if (titleRef.current) ro.observe(titleRef.current)
    if (iconRef.current) ro.observe(iconRef.current)
    const onEnter = () => requestAnimationFrame(measure)
    wrapper.addEventListener('pointerenter', onEnter)
    panel.addEventListener('pointerenter', onEnter)
    return () => {
      ro.disconnect()
      wrapper.removeEventListener('pointerenter', onEnter)
      panel.removeEventListener('pointerenter', onEnter)
    }
  }, [title, variant, boardId, icon, actions.notionUrl, zoom])

  // Commit an edited title to the node attr + linked page
  const commitTitle = useCallback(() => {
    const next = (titleRef.current?.textContent || '').trim()
    setEditing(false)
    if (next === (node.attrs.title as string)) return
    updateAttributes({ title: next }) // Persist into the frame message HTML
    if (boardId) void actions.renameTitle(boardId, next) // Rename the linked page too
  }, [actions, node.attrs.title, boardId, updateAttributes])

  const IconEl = icon ? (
    <span className="tt-board-link-emoji leading-none">{icon}</span>
  ) : (
    <FileText className="tt-board-link-fallback h-4 w-4 text-gray-500 dark:text-gray-400" />
  )

  return (
    <NodeViewWrapper
      as="div"
      ref={wrapRef as React.Ref<HTMLDivElement>} // Measure icon/menu from the boardLink root (not the open-menu)
      className={cn(
        'tt-board-link group relative nokey flex flex-col items-stretch', // nokey: RF must not steal Backspace while editing the title
        variant === 'title' ? 'tt-board-link-title' : 'tt-board-link-inline',
        editing && 'tt-board-link-editing' // While editing the title, CSS hides the preview chrome
      )}
      contentEditable={false} // Atom node — PM ignores inner DOM; we manage the title span
      data-board-id={boardId || undefined}
    >
      <div className="relative flex w-full min-w-0 items-start">
      {/* Clickable icon — opens the emoji picker (same as page icons elsewhere) */}
      <span
        ref={iconRef}
        className="tt-board-link-icon-wrap inline-flex flex-shrink-0"
        style={{
          // Transform-only chrome: layout box stays natural so hug / RF node size stay stable.
          transform: `translateY(${iconShiftY}px) scale(${chromeScale})`, // Pin to first text line + comfort scale
          transformOrigin: 'left center', // Keep left edge + vertical center; shrink toward the title
        }}
      >
      <DropdownMenu open={iconOpen} onOpenChange={setIconOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="tt-board-link-icon flex-shrink-0 rounded hover:bg-black/5 dark:hover:bg-white/10"
            title="Change icon"
            aria-label="Change board icon"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {IconEl}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="p-0 w-auto border-0 shadow-lg overflow-hidden"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            <Picker
              data={data}
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              onEmojiSelect={(emoji: { native?: string }) => {
                if (emoji?.native) {
                  updateAttributes({ icon: emoji.native }) // Persist into frame HTML
                  if (boardId) void actions.setIcon(boardId, emoji.native) // Sync page/nav icon
                }
                setIconOpen(false)
              }}
              previewPosition="none"
              skinTonePosition="none"
            />
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 p-1">
            <DropdownMenuItem
              className="text-xs cursor-pointer"
              onClick={() => {
                updateAttributes({ icon: null })
                if (boardId) void actions.setIcon(boardId, null)
              }}
            >
              Default board icon
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      </span>

      {/* Title — always editable: a click just places the caret (I-bar) to edit, never navigates */}
      <span
        ref={titleRef}
        className="tt-board-link-label"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={DEFAULT_BOARD_TITLE}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            if (titleRef.current) titleRef.current.textContent = (node.attrs.title as string) || ''
            ;(e.currentTarget as HTMLElement).blur()
          }
        }}
        onFocus={() => setEditing(true)} // Entering edit mode hides the open-page chrome
        onBlur={commitTitle}
        onMouseDown={(e) => {
          if (e.button === 2) return // Don't place I-bar; don't stop/prevent — Chrome skips contextmenu if we do
          // Unselected frame: do not place caret — let RF select/drag the frame
          const frame = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          if (!frame?.classList.contains('selected')) return
          // ProseMirror would otherwise select this atom node on click; we take over so a click just
          // focuses the label and drops the caret (I-bar) at the click point — like editing plain text.
          e.stopPropagation()
          e.preventDefault()
          const el = titleRef.current
          if (!el) return
          setEditing(true) // Hide the open-page chrome immediately (onFocus is unreliable in the NodeView root)
          el.focus()
          const doc = el.ownerDocument
          const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY) || null // Caret at click point
          const sel = doc.getSelection()
          if (sel && range) {
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }}
        onPointerDown={(e) => {
          if (e.button === 2) return // Right-click must reach the frame menu
          // Only trap the pointer when the host frame is selected (else RF drags the frame)
          const frame = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          if (frame?.classList.contains('selected')) e.stopPropagation()
        }}
        onClick={(e) => {
          const frame = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          if (frame?.classList.contains('selected')) e.stopPropagation() // Caret placement only — no navigation
        }}
      >
        {title}
      </span>

      {/* Preview / open / Notion — clamped left so it stays inside the visible frame */}
      {boardId && (
        <BoardOpenMenu
          ref={chromeRef}
          boardId={boardId}
          notionUrl={actions.notionUrl} // Notion-linked frames: show Notion icon with preview+open
          style={{
            ...(menuLeft != null ? { left: menuLeft, right: 'auto' } : {}), // Measured local px; overrides CSS right:0
            ...(menuTop != null ? { top: menuTop } : {}), // Align to the TITLE's first-line center (overrides top:50%)
            transform: `translateY(-50%) scale(${chromeScale})`, // Center the box on that point + comfort scale
            transformOrigin: 'left center', // Anchor the left edge (matches the placement math)
          }}
        />
      )}
      </div>
      {showPropertyUnderTitle ? (
        <div className="w-full min-w-0 max-w-full" data-tt-property-band>
          {propertyHeaderSlot}
        </div>
      ) : null}
    </NodeViewWrapper>
  )
}
