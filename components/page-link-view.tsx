'use client'

// React NodeView for the pageLink block: clickable page/emoji icon (opens emoji picker) + an
// editable title (click → place caret to edit, NOT navigate) + a hover preview chrome that overlaps
// the text end: a semi-transparent, icon-only control with [preview toggle] + [open-full ↗] buttons.
// Both variants lay the icon to the LEFT of the underlined title ('title' is just larger/bolder).

import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { AppWindow, ArrowUpRight, FileText } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePageLinkActions } from '@/lib/page-link-context'
import { cn } from '@/lib/utils'

export function PageLinkView({ node, updateAttributes }: NodeViewProps) {
  const pageId = (node.attrs.pageId as string | null) || null // Linked child page
  const icon = (node.attrs.icon as string | null) || null // Emoji, else default icon
  const variant = (node.attrs.variant as string) === 'title' ? 'title' : 'inline' // Layout mode
  const actions = usePageLinkActions() // Host frame preview / open / rename / setIcon bridge
  const { resolvedTheme } = useTheme() // Emoji picker theme

  const [title, setTitle] = useState<string>((node.attrs.title as string) || '') // Local editable label
  const [editing, setEditing] = useState(false) // True while the title span holds focus (caret editing)
  const [iconOpen, setIconOpen] = useState(false) // Emoji picker open
  const [placeRight, setPlaceRight] = useState(false) // Sit menu right-of-title when the frame has room, else overlap
  const titleRef = useRef<HTMLSpanElement>(null) // contentEditable span
  const chromeRef = useRef<HTMLSpanElement>(null) // Preview/open menu (measured against the frame's text area)

  // Keep local title in sync when the node attr changes externally (e.g. page rename)
  useEffect(() => {
    const attrTitle = (node.attrs.title as string) || ''
    setTitle(attrTitle)
    if (!editing && titleRef.current && titleRef.current.textContent !== attrTitle) {
      titleRef.current.textContent = attrTitle
    }
  }, [node.attrs.title, editing])

  // Decide where the menu sits: if the frame's text area is wider than this page-link (room to the
  // right without growing the frame), slide the menu just right of the title; otherwise overlap the end.
  useEffect(() => {
    const chrome = chromeRef.current
    if (!chrome) return
    const wrapper = chrome.closest('.tt-page-link') as HTMLElement | null // Shrink-wrapped to icon+title
    const area = wrapper?.closest('.ProseMirror') as HTMLElement | null // The frame's text area (w-max)
    if (!wrapper || !area) return
    const measure = () => {
      const wrapRect = wrapper.getBoundingClientRect() // Right edge of the title
      const areaRect = area.getBoundingClientRect()
      const padRight = parseFloat(getComputedStyle(area).paddingRight) || 0 // Ignore the text-area padding
      const roomRight = areaRect.right - padRight - wrapRect.right // Free space right of the title
      const need = chrome.offsetWidth + 6 // Menu width + a small gap
      setPlaceRight(roomRight >= need) // Only move right if it fits without extending the frame
    }
    measure()
    const ro = new ResizeObserver(measure) // Re-decide when the frame or title width changes
    ro.observe(area)
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [title, variant])

  const previewActive = pageId != null && actions.previewPageId === pageId // Highlight when open

  // Commit an edited title to the node attr + linked page
  const commitTitle = useCallback(() => {
    const next = (titleRef.current?.textContent || '').trim()
    setEditing(false)
    if (next === (node.attrs.title as string)) return
    updateAttributes({ title: next }) // Persist into the frame message HTML
    if (pageId) void actions.renameTitle(pageId, next) // Rename the linked page too
  }, [actions, node.attrs.title, pageId, updateAttributes])

  // Full-page navigation now lives ONLY on the ↗ button (title click just edits) to avoid accidents
  const onOpenPage = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (pageId) actions.openPage(pageId)
    },
    [actions, pageId]
  )

  // Toggle the in-place preview for this child page
  const onPreview = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!pageId) return
      if (previewActive) actions.closePreview()
      else actions.openPreview(pageId)
    },
    [actions, pageId, previewActive]
  )

  const IconEl = icon ? (
    <span className="tt-page-link-emoji leading-none">{icon}</span>
  ) : (
    <FileText className="tt-page-link-fallback h-4 w-4 text-gray-500 dark:text-gray-400" />
  )

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-page-link group relative',
        variant === 'title' ? 'tt-page-link-title' : 'tt-page-link-inline',
        editing && 'tt-page-link-editing' // While editing the title, CSS hides the preview chrome
      )}
      contentEditable={false} // Atom node — PM ignores inner DOM; we manage the title span
      data-page-id={pageId || undefined}
    >
      {/* Clickable icon — opens the emoji picker (same as page icons elsewhere) */}
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

      {/* Preview chrome — semi-transparent, icon-only; overlaps the text end on hover (see globals.css) */}
      {pageId && (
        <span
          ref={chromeRef}
          data-page-link-preview
          className={cn('tt-page-link-preview', placeRight && 'tt-page-link-preview-right')}
        >
          {/* Toggle the in-place iframe preview */}
          <button
            type="button"
            className={cn('tt-page-link-preview-btn', previewActive && 'tt-page-link-preview-active')}
            title={previewActive ? 'Close page preview' : 'Open page preview'}
            onPointerEnter={() => actions.prefetch(pageId)} // Warm iframe before click
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onPreview}
          >
            <AppWindow className="h-3.5 w-3.5" />
          </button>
          {/* Open the full page (the only navigation affordance now) */}
          <button
            type="button"
            className="tt-page-link-preview-btn"
            title="Open full page"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOpenPage}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </NodeViewWrapper>
  )
}
