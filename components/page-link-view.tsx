'use client'

// React NodeView for the pageLink block: clickable page/emoji icon (opens emoji picker) + an
// editable title (click → place caret to edit, NOT navigate) + a hover preview chrome that overlaps
// the text end: a semi-transparent, icon-only control with [preview toggle] + [open-full ↗] buttons.
// Both variants lay the icon to the LEFT of the underlined title ('title' is just larger/bolder).

import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageOpenMenu } from '@/components/page-open-menu' // Shared preview/open chrome
import { usePageLinkActions } from '@/lib/page-link-context'
import { cn } from '@/lib/utils'

const PAGE_OPEN_MENU_FALLBACK_W = 52 // Approx pill width before first layout (preview + open)

export function PageLinkView({ node, updateAttributes }: NodeViewProps) {
  const pageId = (node.attrs.pageId as string | null) || null // Linked child page
  const icon = (node.attrs.icon as string | null) || null // Emoji, else default icon
  const variant = (node.attrs.variant as string) === 'title' ? 'title' : 'inline' // Layout mode
  const actions = usePageLinkActions() // Host frame preview / open / rename / setIcon bridge
  const { resolvedTheme } = useTheme() // Emoji picker theme

  const [title, setTitle] = useState<string>((node.attrs.title as string) || '') // Local editable label
  const [editing, setEditing] = useState(false) // True while the title span holds focus (caret editing)
  const [iconOpen, setIconOpen] = useState(false) // Emoji picker open
  // Menu left (local CSS px relative to .tt-page-link) — clamped so it stays inside the visible frame
  const [menuLeft, setMenuLeft] = useState<number | null>(null)
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
  // text only — never past the emoji/icon.
  useEffect(() => {
    const chrome = chromeRef.current
    if (!chrome) return
    const wrapper = chrome.closest('.tt-page-link') as HTMLElement | null // Position containing block
    if (!wrapper) return
    const panel = wrapper.closest('[data-panel-container="true"]') as HTMLElement | null // Frame box
    if (!panel) return

    const measure = () => {
      const wrapRect = wrapper.getBoundingClientRect()
      const titleRect = titleRef.current?.getBoundingClientRect()
      const iconRect = iconRef.current?.getBoundingClientRect()
      const scale = wrapper.offsetWidth > 0 ? wrapRect.width / wrapper.offsetWidth : 1
      const pad = 4
      const gap = 6
      const chromeLocal = Math.max(chrome.offsetWidth || chrome.scrollWidth, PAGE_OPEN_MENU_FALLBACK_W)
      const chromeScreen = chromeLocal * scale

      // Visible frame edge — prefer the frame's OWN overflow clip (unlocked+narrow), else the panel.
      // Must stay inside the panel: locked frames have no inner clip, so an unscoped
      // `closest('.overflow-hidden')` walked up to the React Flow pane (canvas-wide) → the clamp
      // never fired and the menu escaped past the frame's right edge.
      const clipCandidate = wrapper.closest('.overflow-hidden') as HTMLElement | null
      const clipEl = clipCandidate && panel.contains(clipCandidate) ? clipCandidate : panel
      const clipRect = clipEl.getBoundingClientRect()
      const frameRight = clipRect.right - pad

      const titleRight = titleRect?.right ?? wrapRect.right
      // Leftmost the menu may sit: just right of the emoji/icon (never cover it)
      const iconRight = iconRect?.right ?? wrapRect.left
      const menuMinLeft = iconRight + gap

      // Ideal: just to the right of the title
      let targetLeftScreen = titleRight + gap
      // Not enough room → slide left so the menu’s right edge stays on the frame (overlaps title text)
      if (targetLeftScreen + chromeScreen > frameRight) {
        targetLeftScreen = frameRight - chromeScreen
      }
      // Never slide left of the icon — stop overlapping at the title/icon boundary
      targetLeftScreen = Math.max(menuMinLeft, targetLeftScreen)

      // Round to whole CSS px — subpixel flicker was setState-storming BoardFlow
      const nextLeft = Math.round((targetLeftScreen - wrapRect.left) / scale)
      setMenuLeft((prev) => (prev != null && Math.abs(prev - nextLeft) < 1 ? prev : nextLeft))
    }

    measure()
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    ro.observe(panel)
    ro.observe(wrapper)
    ro.observe(chrome)
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
  }, [title, variant, pageId, icon, actions.notionUrl])

  // Commit an edited title to the node attr + linked page
  const commitTitle = useCallback(() => {
    const next = (titleRef.current?.textContent || '').trim()
    setEditing(false)
    if (next === (node.attrs.title as string)) return
    updateAttributes({ title: next }) // Persist into the frame message HTML
    if (pageId) void actions.renameTitle(pageId, next) // Rename the linked page too
  }, [actions, node.attrs.title, pageId, updateAttributes])

  const IconEl = icon ? (
    <span className="tt-page-link-emoji leading-none">{icon}</span>
  ) : (
    <FileText className="tt-page-link-fallback h-4 w-4 text-gray-500 dark:text-gray-400" />
  )

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-page-link group relative nokey', // nokey: RF must not steal Backspace while editing the title
        variant === 'title' ? 'tt-page-link-title' : 'tt-page-link-inline',
        editing && 'tt-page-link-editing' // While editing the title, CSS hides the preview chrome
      )}
      contentEditable={false} // Atom node — PM ignores inner DOM; we manage the title span
      data-page-id={pageId || undefined}
    >
      {/* Clickable icon — opens the emoji picker (same as page icons elsewhere) */}
      <span ref={iconRef} className="tt-page-link-icon-wrap inline-flex flex-shrink-0">
      <DropdownMenu open={iconOpen} onOpenChange={setIconOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="tt-page-link-icon flex-shrink-0 rounded hover:bg-black/5 dark:hover:bg-white/10"
            title="Change icon"
            aria-label="Change page icon"
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
                  if (pageId) void actions.setIcon(pageId, emoji.native) // Sync page/nav icon
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
                if (pageId) void actions.setIcon(pageId, null)
              }}
            >
              Default page icon
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      </span>

      {/* Title — always editable: a click just places the caret (I-bar) to edit, never navigates */}
      <span
        ref={titleRef}
        className="tt-page-link-label"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="Untitled"
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
        onPointerDown={(e) => e.stopPropagation()} // Don't start frame/block drag
        onClick={(e) => e.stopPropagation()} // Caret placement only — no navigation
      >
        {title}
      </span>

      {/* Preview chrome — clamped left so it stays inside the visible frame when unlocked+narrow */}
      {pageId && (
        <PageOpenMenu
          ref={chromeRef}
          pageId={pageId}
          style={
            menuLeft != null
              ? { left: menuLeft, right: 'auto' } // Measured local px; overrides CSS right:0
              : undefined
          }
        />
      )}
    </NodeViewWrapper>
  )
}
