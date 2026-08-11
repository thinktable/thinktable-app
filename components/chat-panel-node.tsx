'use client'

// Custom React Flow node for chat panels (prompt + response)
import { NodeProps, Handle, Position, useReactFlow, useStore, useStoreApi, NodeResizeControl, useUpdateNodeInternals } from 'reactflow' // RF node primitives + store (unselect groups before dragItems) + remeasure; useStore = live zoom for screen-constant chrome
import {
  useIsThreadConnecting,
  useIsNearThreadConnection,
  INDICATOR_OUTSET,
  ConnectionIndicator,
} from '@/components/threads' // Miro: DOM indicators arm edge connection points; proximity while dragging


import { cn, generateUUID } from '@/lib/utils'
import { useEditor, EditorContent } from '@tiptap/react'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model' // Parse stored HTML → PM doc for exact (non-string) sync compare
import { TextSelection } from '@tiptap/pm/state' // Only text ranges keep a frame "active" — not pageLink NodeSelection
import { createPanelExtensions } from '@/lib/tiptap/extensions' // StarterKit + Turn into nodes
import { TipTapBlockHandles } from '@/components/tiptap-block-handles' // Per-content-block ⋮⋮ (Notion)
import { FrameStackRevealLine } from '@/components/frame-stack-reveal-line' // Stack edge dashed line → reveal
import { FrameShapeBackdrop } from '@/components/frame-shape-backdrop' // SVG silhouette behind TipTap
import {
  frameShapeClipCss,
  parseFrameShape,
  FRAME_SHAPE_DEFAULT_SIZE,
  type FrameShapeType,
} from '@/lib/frame-shape' // Frame-as-shape parse + clip
import type { FrameStackSide } from '@/components/use-frame-nest-stack-drag'
import { findEditorBlockAtClientY } from '@/lib/tiptap/block-selection' // Click in frame padding → block at Y
import { pruneEmptyTextblocks } from '@/lib/tiptap/empty-block-backspace' // Strip blank lines on frame deselect
import { setAiTextSelection } from '@/lib/ai/selection-bridge' // Live highlighted-text pills in AI composer
import type { PageInTarget } from '@/components/block-actions-menu'
import { useEffect, useRef, useState, useCallback, useMemo, Fragment } from 'react'
import { MoreHorizontal, Trash2, Loader2, X, ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Plus, RotateCw, ScanText, WrapText } from 'lucide-react' // Rotate + fit-to-text / wrap
import { useAiEditSession } from '@/lib/ai/edit-session' // Pending rainbow / review focus

// Helper to check if content is effectively empty (handling HTML tags)
const isContentEmpty = (content: string | undefined | null) => {
  if (!content) return true
  if (content === '<p></p>' || content === '<p><br></p>') return true
  // Also strip all tags to be sure
  const stripped = content.replace(/<[^>]*>/g, '').trim()
  return stripped.length === 0
}

const BLOCK_HANDLE_GUTTER_W = 24 // TipTap ⋮⋮ gutter (pl-6)
const PAGE_LINK_ICON_W = 22 // Title emoji / page icon column
const PAGE_OPEN_MENU_W = 52 // Open-menu pill ≈ preview + open (Notion adds a bit more)
const BLOCK_THREE_CHARS_W = 28 // ~3ch of body text for plain frames
const BLOCK_MIN_FRAME_H = 40 // Keep a usable box when shrinking
const DATABASE_BLOCK_HTML_RE = /data-type=["']databaseBlock["']/i // TipTap Notion DB atom in frame HTML
const MIN_DATABASE_FRAME_W = 240 // Below this a DB frame is a collapsed stub (grip + title only)
const MIN_DATABASE_FRAME_H = 120 // Title row alone is ~40; table needs more height than that

/** True when this frame's TipTap HTML embeds a Notion databaseBlock. */
function hasDatabaseBlockHtml(html: string): boolean {
  return DATABASE_BLOCK_HTML_RE.test(html || '')
}

/** Post-drag hug sometimes measures a remounting DB NodeView as ~52×40 and persists it — reject those. */
function isCollapsedDatabaseFrameSize(width: number, height: number): boolean {
  return width < MIN_DATABASE_FRAME_W || height < MIN_DATABASE_FRAME_H
}

/** Min frame width: pageLink → grip+icon+menu; plain text → grip+3 letters. */
function blockMinFrameWidth(html: string): number {
  if (/data-type="pageLink"/i.test(html || '')) {
    return BLOCK_HANDLE_GUTTER_W + PAGE_LINK_ICON_W + PAGE_OPEN_MENU_W
  }
  return BLOCK_HANDLE_GUTTER_W + BLOCK_THREE_CHARS_W
}

const BLOCK_MIN_FRAME_W = BLOCK_HANDLE_GUTTER_W + PAGE_LINK_ICON_W + PAGE_OPEN_MENU_W // Default / pageLink floor
const BLOCK_LOCKED_MIN_W = BLOCK_HANDLE_GUTTER_W + BLOCK_THREE_CHARS_W // Absolute floor when hugging
const GRIP_ICON_INSET = 2 // ⋮⋮ glyph (16px) centered in its 20px hit button → (20-16)/2 from the gutter left

/** Axis-aligned box that contains a w×h rect rotated by `deg` degrees (around center). */
function rotatedAabbSize(w: number, h: number, deg: number): { width: number; height: number } {
  const rad = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  return { width: w * c + h * s, height: w * s + h * c }
}

/**
 * Invert AABB → unrotated content size at `deg`.
 * Near 45° the map is singular — fall back to uniform scale from `fallback`.
 */
function contentSizeFromAabb(
  aabbW: number,
  aabbH: number,
  deg: number,
  fallback: { width: number; height: number }
): { width: number; height: number } {
  const rad = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const det = c * c - s * s // cos(2θ)
  if (Math.abs(det) < 1e-3) {
    const prev = rotatedAabbSize(fallback.width, fallback.height, deg)
    const scale = Math.min(
      aabbW / Math.max(1, prev.width),
      aabbH / Math.max(1, prev.height)
    )
    return {
      width: Math.max(1, fallback.width * scale),
      height: Math.max(1, fallback.height * scale),
    }
  }
  return {
    width: Math.max(1, (c * aabbW - s * aabbH) / det),
    height: Math.max(1, (c * aabbH - s * aabbW) / det),
  }
}

/**
 * Natural content width = longest rendered line of real text, not the stretched w-full box.
 * Pure measurement via Range (actual glyph extents) — children are width:100%, so offsetWidth /
 * scrollWidth report the frame width, not the text. Never mutates live styles (RO-safe).
 */
function measureNaturalContentWidth(contentFit: HTMLElement): number {
  const cs = getComputedStyle(contentFit)
  const padL = parseFloat(cs.paddingLeft) || 0 // Content-box left pad (pl-0.5 on blocks)
  const pm = contentFit.querySelector('.ProseMirror') as HTMLElement | null
  if (!pm) return Math.max(1, contentFit.scrollWidth)
  // Gutter = the ⋮⋮ column pad on the handles row that actually wraps the editor.
  // `querySelector('.relative')` used to match the outer containerRef (pad 0), so the
  // locked frame came out ~24px too narrow and clipped the widest line on the right.
  const row = pm.closest('.relative') as HTMLElement | null
  const gutter = row && row !== contentFit ? parseFloat(getComputedStyle(row).paddingLeft) || 0 : 0

  // Screen→local scale (RF zoom / frameScale). offsetWidth is local; getBoundingClientRect is screen.
  const fitRect = contentFit.getBoundingClientRect()
  const scale = contentFit.offsetWidth > 0 ? fitRect.width / contentFit.offsetWidth : 1
  const toLocal = (screenW: number) => (scale > 0 ? screenW / scale : screenW)
  const rangeWidth = (el: Element): number => {
    try {
      const range = document.createRange()
      range.selectNodeContents(el)
      return toLocal(range.getBoundingClientRect().width) // Real text extent, ignores width:100%
    } catch {
      return 0
    }
  }

  let maxLine = 0
  for (const child of Array.from(pm.children) as HTMLElement[]) {
    const pageLink =
      (child.classList.contains('tt-page-link') && child) ||
      (child.querySelector('.tt-page-link') as HTMLElement | null)
    if (pageLink) {
      // icon LAYOUT box + gap + real title text — never getBoundingClientRect on the icon:
      // pageLink chromeScale is a CSS transform, and gBCR would report the counter-scaled
      // visual width → locked hug / RF node box thrash (nodes(ref) storm / max update depth).
      const label = pageLink.querySelector('.tt-page-link-label') as HTMLElement | null
      const iconWrap = pageLink.querySelector('.tt-page-link-icon-wrap') as HTMLElement | null
      const icon = iconWrap || (pageLink.querySelector('.tt-page-link-icon') as HTMLElement | null)
      const gap = parseFloat(getComputedStyle(pageLink).gap) || 6
      const iconW = icon ? (icon as HTMLElement).offsetWidth : 0 // Local layout px (transform-agnostic)
      const labelW = label ? rangeWidth(label) : 0
      maxLine = Math.max(maxLine, iconW + gap + labelW)
      continue
    }
    // databaseBlock: Range over the live Notion table is transform-fragile during RF frame
    // drag (gBCR can collapse → hug shrinks the frame and the table appears to vanish).
    const dbBlock =
      (child.classList.contains('tt-database-block') && child) ||
      (child.querySelector('.tt-database-block') as HTMLElement | null)
    if (dbBlock) {
      const table = dbBlock.querySelector('.tt-notion-db') as HTMLElement | null
      const w = Math.max(
        dbBlock.scrollWidth || 0,
        dbBlock.offsetWidth || 0,
        table?.scrollWidth || 0,
        table?.offsetWidth || 0
      )
      maxLine = Math.max(maxLine, w)
      continue
    }
    maxLine = Math.max(maxLine, rangeWidth(child)) // Longest real text line
  }
  // Right margin mirrors the frame-left → ⋮⋮ icon inset so both gaps read equal (Notion-style):
  // width = [left pad + gutter] (where text starts) + text + [same inset on the right].
  const iconInset = padL + GRIP_ICON_INSET // frame-left → ⋮⋮ glyph-left
  return Math.ceil(Math.max(1, padL + gutter + maxLine + iconInset))
}

/** Unscaled content height — prefer scrollHeight so clipped/wrapped overflow still counts. */
function measureNaturalContentHeight(contentFit: HTMLElement): number {
  return Math.max(1, Math.ceil(contentFit.scrollHeight || contentFit.offsetHeight))
}

const CLIP_FADE_PX = 16 // Soft edge so half-cut glyphs fade instead of chopping

/** Mask style that fades content out at overflowing frame edges (right / bottom). */
function clipFadeMaskStyle(
  overflowRight: boolean,
  overflowBottom: boolean,
  fadePx = CLIP_FADE_PX,
): React.CSSProperties | undefined {
  if (!overflowRight && !overflowBottom) return undefined
  const toRight = `linear-gradient(to right, #000 calc(100% - ${fadePx}px), transparent)`
  const toBottom = `linear-gradient(to bottom, #000 calc(100% - ${fadePx}px), transparent)`
  if (overflowRight && overflowBottom) {
    // Intersect both fades so the corner softens on both axes
    return {
      WebkitMaskImage: `${toRight}, ${toBottom}`,
      maskImage: `${toRight}, ${toBottom}`,
      WebkitMaskComposite: 'source-in',
      maskComposite: 'intersect',
    }
  }
  const one = overflowRight ? toRight : toBottom
  return { WebkitMaskImage: one, maskImage: one }
}

// Visual frame = unscaled content × frameScale + 1px border each side (border-box)
function scaledFrameSize(
  intrinsic: { width: number; height: number },
  scale: number,
  minWidth = BLOCK_LOCKED_MIN_W,
) {
  const safeScale = Math.max(0.15, scale) // Same floor as locked corner-drag
  const border = 2 // Card border occupies layout width/height
  return {
    width: Math.max(minWidth, Math.ceil(intrinsic.width * safeScale) + border),
    height: Math.max(BLOCK_MIN_FRAME_H, Math.ceil(intrinsic.height * safeScale) + border),
  }
}

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEditorContext } from './editor-context'
import { useReactFlowContext } from './react-flow-context'
import { useTheme } from './theme-provider'
import { SelectionFormatPopupAnchor } from './selection-format-popup' // Notion-style selection menu (stable edge anchor)
import { PageLinkProvider, type PageLinkActions } from '@/lib/page-link-context' // Bridge pageLink NodeViews → frame preview/open/rename
import { PageOpenMenu } from '@/components/page-open-menu' // Preview/open chrome for page frames without a pageLink
import { NestedBoardPreview, prefetchPageEmbed } from './nested-board-preview' // Page-within-page board preview
import { unwrapNestedFramesHtml } from '@/lib/tiptap/unwrap-nested-frames' // Flatten legacy nest wrappers
import { deleteLinkedPageForBlock, isBlockContentEmpty, isBlockMeta, isPageBodyMeta } from '@/lib/blocks' // Block detection + empty check + delete sync
import { applyTurnInto } from '@/lib/blocks/turn-into' // Page / Page in from content-block menu
import { migrateSoleDatabaseBlockToPageLink, ensureNotionMapFrameIsPageLink, isSoleDatabaseBlockContent } from '@/lib/notion/migrate-frame' // Notion DB map frames → pageLink

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  metadata?: Record<string, any> // Optional metadata field
}

interface Comment {
  id: string
  selectedText: string
  from: number
  to: number
  section: 'prompt' | 'response'
  comment: string
  createdAt: string
}

interface EmojiReaction {
  id: string
  selectedText: string
  from: number
  to: number
  section: 'prompt' | 'response'
  emoji: string
  count: number
  createdAt: string
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
  isResponseCollapsed?: boolean // Track if response is collapsed for position updates
  fillColor?: string // Panel fill color (optional, defaults to transparent)
  borderColor?: string // Panel border color (optional, defaults to theme-based)
  borderStyle?: string // Panel border style (solid, dashed, dotted)
  borderWeight?: string // Panel border thickness (1px, 2px, 4px)
  frameShape?: FrameShapeType | null // Silhouette when frames act as shapes
}

interface ProjectBoardPanelNodeData {
  boardId: string
  boardTitle: string  // Used as "prompt"
  recentUserMessage?: Message  // Most recent user message as "response"
  projectId: string
  isResponseCollapsed?: boolean
  fillColor?: string // Panel fill color (optional, defaults to transparent)
  borderColor?: string // Panel border color (optional, defaults to theme-based)
  borderStyle?: string // Panel border style (solid, dashed, dotted)
  borderWeight?: string // Panel border thickness (1px, 2px, 4px)
}

// Union type for node data
type PanelNodeData = ChatPanelNodeData | ProjectBoardPanelNodeData

// Type guard to check if data is ProjectBoardPanelNodeData
function isProjectBoardData(data: PanelNodeData): data is ProjectBoardPanelNodeData {
  return 'boardId' in data && 'boardTitle' in data
}

// Plain-merge legacy prompt + response HTML into one page-item body (no auto-haze)
function mergePanelHtml(prompt?: string, response?: string): string {
  const empty = (s?: string) => !s?.trim() || s === '<p></p>' || s === '<p><br></p>' // TipTap empty docs
  const a = empty(prompt) ? '' : (prompt as string) // Prompt / primary body
  const b = empty(response) ? '' : (response as string) // Former response section
  const merged = a && b ? `${a}${b}` : a || b || '' // Concatenate HTML fragments
  return unwrapNestedFramesHtml(merged) // Flatten legacy nestedFrame shells
}

// Format response content - if it's already HTML, return as-is (TipTap will render it)
// Only format plain text content
function formatResponseContent(content: string): string {
  if (!content) return content

  // Check if content is already HTML - if so, return it as-is (TipTap handles HTML directly)
  const isHTML = /<[a-z][\s\S]*>/i.test(content)

  if (isHTML) {
    // Content is already HTML - TipTap will render it directly, no need to reformat
    return content
  }

  // If it's plain text, convert to basic HTML structure
  // Split by double newlines (paragraph breaks) or single newlines if no double newlines
  const hasDoubleNewlines = /\n\s*\n/.test(content)
  const paragraphs = hasDoubleNewlines
    ? content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
    : content.split(/\n/).map(p => p.trim()).filter(p => p.length > 0)

  if (paragraphs.length <= 1) {
    // Single paragraph - wrap in <p> tag
    return `<p>${content}</p>`
  }

  // Convert paragraphs to HTML
  const htmlParagraphs = paragraphs
    .map(p => {
      // Check if it looks like a heading
      const isHeading = /^[A-Z][^.!?]*[:\-]$/.test(p) || (p.length < 100 && !p.includes('.'))
      if (isHeading) {
        return `<h2>${p}</h2>`
      }
      // Check if it's a list item
      const isListItem = /^[\d\-\*•]\s/.test(p) || /^\d+[\.\)]\s/.test(p)
      if (isListItem) {
        return `<li>${p.replace(/^[\d\-\*•]\s/, '').replace(/^\d+[\.\)]\s/, '')}</li>`
      }
      return `<p>${p}</p>`
    })
    .join('')

  return htmlParagraphs
}

function TipTapContent({
  content,
  className,
  originalContent,
  onContentChange,
  onHasChangesChange,
  onComment,
  comments = [],
  editorRef,
  onCommentHover,
  onCommentClick,
  onAddReaction,
  section,
  isFlashcard,
  placeholder,
  isPanelSelected,
  isLoading,
  onBlur,
  onEditorActiveChange,
  fontScale,
  enableBlockHandles = false, // ⋮⋮ on each TipTap **block** (not this **frame**)
  singleLineUntilEnter = false, // Unresized blocks: one visual line per TipTap block
  hostNodeId,
  conversationId,
  pageInTargets,
  onPageTurnInto,
  suspendContentSync = false, // True while RF frame-dragging — skip setContent remounts
  forceContentSyncKey = 0, // Bump to setContent even while editor is focused (AI eye / remove / save)
}: {
  content: string
  className?: string
  originalContent: string
  onContentChange?: (newContent: string) => void
  onHasChangesChange?: (hasChanges: boolean) => void
  onComment?: (selectedText: string, from: number, to: number) => void
  comments?: Comment[]
  editorRef?: React.MutableRefObject<any>
  onCommentHover?: (commentId: string | null) => void
  onCommentClick?: (commentId: string) => void
  onAddReaction?: (selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => void
  section?: 'prompt' | 'response'
  isFlashcard?: boolean
  placeholder?: string
  isPanelSelected?: boolean
  isLoading?: boolean
  onBlur?: () => void
  onEditorActiveChange?: (isActive: boolean) => void // Called when editor is focused or has selection
  fontScale?: number // Font scale factor for resized panels (defaults to 1)
  enableBlockHandles?: boolean
  singleLineUntilEnter?: boolean // Unresized map blocks: grow width; Enter starts a new line
  hostNodeId?: string
              conversationId?: string // Page id — ⋮⋮ extract a block onto the page
  pageInTargets?: PageInTarget[]
  onPageTurnInto?: (blockType: 'page' | 'pageIn', pageInParentId?: string | null) => void
  suspendContentSync?: boolean
  forceContentSyncKey?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setActiveEditor } = useEditorContext()
  // Live frame-selected flag for TipTap DOM handlers (useEditor config is not recreated each render)
  const isPanelSelectedRef = useRef(!!isPanelSelected)
  isPanelSelectedRef.current = !!isPanelSelected
  // Same gesture that selects an unselected frame must not place the I-bar
  const selectOnlyClickRef = useRef(false)
  const lastAiForceSyncRef = useRef(0) // Last forceContentSyncKey we allowed while focused
  // Keep latest callbacks in refs so editorProps / onUpdate stay referentially stable across
  // RF drag re-renders (unstable options → useEditor setOptions every frame → databaseBlock NodeView remounts → table vanishes).
  const originalContentRef = useRef(originalContent)
  originalContentRef.current = originalContent
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange
  const onHasChangesChangeRef = useRef(onHasChangesChange)
  onHasChangesChangeRef.current = onHasChangesChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onEditorActiveChangeRef = useRef(onEditorActiveChange)
  onEditorActiveChangeRef.current = onEditorActiveChange
  const setActiveEditorRef = useRef(setActiveEditor)
  setActiveEditorRef.current = setActiveEditor

  const resolvedPlaceholder =
    placeholder !== undefined && placeholder !== ''
      ? placeholder
      : placeholder === undefined
        ? section === 'prompt'
          ? 'What are you trying to remember?'
          : 'Explain it clearly or let AI help'
        : ''

  // Stable across drag ticks — createPanelExtensions() allocates new StarterKit instances each call
  const extensions = useMemo(
    () => createPanelExtensions(resolvedPlaceholder),
    [resolvedPlaceholder]
  )

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: cn(
          'prose max-w-none focus:outline-none min-h-[20px] cursor-text nokey', // nokey: RF must not treat Backspace as frame delete while typing
          isFlashcard && 'text-xl' // Increase font size for flashcards
        ),
        ...(singleLineUntilEnter ? { 'data-single-line': 'true' } : {}), // CSS nowrap until Enter
      },
      handleDOMEvents: {
        mousedown: (view: any, event: Event) => {
          const mouseEvent = event as MouseEvent
          // Unselected frame: do not place caret / select text — let RF select + drag the frame
          if (!isPanelSelectedRef.current) {
            selectOnlyClickRef.current = true // Suppress I-bar on the matching click
            return true // Prevent ProseMirror default; do not stopPropagation
          }
          selectOnlyClickRef.current = false
          // Selected frame: keep pointer inside the editor so RF does not start a frame drag
          mouseEvent.stopPropagation()

          // Temporary reveal: click a hazed span to clear blur until click-away / blur
          const hazeTarget = (mouseEvent.target as HTMLElement | null)?.closest?.(
            '[data-haze="true"]'
          ) as HTMLElement | null
          view.dom.querySelectorAll('.tt-haze-revealed').forEach((el: Element) => {
            if (el !== hazeTarget) el.classList.remove('tt-haze-revealed') // Hide previously revealed spans
          })
          if (hazeTarget) {
            hazeTarget.classList.add('tt-haze-revealed') // Reveal this hazed block temporarily
          }

          // Don’t override selection here — PM places the I-bar; container click confirms via posAtCoords
          return false
        },
        blur: (view: any) => {
          // Re-haze any temporarily revealed spans when the editor loses focus
          view.dom.querySelectorAll('.tt-haze-revealed').forEach((el: Element) => {
            el.classList.remove('tt-haze-revealed')
          })
          return false
        },
        paste: (view: any, event: Event) => {
          // Single-line frames: paste as one visual line (Enter still creates blocks)
          if (view.dom.getAttribute('data-single-line') !== 'true') return false // Wrap mode keeps normal multi-line paste
          const clipboardData = (event as ClipboardEvent).clipboardData
          if (clipboardData) {
            // Get plain text from clipboard
            const pastedText = clipboardData.getData('text/plain')
            // Replace newlines and multiple spaces with single space to keep on same line
            const normalizedText = pastedText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
            if (normalizedText) {
              // Insert text at current cursor position
              const { state, dispatch } = view
              const { from, to } = state.selection
              // Insert the normalized text, replacing any selected text
              const transaction = state.tr.insertText(normalizedText, from, to)
              dispatch(transaction)
              // Prevent default paste behavior
              event.preventDefault()
              return true
            }
          }
          return false
        },
      },
    }),
    [isFlashcard, singleLineUntilEnter]
  )

  const editor = useEditor({
    extensions,
    content,
    editable: true, // Fully editable
    immediatelyRender: false, // Prevent SSR hydration mismatches
    shouldRerenderOnTransaction: false, // Avoid parent re-render storms; NodeViews update themselves
    editorProps,
    onUpdate: ({ editor: ed }) => {
      const newContent = ed.getHTML()
      const hasChanged = newContent !== originalContentRef.current
      onHasChangesChangeRef.current?.(hasChanged)
      onContentChangeRef.current?.(newContent)
    },
    onFocus: ({ editor: ed }) => {
      // Register this editor as active when focused
      setActiveEditorRef.current(ed)
      // Notify parent that editor is active (focused or has selection)
      onEditorActiveChangeRef.current?.(true)
    },
    onBlur: ({ editor: ed }) => {
      // Call custom onBlur callback if provided
      onBlurRef.current?.()
      // Keep frame selected only for a real TEXT range (format popup). pageLink atoms use
      // NodeSelection (from≠to) — counting that re-selected the frame on every pane click.
      if (ed && onEditorActiveChangeRef.current) {
        const sel = ed.state.selection
        const hasTextRange = sel instanceof TextSelection && !sel.empty
        onEditorActiveChangeRef.current(hasTextRange)
      } else {
        onEditorActiveChangeRef.current?.(false)
      }
    },
  })

  // Register editor on mount and cleanup on unmount
  useEffect(() => {
    if (editor) {
      setActiveEditor(editor)
      if (editorRef) {
        editorRef.current = editor
      }
      return () => {
        setActiveEditor(null)
        if (editorRef) {
          editorRef.current = null
        }
      }
    }
  }, [editor, setActiveEditor, editorRef])

  // Apply font scale to editor's DOM element when fontScale changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    
    const scale = fontScale ?? 1
    const editorDOM = editor.view.dom as HTMLElement
    
    if (editorDOM) {
      // Apply font size directly to the editor's DOM element
      // This will affect all content in the editor
      editorDOM.style.fontSize = `${scale}em`
    }
  }, [editor, fontScale])

  // Keep single-line mode in sync (unresized map blocks grow until Enter)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const editorDOM = editor.view.dom as HTMLElement
    if (singleLineUntilEnter) {
      editorDOM.setAttribute('data-single-line', 'true') // nowrap; CSS fills frame width
      editorDOM.style.width = '100%' // Stretch to content box — empty/short lines stay full-row
      editorDOM.style.minWidth = 'max-content' // Still hug longest line for unresized frames
    } else {
      editorDOM.removeAttribute('data-single-line')
      editorDOM.style.width = ''
      editorDOM.style.minWidth = ''
    }
  }, [editor, singleLineUntilEnter])

  // Apply blue highlights to commented text when comments change
  useEffect(() => {
    if (!editor || comments.length === 0) return

    // Apply blue highlight to all commented text ranges using transaction
    const tr = editor.state.tr

    comments.forEach((comment) => {
      try {
        const { from, to } = comment
        if (from >= 0 && to <= editor.state.doc.content.size && from < to) {
          // Remove all existing highlight marks (including yellow) and apply blue highlight
          tr.removeMark(from, to, editor.schema.marks.highlight)
          const blueHighlight = editor.schema.marks.highlight.create({ color: '#dbeafe' }) // blue-100 - slightly darker than blue-50
          tr.addMark(from, to, blueHighlight)
          // Debug: log to verify the mark attributes
          console.log('Blue highlight mark attributes:', blueHighlight.attrs)
        }
      } catch (error) {
        console.error('Error applying comment highlight:', error)
      }
    })

    // Dispatch the transaction if there are any changes
    if (tr.steps.length > 0) {
      editor.view.dispatch(tr)
    }
  }, [editor, comments]) // Only depend on editor and comments, not content (content sync handles it)

  // Detect when editor is active (focused or has selection) and notify parent to auto-select panel.
  // Also publishes highlighted text as an AI composer context pill.
  useEffect(() => {
    if (!editor) return

    const checkEditorActive = () => {
      try {
        const sel = editor.state.selection
        // Text range only — NodeSelection on pageLink/databaseBlock is from≠to and must NOT
        // keep/re-select the host frame after a board (pane) click deselects it.
        const hasTextRange = sel instanceof TextSelection && !sel.empty
        const isFocused = editor.view.dom === document.activeElement || editor.view.dom.contains(document.activeElement)
        onEditorActiveChange?.(hasTextRange || isFocused)

        // Publish highlighted text as an AI context pill (cleared when caret / empty).
        // I-bar alone is not a text selection — frame pill stays "Current Frame".
        if (hostNodeId) {
          if (hasTextRange) {
            const text = editor.state.doc.textBetween(sel.from, sel.to, ' ')
            const trimmed = text.replace(/\s+/g, ' ').trim()
            if (trimmed) {
              setAiTextSelection({
                frameId: hostNodeId,
                text: trimmed,
              })
            } else {
              setAiTextSelection(null)
            }
          } else {
            setAiTextSelection(null)
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }

    // Check on focus/blur
    editor.on('focus', checkEditorActive)
    editor.on('blur', checkEditorActive)
    // Check on selection changes
    editor.on('selectionUpdate', checkEditorActive)
    editor.on('update', checkEditorActive)

    // Initial check
    checkEditorActive()

    return () => {
      editor.off('focus', checkEditorActive)
      editor.off('blur', checkEditorActive)
      editor.off('selectionUpdate', checkEditorActive)
      editor.off('update', checkEditorActive)
      if (hostNodeId) setAiTextSelection(null) // Clear pill if this editor unmounts
    }
  }, [editor, onEditorActiveChange, hostNodeId])

  // Detect when cursor is inside commented text and show/select comment
  // Only works when comments are already visible (showComments is true)
  useEffect(() => {
    if (!editor || !onCommentHover || comments.length === 0) return

    const handleSelectionUpdate = () => {
      try {
        const { from } = editor.state.selection

        // Check if cursor is within any comment's range
        const commentAtCursor = comments.find(comment => {
          try {
            return from >= comment.from && from <= comment.to
          } catch (error) {
            return false
          }
        })

        if (commentAtCursor) {
          onCommentHover(commentAtCursor.id)
        } else {
          onCommentHover(null)
        }
      } catch (error) {
        // Ignore errors in selection handling
      }
    }

    // Listen to selection changes - use 'update' event which fires on any editor change including selection
    editor.on('update', handleSelectionUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    // Also check on mount and when editor becomes available
    handleSelectionUpdate()

    return () => {
      editor.off('update', handleSelectionUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, comments, onCommentHover])

  // Handle clicks on commented text to show/select comment
  useEffect(() => {
    if (!editor || comments.length === 0 || !onCommentClick) return

    const handleClick = (event: MouseEvent) => {
      try {
        const { from } = editor.state.selection

        // Check if click is within any comment's range
        const commentAtClick = comments.find(comment => {
          try {
            return from >= comment.from && from <= comment.to
          } catch (error) {
            return false
          }
        })

        if (commentAtClick && onCommentClick) {
          // Show comments if hidden, and select the clicked comment
          onCommentClick(commentAtClick.id)
        }
      } catch (error) {
        // Ignore errors
      }
    }

    // Listen to clicks on the editor
    const editorDom = editor.view.dom
    editorDom.addEventListener('click', handleClick)

    return () => {
      editorDom.removeEventListener('click', handleClick)
    }
  }, [editor, comments, onCommentClick])

  useEffect(() => {
    if (editor) {
      // Caret owns the doc while typing — except when AI review forces a content swap
      if (editor.isFocused && forceContentSyncKey === lastAiForceSyncRef.current) return
      if (forceContentSyncKey !== lastAiForceSyncRef.current) {
        lastAiForceSyncRef.current = forceContentSyncKey
      }
      if (suspendContentSync) return // Frame drag: never setContent (remounts databaseBlock NodeView → table vanishes)
      // Compare DOCUMENTS, not HTML strings. The pageLink NodeView adds a class and TipTap emits
      // attributes in its own order, so editor.getHTML() never byte-equals the stored HTML once a
      // pageLink exists — a raw string compare re-ran setContent every sync (infinite loop / page
      // unresponsive). doc.eq() ignores cosmetic class/attr-order/whitespace, so it's exact + stable.
      let differs = true
      try {
        const tmp = document.createElement('div') // Off-DOM parse target
        tmp.innerHTML = unwrapNestedFramesHtml(content || '<p></p>')
        const parsed = PMDOMParser.fromSchema(editor.schema).parse(tmp) // Stored HTML → PM doc
        differs = !editor.state.doc.eq(parsed) // Semantic equality (not string)
      } catch {
        differs = editor.getHTML() !== content // Fallback to string compare on parse error
      }
      // Sync prop → editor only when the document actually changed
      if (differs) {
        // emitUpdate:false — programmatic AI eye/discard/save must not fire onUpdate
        // (that set promptHasChanges and blocked discard from restoring the original)
        editor.commands.setContent(unwrapNestedFramesHtml(content || '<p></p>'), { emitUpdate: false })
        // Ensure cursor is visible by focusing if editor is empty
        if (!content || content.trim() === '' || content === '<p></p>') {
          // Set cursor position to start to show cursor
          setTimeout(() => {
            editor.commands.setTextSelection(0)
          }, 0)
        }
        // Re-apply comment highlights after content is set
        if (comments.length > 0) {
          setTimeout(() => {
            const tr = editor.state.tr
            comments.forEach((comment) => {
              try {
                const { from, to } = comment
                if (from >= 0 && to <= editor.state.doc.content.size && from < to) {
                  // Remove all existing highlight marks (including yellow) and apply blue highlight
                  tr.removeMark(from, to, editor.schema.marks.highlight)
                  tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' })) // blue-100 - slightly darker than blue-50
                }
              } catch (error) {
                console.error('Error applying comment highlight:', error)
              }
            })
            // Dispatch the transaction if there are any changes
            if (tr.steps.length > 0) {
              editor.view.dispatch(tr)
            }
          }, 0)
        }
      }
    }
  }, [editor, content, comments, suspendContentSync, forceContentSyncKey])

  // Reposition extension UI elements (like Grammarly) when panel moves
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new MutationObserver(() => {
      // Find and reposition extension UI elements
      const extensionElements = containerRef.current?.querySelectorAll('[data-grammarly-shadow-root], [id^="grammarly-"], [class*="grammarly"]')
      extensionElements?.forEach((el) => {
        const htmlEl = el as HTMLElement
        // Extension elements are typically positioned absolutely or fixed
        // We can't directly control them, but we can ensure the container is positioned correctly
      })
    })

    if (containerRef.current) {
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      })
    }

    return () => observer.disconnect()
  }, [containerRef])

  // Focus editor + place I-bar — only when the frame is already selected (not the select click)
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!editor) return
    // Unselected: never place caret — RF selects/drags the frame first
    if (!isPanelSelected) return
    // Same gesture that just selected the frame / armed a nest — no I-bar
    if (selectOnlyClickRef.current) {
      selectOnlyClickRef.current = false
      return
    }
    e.stopPropagation()

    const clientX = e.clientX
    const clientY = e.clientY
    setTimeout(() => {
      if (editor.isDestroyed) return
      try {
        // Always resolve against click coords so empty lines get the caret (not doc start/end)
        const posResult = editor.view.posAtCoords({ left: clientX, top: clientY })
        if (posResult != null && posResult.pos >= 0) {
          editor.chain().focus().setTextSelection(posResult.pos).run()
          return
        }
      } catch {
        /* fall through */
      }
      editor.commands.focus()
    }, 0)
  }, [editor, isPanelSelected])

  if (!editor) return null

  // Extract 'inline' from className if present to apply inline-block display
  const isInline = className?.includes('inline')
  const otherClasses = className?.replace(/\binline\b/g, '').trim()

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-visible w-full', // Full frame content width so short/empty blocks stretch
        // Unselected → grab (drag frame); selected → text caret; flashcards keep pointer
        isFlashcard ? 'cursor-pointer' : isPanelSelected ? 'cursor-text' : 'cursor-grab',
        isInline && 'inline-block',
        otherClasses
      )}
      onClick={(e) => {
        // Unselected: let the click bubble so RF selects the frame (no caret)
        if (!isPanelSelected) return
        handleContainerClick(e)
      }}
    >
      {/* Notion-style format popup — outside highlight edge, stays open with selection */}
      <SelectionFormatPopupAnchor editor={editor} containerRef={containerRef} />

      {/* Apply shimmer animation to prompt text when response is loading (not for flashcards) */}
      <div
        className={cn(
          'relative w-full', // Match frame width — gutter + editor share one row
          enableBlockHandles && 'pl-6', // Gutter for ⋮⋮ only (add-block is the between-line)
          isLoading && !isFlashcard && 'shimmer'
        )}
      >
        <TipTapBlockHandles
          editor={editor}
          enabled={enableBlockHandles && !isFlashcard}
          isPanelSelected={!!isPanelSelected} // Frame must be selected (and not mid-drag) before ⋮⋮ can arm a block
          hostNodeId={hostNodeId}
          conversationId={conversationId}
          pageInTargets={pageInTargets}
          onPageTurnInto={onPageTurnInto}
        />
        <EditorContent editor={editor} className="block w-full" />
      </div>
    </div>
  )
}

// Fetch study sets from user metadata
async function fetchStudySets(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('metadata')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Error fetching study sets:', error)
      return []
    }

    const studySets = (profile?.metadata as Record<string, any>)?.studySets || []
    return Array.isArray(studySets) ? studySets : []
  } catch (error) {
    console.error('Error fetching study sets:', error)
    return []
  }
}

// Hook to check if flashcard tags are loaded and get tag IDs
// Uses React Query to ensure study sets are cached and ready
function useFlashcardTagsLoaded(responseMessageId: string | undefined): { isReady: boolean; tagIds: string[] } {
  const supabase = createClient()
  const [taggedStudySetIds, setTaggedStudySetIds] = useState<string[]>([])
  const [messageLoaded, setMessageLoaded] = useState(false)
  
  // Use React Query for study sets (same as TagBoxes) to ensure cache is ready
  const { data: studySets = [], isLoading: studySetsLoading } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Fetch message metadata to get tag IDs
  useEffect(() => {
    if (!responseMessageId) {
      setMessageLoaded(true)
      return
    }

    const fetchMessage = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setMessageLoaded(true)
          return
        }

        const { data: message, error } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', responseMessageId)
          .single()

        if (error) {
          if (error.code !== 'PGRST116' && error.message !== 'JSON object requested, multiple (or no) rows returned') {
            console.error('Error fetching message metadata:', error)
          }
          setMessageLoaded(true)
          return
        }

        const metadata = (message?.metadata as Record<string, any>) || {}
        const studySetIds = (metadata.studySetIds || []) as string[]
        setTaggedStudySetIds(studySetIds)
        setMessageLoaded(true)
      } catch (error) {
        if (error instanceof Error && !error.message.includes('PGRST')) {
          console.error('Error fetching message metadata:', error)
        }
        setMessageLoaded(true)
      }
    }

    fetchMessage()
  }, [responseMessageId, supabase])

  // Return true only when:
  // 1. Message is loaded (or no message ID)
  // 2. Study sets are loaded (or no tags)
  // 3. If there are tags, verify all have names in study sets
  const isReady = messageLoaded && !studySetsLoading && (
    taggedStudySetIds.length === 0 || 
    taggedStudySetIds.every(id => studySets.some(s => s.id === id))
  )

  return { isReady, tagIds: taggedStudySetIds }
}

// Tag boxes component - displays study set tags for a flashcard
function TagBoxes({ responseMessageId, initialTagIds }: { responseMessageId: string; initialTagIds?: string[] }) {
  const supabase = createClient()
  const { selectedTag, setSelectedTag } = useReactFlowContext() // Get selected tag state for filtering
  const [taggedStudySetIds, setTaggedStudySetIds] = useState<string[]>(initialTagIds || [])
  const [studySetNames, setStudySetNames] = useState<Map<string, string>>(new Map())
  const [hasInitialLoad, setHasInitialLoad] = useState(!!initialTagIds) // If initialTagIds provided, skip initial fetch

  // Update tag IDs when initialTagIds prop changes
  useEffect(() => {
    if (initialTagIds) {
      setTaggedStudySetIds(initialTagIds)
      setHasInitialLoad(true)
    }
  }, [initialTagIds])

  // Fetch current study set IDs from message metadata (only if not provided initially)
  const fetchTaggedStudySets = useCallback(async () => {
    if (!responseMessageId) {
      setHasInitialLoad(true)
      return
    }

    try {
      // Check if user is authenticated first (required for RLS)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // Not authenticated - can't fetch message metadata (expected for public homepage boards)
        setHasInitialLoad(true)
        return
      }

      const { data: message, error } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessageId)
        .single()

      if (error) {
        // RLS errors (like PGRST116) are expected for messages user doesn't own
        // Only log unexpected errors
        if (error.code !== 'PGRST116' && error.message !== 'JSON object requested, multiple (or no) rows returned') {
        console.error('Error fetching message metadata:', error)
        }
        setHasInitialLoad(true)
        return
      }

      const metadata = (message?.metadata as Record<string, any>) || {}
      const studySetIds = (metadata.studySetIds || []) as string[]
      setTaggedStudySetIds(studySetIds)
      setHasInitialLoad(true)
    } catch (error) {
      // Silently handle errors (expected for public boards)
      // Only log if it's an unexpected error type
      if (error instanceof Error && !error.message.includes('PGRST')) {
      console.error('Error fetching tagged study sets:', error)
      }
      setHasInitialLoad(true)
    }
  }, [responseMessageId, supabase])

  useEffect(() => {
    // Skip initial fetch if tag IDs were provided
    if (!initialTagIds) {
      fetchTaggedStudySets()
    }

    // Subscribe to message updates to refresh tags
    const channel = supabase
      .channel(`tag-boxes-${responseMessageId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `id=eq.${responseMessageId}`,
        },
        () => {
          fetchTaggedStudySets()
        }
      )
      .subscribe()

    // Listen for custom event when flashcard is tagged
    const handleTagged = (event: CustomEvent) => {
      if (event.detail?.messageId === responseMessageId) {
        fetchTaggedStudySets()
      }
    }
    window.addEventListener('flashcard-tagged', handleTagged as EventListener)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('flashcard-tagged', handleTagged as EventListener)
    }
  }, [responseMessageId, supabase, fetchTaggedStudySets, initialTagIds])

  // Fetch study sets using React Query (same cache as TagButton for instant access)
  const { data: studySets = [] } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Update study set names map only when content actually changes
  // Use ref to track previous key and avoid infinite loops
  const prevMapKeyRef = useRef<string>('')
  
  useEffect(() => {
    // Create stable key from current values
    const taggedIdsKey = taggedStudySetIds.join(',')
    const studySetsKey = JSON.stringify(studySets.map(s => ({ id: s.id, name: s.name })).sort((a, b) => a.id.localeCompare(b.id)))
    const mapKey = `${taggedIdsKey}|${studySetsKey}`
    
    // Skip if key hasn't changed (content is the same)
    if (mapKey === prevMapKeyRef.current) {
      return
    }
    
    prevMapKeyRef.current = mapKey

    if (taggedStudySetIds.length === 0) {
      setStudySetNames(prev => prev.size === 0 ? prev : new Map())
      return
    }

    const namesMap = new Map<string, string>()
    taggedStudySetIds.forEach((id) => {
      const studySet = studySets.find((s) => s.id === id)
      if (studySet) {
        namesMap.set(id, studySet.name)
      }
    })

    setStudySetNames(prev => {
      // Compare to avoid unnecessary updates
      if (prev.size !== namesMap.size) {
        return namesMap
      }
      for (const [id, name] of namesMap) {
        if (prev.get(id) !== name) {
          return namesMap
        }
      }
      return prev // No change
    })
    // Dependencies: we check the key inside, so we need the arrays to be in scope
    // but we only run when the key actually changes (checked via ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taggedStudySetIds, studySets])

  // Only return null after initial load confirms there are no tags
  if (hasInitialLoad && taggedStudySetIds.length === 0) return null

  // Filter to only show tags that have names loaded
  const tagsWithNames = taggedStudySetIds.filter(id => studySetNames.has(id))
  
  // Don't show anything if no tags have names yet
  if (tagsWithNames.length === 0) return null

  // Show container with tags that have names
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tagsWithNames.map((studySetId) => {
        const name = studySetNames.get(studySetId)!

        const isSelected = selectedTag === studySetId

        return (
          <div
            key={studySetId}
            onClick={(e) => {
              e.stopPropagation() // Prevent panel selection when clicking tag
              setSelectedTag(studySetId) // Toggle tag selection
            }}
            className={cn(
              "px-2 py-0.5 text-xs rounded-md border cursor-pointer transition-colors",
              isSelected
                ? "bg-blue-600 dark:bg-blue-500 text-white border-blue-700 dark:border-blue-400"
                : "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
            )}
          >
            {name}
          </div>
        )
      })}
    </div>
  )
}

// Tag button component - reusable for both collapsed and expanded states
function TagButton({ responseMessageId }: { responseMessageId: string }) {
  const queryClient = useQueryClient()
  const supabase = createClient()
  const [newStudySetName, setNewStudySetName] = useState('')
  const [isCreatingStudySet, setIsCreatingStudySet] = useState(false)
  const [showNewStudySetInput, setShowNewStudySetInput] = useState(false)

  // Fetch study sets for the dropdown
  const { data: studySets = [] } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Handle tagging flashcard to study set
  const handleTagToStudySet = async (studySetId: string) => {
    if (!responseMessageId) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Get current message metadata
      const { data: message, error: fetchError } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessageId)
        .single()

      if (fetchError) throw new Error(fetchError.message || 'Failed to fetch message')

      const existingMetadata = (message?.metadata as Record<string, any>) || {}
      const studySetIds = (existingMetadata.studySetIds || []) as string[]

      // Add study set ID if not already present
      if (!studySetIds.includes(studySetId)) {
        const updatedStudySetIds = [...studySetIds, studySetId]

        // Update message metadata
        const { error } = await supabase
          .from('messages')
          .update({
            metadata: { ...existingMetadata, studySetIds: updatedStudySetIds },
          })
          .eq('id', responseMessageId)

        if (error) throw new Error(error.message || 'Failed to tag flashcard')

        // Invalidate queries to refresh study set views
        await queryClient.invalidateQueries({ queryKey: ['flashcards-for-study-set'] })
        await queryClient.invalidateQueries({ queryKey: ['studySets'] })
        
        // Trigger a custom event to refresh tag boxes
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flashcard-tagged', { detail: { messageId: responseMessageId } }))
        }
      }
    } catch (error: any) {
      console.error('Failed to tag flashcard:', error)
      alert(error.message || 'Failed to tag flashcard. Please try again.')
    }
  }

  // Handle creating new study set
  const handleCreateStudySet = async () => {
    if (!newStudySetName.trim() || isCreatingStudySet) return

    setIsCreatingStudySet(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Get current profile metadata
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('metadata')
        .eq('id', user.id)
        .single()

      if (fetchError) throw new Error(fetchError.message || 'Failed to fetch profile')

      const existingMetadata = (profile?.metadata as Record<string, any>) || {}
      const studySets = (existingMetadata.studySets || []) as Array<{ id: string; name: string }>

      // Create new study set
      const newStudySetId = generateUUID() // Compatible with all browsers including older Safari
      const newStudySet = { id: newStudySetId, name: newStudySetName.trim() }
      const updatedStudySets = [...studySets, newStudySet]

      // Update profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({
          metadata: { ...existingMetadata, studySets: updatedStudySets },
        })
        .eq('id', user.id)

      if (error) throw new Error(error.message || 'Failed to create study set')

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['studySets'] })

      // Tag the flashcard to the new study set
      if (responseMessageId) {
        await handleTagToStudySet(newStudySetId)
      }

      // Reset form
      setNewStudySetName('')
      setShowNewStudySetInput(false)
      
      // Trigger a custom event to refresh tag boxes
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flashcard-tagged', { detail: { messageId: responseMessageId } }))
      }
    } catch (error: any) {
      console.error('Failed to create study set:', error)
      alert(error.message || 'Failed to create study set. Please try again.')
    } finally {
      setIsCreatingStudySet(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={(e) => e.stopPropagation()}
          title="Tag to study set"
        >
          <Plus className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {/* New set button at the top */}
        {!showNewStudySetInput ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowNewStudySetInput(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New set
          </DropdownMenuItem>
        ) : (
          <div className="px-2 py-1.5">
            <input
              type="text"
              value={newStudySetName}
              onChange={(e) => setNewStudySetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newStudySetName.trim() && !isCreatingStudySet) {
                  handleCreateStudySet()
                } else if (e.key === 'Escape') {
                  setShowNewStudySetInput(false)
                  setNewStudySetName('')
                }
              }}
              placeholder="Study set name"
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex gap-1 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCreateStudySet()
                }}
                disabled={!newStudySetName.trim() || isCreatingStudySet}
              >
                {isCreatingStudySet ? 'Creating...' : 'Create'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewStudySetInput(false)
                  setNewStudySetName('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {studySets.length > 0 && (
          <>
            {showNewStudySetInput && (
              <div className="h-px bg-gray-200 dark:bg-gray-700 my-1 mx-1" />
            )}
            {studySets.map((studySet) => (
              <DropdownMenuItem
                key={studySet.id}
                onClick={(e) => {
                  e.stopPropagation()
                  handleTagToStudySet(studySet.id)
                }}
              >
                {studySet.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ChatPanelNode({ data, selected, id, dragging }: NodeProps<PanelNodeData>) {
  // Handle both ChatPanelNodeData and ProjectBoardPanelNodeData
  const isProjectBoard = isProjectBoardData(data)

  // Extract data based on type
  const promptMessage: Message | null = isProjectBoard
    ? { id: data.boardId, role: 'user' as const, content: data.boardTitle, created_at: '' }
    : data.promptMessage
  const responseMessage: Message | undefined = isProjectBoard
    ? data.recentUserMessage
    : data.responseMessage
  const conversationId = isProjectBoard ? data.boardId : data.conversationId
  const projectId = isProjectBoard ? data.projectId : undefined
  const dataCollapsed = data.isResponseCollapsed || false
  const supabase = createClient()
  const queryClient = useQueryClient()
  const router = useRouter()
  const {
    displayContentFor,
    isFramePending,
    pendingForMessage,
    setFocusedEditId,
    previewOriginal,
    justRestoredByMessage,
    consumeRestoredContent,
  } = useAiEditSession() // AI edit review session
  const wasAiPendingRef = useRef(false) // Detect pending → cleared (Remove / Save)
  const [aiForceSyncKey, setAiForceSyncKey] = useState(0) // Bump to setContent even while focused
  const { reactFlowInstance, panelWidth, getSetNodes, flashcardMode, setFlashcardMode, selectedTag } = useReactFlowContext() // Get zoom, panel width, setNodes function, flashcard study mode, and selected tag
  const { setNodes, getNodes } = useReactFlow() // Get setNodes and getNodes for NodeToolbar actions
  const updateNodeInternals = useUpdateNodeInternals() // Remeasure auto-sized frames without setNodes (avoids RO→setNodes storms)
  const rfStoreApi = useStoreApi() // Unselect legacy wrapper before RF snapshots dragItems (frame-body drag)
  const rfZoom = useStore((s) => s.transform[2] || 1) // Live board zoom — re-render chrome on zoom (comfort scale)
  const [promptHasChanges, setPromptHasChanges] = useState(false)
  const [responseHasChanges, setResponseHasChanges] = useState(false)
  // Single text body: plain-merge legacy prompt + response (no section split).
  // Sync-migrate sole databaseBlock → pageLink when linkedPageId exists (legacy pages only — not DBs).
  const [promptContent, setPromptContent] = useState(() => {
    if (isProjectBoard) return data.boardTitle || ''
    const responseRaw = data.responseMessage?.content
    const responseHtml = responseRaw ? formatResponseContent(responseRaw) : ''
    const merged = mergePanelHtml(data.promptMessage?.content, responseHtml)
    const meta = (data.promptMessage?.metadata || {}) as Record<string, unknown>
    const linkedId = typeof meta.linkedPageId === 'string' ? meta.linkedPageId : null
    if (!linkedId) return merged
    if (meta.notionObject === 'database') return merged // Keep structured DB table in-frame
    const iconMeta = meta.notionIcon as { type?: string; emoji?: string } | null
    const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
    return (
      migrateSoleDatabaseBlockToPageLink(merged, {
        pageId: linkedId,
        title: typeof meta.blockTitle === 'string' ? meta.blockTitle : null,
        icon: emoji,
      }) || merged
    )
  })
  const [responseContent, setResponseContent] = useState(responseMessage?.content || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isResponseCollapsed, setIsResponseCollapsed] = useState(dataCollapsed || false) // Track if response is collapsed
  const [showPromptMoreMenu, setShowPromptMoreMenu] = useState(!dataCollapsed) // Track if prompt more menu should be visible (with delay)
  const [comments, setComments] = useState<Comment[]>([]) // Store all comments for this panel
  const [showComments, setShowComments] = useState(false) // Toggle comment panels visibility
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null) // Track which comment is selected
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({}) // Reply input text per comment
  const [newCommentData, setNewCommentData] = useState<{
    selectedText: string
    from: number
    to: number
    section: 'prompt' | 'response'
  } | null>(null) // Track new comment data (selected text and position)
  const [newCommentText, setNewCommentText] = useState('') // New comment input text
  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([]) // Store all emoji reactions for this panel
  const [isBookmarked, setIsBookmarked] = useState(false) // Track if panel is bookmarked
  const panelRef = useRef<HTMLDivElement>(null) // Ref to panel container for positioning comment box
  const commentPanelsRef = useRef<HTMLDivElement>(null) // Ref to comment panels container for click-away detection
  const hasInitialShrunkRef = useRef<string | null>(null) // Track which panel ID we've done initial shrink for
  const [isInitialShrinkComplete, setIsInitialShrinkComplete] = useState(false) // Track if initial shrink is done (for hiding panel until ready)
  const promptEditorRef = useRef<any>(null) // Ref to prompt editor instance
  const responseEditorRef = useRef<any>(null) // Ref to response editor instance
  const newCommentTextareaRef = useRef<HTMLTextAreaElement>(null) // Ref for new comment textarea
  const replyTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({}) // Refs for reply textareas
  const hasAutoFocusedRef = useRef(false) // Track if note editor has been auto-focused
  const { resolvedTheme } = useTheme() // Get theme to set transparent background color
  
  // Resize state for panel scaling
  const [resizeDimensions, setResizeDimensions] = useState<{ width: number; height: number } | null>(null) // Track resized dimensions
  const [isUserResized, setIsUserResized] = useState(false) // True only after corner-drag or saved resizeDimensions — not auto line-grow
  const [fontScale, setFontScale] = useState(1) // Legacy editor font-size scale (blocks use frameScale instead)
  const [frameUnlocked, setFrameUnlocked] = useState(false) // Unlocked: free resize; locked: content scales with frame
  const [frameTextWrap, setFrameTextWrap] = useState(false) // Unlocked only: wrap lines in the frame box instead of clipping
  const [wrapColWidth, setWrapColWidth] = useState<number | null>(null) // Unscaled wrap column width — fixed on locked resize, restored on rewrap
  const [frameScale, setFrameScale] = useState(1) // Uniform content scale while frame is locked
  const [unlockedFrameSize, setUnlockedFrameSize] = useState<{ width: number; height: number } | null>(null) // Last free-resize shape (metadata continuity; unlock does NOT snap to this)
  const [unlockedFrameScale, setUnlockedFrameScale] = useState<number | null>(null) // Scale paired with unlockedFrameSize (bookkeeping only)
  const needsCollapsedDbFrameHealRef = useRef(false) // Load skipped corrupt DB clip — persist clear once persistFrameMeta exists

  const [intrinsicSize, setIntrinsicSize] = useState({ width: BLOCK_MIN_FRAME_W, height: 48 }) // Unscaled content box (max-content)
  const [intrinsicMeasured, setIntrinsicMeasured] = useState(false) // True after first contentFit measure (avoid hug flash)
  const [isFrameHovering, setIsFrameHovering] = useState(false) // Frame hover — page-open menu (not lock/rotate)
  const [clipPreviewReady, setClipPreviewReady] = useState(false) // True after hover dwell — delayed full-content peek
  const [rotation, setRotation] = useState(0) // Degrees of item rotation (persisted in message metadata)
  const [frameShape, setFrameShape] = useState<FrameShapeType | null>(null) // Silhouette (null = default frame)
  const isResizingRef = useRef(false) // Track if currently resizing
  const contentFitRef = useRef<HTMLDivElement>(null) // Inner unscaled content wrapper for intrinsic measure
  const frameScaleRef = useRef(1) // Latest scale — resize-end must not close over a stale render
  frameScaleRef.current = frameScale // Keep ref in sync every render
  const persistFrameMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Debounce hug-to-text saves
  const lockedResizeStartRef = useRef<{ width: number; height: number; scale: number } | null>(null) // Locked drag baseline
  const initialResizeWidthRef = useRef<number | null>(null) // Track initial panel width when resize starts (for note panels)
  const initialResizeHeightRef = useRef<number | null>(null) // Track initial panel height when resize starts (for note panels)
  const initialTextWidthRef = useRef<number | null>(null) // Track initial TEXT content width (for proper fill scaling)
  const isFirstResizeCallRef = useRef(true) // Track if this is the first resize call in the current session
  const initialTextAspectRatioRef = useRef<number | null>(null) // Track text's natural aspect ratio (width/height)
  const hasLoadedResizeStateRef = useRef(false) // Track if we've already loaded and applied resize state from metadata
  const isRotatingRef = useRef(false) // True while pointer-dragging the rotation handle
  const rotationDragRef = useRef<{ startAngle: number; startRotation: number } | null>(null) // Pointer math for live rotate

  // Helper function to convert hex color to rgba with opacity
  // Maintains transparency by converting hex to rgba with specified opacity
  const hexToRgba = useCallback((hex: string, opacity: number): string => {
    // Remove # if present
    const cleanHex = hex.replace('#', '')

    // Parse RGB values
    const r = parseInt(cleanHex.substring(0, 2), 16)
    const g = parseInt(cleanHex.substring(2, 4), 16)
    const b = parseInt(cleanHex.substring(4, 6), 16)

    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }, [])

  // Calculate panel background color with transparency
  // If fillColor is provided, convert to rgba with 0.15 opacity
  // If fillColor is empty/transparent, use fully transparent background
  const panelBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return hexToRgba(data.fillColor, 0.15) // Maintain 15% opacity for transparency
    }
    return 'transparent' // Fully transparent when no fill color is set
  }, [data.fillColor, hexToRgba])

  // Calculate prompt/grey area background color
  // Dark mode: 10% opacity, Light mode: 15% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // If fillColor is empty/transparent, use fully transparent
  const promptAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 10% opacity, Light mode: 15% opacity
      const opacity = resolvedTheme === 'dark' ? 0.10 : 0.15
      return hexToRgba(data.fillColor, opacity)
    }
    return 'transparent' // Fully transparent when no fill color is set
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Calculate response/white area background color
  // Dark mode: 15% opacity, Light mode: 10% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // If fillColor is empty/transparent, use fully transparent
  const responseAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 15% opacity, Light mode: 10% opacity
      const opacity = resolvedTheme === 'dark' ? 0.15 : 0.10
      return hexToRgba(data.fillColor, opacity)
    }
    return 'transparent' // Fully transparent when no fill color is set
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Connection points: blue fill + white border (matches selection chrome blue-500)
  const handleColor = '#3b82f6'
  const handleHoverColor = '#2563eb' // Slightly darker on hover/active
  const handleBorderColor = '#ffffff'

  // Check if panel is minimal (transparent fill + no visible border)
  // When minimal and not selected, handles should be hidden
  // Empty borderColor = Transparent (same as fill); borderStyle 'none' also counts
  const isFillTransparent = !data.fillColor || data.fillColor === '' || data.fillColor === null
  const isBorderColorTransparent =
    !data.borderColor || data.borderColor === '' || data.borderColor === null
  const isBorderNone =
    isBorderColorTransparent ||
    !data.borderStyle ||
    data.borderStyle === 'none' ||
    data.borderStyle === null
  const isMinimalPanel = isFillTransparent && isBorderNone
  const shouldHideHandles = isMinimalPanel && !selected

  // Handle click away from comment panels to deselect
  useEffect(() => {
    if (!showComments || !selectedCommentId) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Don't deselect if clicking on comment panels
      if (commentPanelsRef.current && commentPanelsRef.current.contains(target)) {
        return
      }

      // Check if clicking on highlighted commented text in editors
      const promptEditor = promptEditorRef.current
      const responseEditor = responseEditorRef.current

      let isClickOnCommentedText = false

      if (promptEditor && promptEditor.view.dom.contains(target)) {
        try {
          const pos = promptEditor.view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (pos) {
            isClickOnCommentedText = comments.some(c => c.section === 'prompt' && pos.pos >= c.from && pos.pos <= c.to)
          }
        } catch {
          // Ignore errors
        }
      }

      if (!isClickOnCommentedText && responseEditor && responseEditor.view.dom.contains(target)) {
        try {
          const pos = responseEditor.view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (pos) {
            isClickOnCommentedText = comments.some(c => c.section === 'response' && pos.pos >= c.from && pos.pos <= c.to)
          }
        } catch {
          // Ignore errors
        }
      }

      // If clicking on commented text, don't deselect
      if (isClickOnCommentedText) {
        return
      }

      // Otherwise, deselect immediately (clicking anywhere else - outside comment panels and not on commented text)
      setTimeout(() => { setSelectedCommentId(null) }, 0)
    }

    // Use capture phase and add immediately (no timeout)
    document.addEventListener('mousedown', handleClickOutside, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [showComments, selectedCommentId, comments])

  // Sync with data prop
  useEffect(() => {
    if (dataCollapsed !== undefined) {
      setIsResponseCollapsed(dataCollapsed)
      // Update prompt more menu visibility based on initial state
      if (dataCollapsed) {
        setShowPromptMoreMenu(false)
      } else {
        setShowPromptMoreMenu(true)
      }
    }
  }, [dataCollapsed])

  // Load bookmark state from message metadata (only for regular panels, not project boards)
  useEffect(() => {
    if (isProjectBoard) return // Project boards don't have bookmarks

    const checkBookmark = async () => {
      if (!responseMessage) return

      const { data: message } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessage.id)
        .single()

      if (message?.metadata && typeof message.metadata === 'object') {
        setIsBookmarked((message.metadata as any).bookmarked === true)
      }
    }

    checkBookmark()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectBoard, responseMessage?.id]) // Only depend on responseMessage.id to avoid unnecessary re-runs

  // Load resize dimensions/fontScale from message metadata on mount to restore panel size
  // Note: This effect calculates isBlock inline to avoid dependency on isBlock before it's defined
  useEffect(() => {
    if (isProjectBoard || !promptMessage || hasLoadedResizeStateRef.current) return // Project boards don't persist resize, and only load once

    // Block panel: metadata.isBlock, or empty user-only body
    const isBlockPanel = isBlockMeta(promptMessage?.metadata) ||
      (promptMessage?.role === 'user' && 
       !responseMessage && 
       (!promptMessage?.content || promptMessage.content.trim() === '' || promptMessage.content === '<p></p>' || promptMessage.content === '<p><br></p>'))

    const loadResizeState = async () => {
      // Get message metadata to check for saved resize state
      const { data: message } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', promptMessage.id)
        .single()

      if (message?.metadata && typeof message.metadata === 'object') {
        const metadata = message.metadata as Record<string, any>
        
        // For note panels: load fontScale (legacy scale-to-fit)
        if (isBlockPanel && metadata.fontScale && typeof metadata.fontScale === 'number') {
          setFontScale(metadata.fontScale)
        }

        // Restore saved rotation for items (degrees around panel center)
        if (isBlockPanel && typeof metadata.rotation === 'number') {
          setRotation(metadata.rotation) // Apply persisted angle so layout survives reload
        }

        // Frame silhouette (frames act as shapes)
        if (isBlockPanel) {
          setFrameShape(parseFrameShape(metadata.frameShape))
        }

        // Frame lock: default locked; unlocked lets the box resize independently of content
        if (isBlockPanel && typeof metadata.frameUnlocked === 'boolean') {
          setFrameUnlocked(metadata.frameUnlocked)
        }
        if (isBlockPanel && typeof metadata.frameTextWrap === 'boolean') {
          setFrameTextWrap(metadata.frameTextWrap) // Restore wrap-in-frame preference (unlocked chrome)
        }
        if (isBlockPanel && typeof metadata.wrapColWidth === 'number' && metadata.wrapColWidth > 0) {
          setWrapColWidth(metadata.wrapColWidth) // Restore the fixed wrap column width (unwrap/rewrap point)
        }
        if (
          isBlockPanel &&
          metadata.unlockedFrameSize &&
          typeof metadata.unlockedFrameSize === 'object'
        ) {
          const u = metadata.unlockedFrameSize as { width?: number; height?: number }
          if (u.width && u.height && u.width > 0 && u.height > 0) {
            setUnlockedFrameSize({ width: u.width, height: u.height }) // Shape to return to on unlock
          }
        }
        if (isBlockPanel && typeof metadata.unlockedFrameScale === 'number' && metadata.unlockedFrameScale > 0) {
          setUnlockedFrameScale(metadata.unlockedFrameScale) // Scale paired with the unlocked shape
        }
        if (isBlockPanel && typeof metadata.frameScale === 'number' && metadata.frameScale > 0) {
          setFrameScale(metadata.frameScale) // Locked proportional scale
        }
        // Load explicit box size for items + other panels (corner resize baseline).
        // Skip collapsed databaseBlock boxes left by post-drag hug while the table NodeView remounted
        // (heal-to-relock runs in a later effect once persistFrameMeta exists).
        if (metadata.resizeDimensions && typeof metadata.resizeDimensions === 'object') {
          const dims = metadata.resizeDimensions as { width?: number; height?: number }
          const contentHtml =
            typeof promptMessage?.content === 'string' ? promptMessage.content : ''
          const corruptDbClip =
            hasDatabaseBlockHtml(contentHtml) &&
            typeof dims.width === 'number' &&
            typeof dims.height === 'number' &&
            isCollapsedDatabaseFrameSize(dims.width, dims.height)
          if (corruptDbClip) {
            setFrameUnlocked(false) // Relock so next hug expands to the live table
            setResizeDimensions(null)
            setIsUserResized(false)
            setUnlockedFrameSize(null)
            needsCollapsedDbFrameHealRef.current = true // Also covered by heal effect below
            // Persist clear here — heal effect may not re-run if dims were never applied
            void (async () => {
              if (isProjectBoard || !promptMessage) return
              const { data: message } = await supabase
                .from('messages')
                .select('metadata')
                .eq('id', promptMessage.id)
                .single()
              const existingMetadata = (message?.metadata as Record<string, any>) || {}
              await supabase
                .from('messages')
                .update({
                  metadata: {
                    ...existingMetadata,
                    frameUnlocked: false,
                    frameScale: 1,
                    resizeDimensions: null,
                    unlockedFrameSize: null,
                    unlockedFrameScale: null,
                  },
                })
                .eq('id', promptMessage.id)
            })()
          } else if (dims.width && dims.height && dims.width > 0 && dims.height > 0) {
            setResizeDimensions({ width: dims.width, height: dims.height })
            setIsUserResized(true) // Persisted resize → wrap in fixed box; skip line-grow
            
            // Update React Flow node dimensions to match saved resize
            const setNodesFunc = getSetNodes()
            if (setNodesFunc) {
              setNodesFunc((nodes: any[]) =>
                nodes.map((node: any) =>
                  node.id === id
                    ? { ...node, width: dims.width, height: dims.height }
                    : node
                )
              )
            }
          }
        }
      }
      
      // Mark as loaded to prevent re-running
      hasLoadedResizeStateRef.current = true
    }

    loadResizeState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectBoard, promptMessage?.id]) // Load once on mount - only depend on promptMessage.id

  // Update node data when collapse state changes
  const handleCollapseChange = useCallback((collapsed: boolean) => {
    setIsResponseCollapsed(collapsed)

    // Hide prompt more menu immediately when collapsing
    if (collapsed) {
      setShowPromptMoreMenu(false)
    } else {
      // Show prompt more menu after 0.2s delay when expanding to prevent flash
      setTimeout(() => {
        setShowPromptMoreMenu(true)
      }, 200)
    }
    const setNodes = getSetNodes()
    if (setNodes && reactFlowInstance) {
      setNodes((nodes: any[]) =>
        nodes.map((node: any) =>
          node.id === id
            ? { ...node, data: { ...node.data, isResponseCollapsed: collapsed } }
            : node
        )
      )
    }
  }, [id, getSetNodes, reactFlowInstance])

  // Handle resize end - clear resizing flag and reset refs for next resize session
  // handleResizeEnd is defined after isBlock to access it - see below

  // Handle comment creation from text selection
  const handleComment = useCallback((selectedText: string, from: number, to: number, section: 'prompt' | 'response') => {
    setNewCommentData({ selectedText, from, to, section })
    setNewCommentText('') // Reset comment text
  }, [])

  // Handle adding emoji reaction
  const handleAddReaction = useCallback((selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => {
    // Get the appropriate editor (prompt or response)
    const editor = section === 'prompt' ? promptEditorRef.current : responseEditorRef.current

    // Apply blue highlight to the selected text (same as comments)
    if (editor) {
      try {
        // Use transaction to remove all highlight marks and apply blue
        const tr = editor.state.tr
        // Remove all highlight marks in the range
        tr.removeMark(from, to, editor.schema.marks.highlight)
        // Add blue highlight mark using blue-100 - slightly darker than blue-50
        tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' }))
        editor.view.dispatch(tr)
      } catch (error) {
        console.error('Error applying blue highlight to reacted text:', error)
      }
    }

    // Check if there's already a reaction for this exact text range
    const existingReaction = emojiReactions.find(
      reaction => reaction.from === from && reaction.to === to && reaction.section === section && reaction.emoji === emoji
    )

    if (existingReaction) {
      // Increment count if same emoji on same range
      setEmojiReactions(prev =>
        prev.map(reaction =>
          reaction.id === existingReaction.id
            ? { ...reaction, count: reaction.count + 1 }
            : reaction
        )
      )
    } else {
      // Create new reaction
      const newReaction: EmojiReaction = {
        id: `reaction-${Date.now()}-${Math.random()}`,
        selectedText,
        from,
        to,
        section,
        emoji,
        count: 1,
        createdAt: new Date().toISOString(),
      }
      setEmojiReactions(prev => [...prev, newReaction])
    }
  }, [emojiReactions])

  // Save new comment
  const handleSaveComment = useCallback(() => {
    if (!newCommentData || !newCommentText.trim()) return

    // Get the appropriate editor (prompt or response)
    const editor = newCommentData.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current

    // Remove any existing highlight (yellow) and apply blue highlight
    if (editor) {
      try {
        const { from, to } = newCommentData
        // Use transaction to remove all highlight marks and apply blue
        const tr = editor.state.tr
        // Remove all highlight marks in the range
        tr.removeMark(from, to, editor.schema.marks.highlight)
        // Add blue highlight mark using blue-100 - slightly darker than blue-50
        tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' }))
        editor.view.dispatch(tr)
      } catch (error) {
        console.error('Error applying blue highlight to commented text:', error)
      }
    }

    const newComment: Comment = {
      id: `comment-${Date.now()}-${Math.random()}`,
      selectedText: newCommentData.selectedText,
      from: newCommentData.from,
      to: newCommentData.to,
      section: newCommentData.section,
      comment: newCommentText.trim(),
      createdAt: new Date().toISOString(),
    }

    setComments(prev => [...prev, newComment])
    setNewCommentData(null)
    setNewCommentText('')
    setShowComments(true) // Show comments after creating one
  }, [newCommentData, newCommentText])

  // Get comment count
  const commentCount = comments.length

  // Auto-resize new comment textarea to maintain pill shape
  useEffect(() => {
    if (newCommentTextareaRef.current) {
      // Reset to base state for measurement
      newCommentTextareaRef.current.style.height = '52px'
      newCommentTextareaRef.current.style.lineHeight = '52px'
      newCommentTextareaRef.current.style.paddingTop = '0px'
      newCommentTextareaRef.current.style.paddingBottom = '0px'

      // Check if content fits in one line (pill shape)
      const scrollHeight = newCommentTextareaRef.current.scrollHeight
      const fitsInOneLine = scrollHeight <= 52

      if (fitsInOneLine) {
        // Content fits in one line - keep pill shape
        newCommentTextareaRef.current.style.height = '52px'
        newCommentTextareaRef.current.style.lineHeight = '52px' // Match height exactly for perfect pill
        newCommentTextareaRef.current.style.paddingTop = '0px' // No padding to maintain pill shape
        newCommentTextareaRef.current.style.paddingBottom = '0px' // No padding to maintain pill shape
        newCommentTextareaRef.current.style.overflow = 'hidden'
      } else {
        // Content needs multiple lines - expand naturally
        newCommentTextareaRef.current.style.height = 'auto'
        newCommentTextareaRef.current.style.lineHeight = '1.4'
        newCommentTextareaRef.current.style.paddingTop = '13px' // Add padding when expanded
        newCommentTextareaRef.current.style.paddingBottom = '13px' // Add padding when expanded
        const expandedHeight = newCommentTextareaRef.current.scrollHeight
        newCommentTextareaRef.current.style.height = `${expandedHeight}px`
        newCommentTextareaRef.current.style.overflow = 'auto'
      }
    }
  }, [newCommentText])

  // Auto-resize reply textareas to maintain pill shape
  useEffect(() => {
    Object.entries(replyTextareaRefs.current).forEach(([commentId, textarea]) => {
      if (textarea) {
        // Reset to base state for measurement
        textarea.style.height = '52px'
        textarea.style.lineHeight = '52px'
        textarea.style.paddingTop = '0px'
        textarea.style.paddingBottom = '0px'

        // Check if content fits in one line (pill shape)
        const scrollHeight = textarea.scrollHeight
        const fitsInOneLine = scrollHeight <= 52

        if (fitsInOneLine) {
          // Content fits in one line - keep pill shape
          textarea.style.height = '52px'
          textarea.style.lineHeight = '52px' // Match height exactly for perfect pill
          textarea.style.paddingTop = '0px' // No padding to maintain pill shape
          textarea.style.paddingBottom = '0px' // No padding to maintain pill shape
          textarea.style.overflow = 'hidden'
        } else {
          // Content needs multiple lines - expand naturally
          textarea.style.height = 'auto'
          textarea.style.lineHeight = '1.4'
          textarea.style.paddingTop = '13px' // Add padding when expanded
          textarea.style.paddingBottom = '13px' // Add padding when expanded
          const expandedHeight = textarea.scrollHeight
          textarea.style.height = `${expandedHeight}px`
          textarea.style.overflow = 'auto'
        }
      }
    })
  }, [replyTexts])

  // Determine if this is a flashcard - move definition up to use in hooks
  const isFlashcard = promptMessage?.metadata?.isFlashcard === true
  
  // Check if flashcard tags are loaded (for controlling toolbar visibility)
  const { isReady: tagsLoaded, tagIds } = useFlashcardTagsLoaded(isFlashcard && responseMessage?.id ? responseMessage.id : undefined)
  
  // Block card: metadata.isBlock, or empty user-only body
  const isBlock = isBlockMeta(promptMessage?.metadata) ||
    (promptMessage?.role === 'user' && 
     !responseMessage && 
     (!promptMessage?.content || promptMessage.content.trim() === '' || promptMessage.content === '<p></p>' || promptMessage.content === '<p><br></p>'))

  // Live silhouette from menu / optimistic node patch (not only first metadata load)
  useEffect(() => {
    if (!isBlock) return
    const fromMeta = parseFrameShape(promptMessage?.metadata?.frameShape)
    const fromData = !isProjectBoard
      ? parseFrameShape((data as ChatPanelNodeData).frameShape)
      : null
    setFrameShape(fromMeta ?? fromData)
  }, [isBlock, isProjectBoard, promptMessage?.metadata?.frameShape, data])

  // When Shape menu patches metadata, adopt unlock + box without waiting for remount
  useEffect(() => {
    if (!isBlock || !promptMessage?.metadata) return
    const meta = promptMessage.metadata as Record<string, unknown>
    if (!('frameShape' in meta) && !meta.resizeDimensions) return
    if (typeof meta.frameUnlocked === 'boolean') {
      setFrameUnlocked(meta.frameUnlocked)
    }
    const dims = meta.resizeDimensions as { width?: number; height?: number } | null | undefined
    if (dims && typeof dims.width === 'number' && typeof dims.height === 'number') {
      setResizeDimensions({ width: dims.width, height: dims.height })
      setIsUserResized(true)
    }
  }, [
    isBlock,
    promptMessage?.metadata?.frameShape,
    promptMessage?.metadata?.frameUnlocked,
    // Intentionally stringify dims so object identity from patches still triggers
    JSON.stringify(
      (promptMessage?.metadata as Record<string, unknown> | undefined)?.resizeDimensions ?? null
    ),
  ])

  // Miro split (locked):
  // • Connection **point** = invisible RF Handle on the frame edge (geometry + snap)
  // • Connection **indicator** = plain DOM dot outside — starts drag on the edge point (not an RF Handle)
  const isThreadConnecting = useIsThreadConnecting() // Hide adjust chrome while dragging a thread
  const isNearThreadSnap = useIsNearThreadConnection(id) // Pointer near this frame → show connection simulators
  // Pressed but not yet a drag — hide selection chrome until click release confirms select
  const [pressing, setPressing] = useState(false)
  // Full adjust chrome only when selected + idle (not mid-press / mid-drag)
  const showAdjustFrame = Boolean(selected && isBlock && !isThreadConnecting && !dragging && !pressing)
  // Transient blue outline while the frame is being moved (not a real selection)
  const showDragBorderOnly = Boolean(dragging && isBlock)
  // Stack host: dashed edge line to reveal collapsed mates
  const stackMeta = (promptMessage?.metadata || {}) as Record<string, unknown>
  const stackGroupId =
    typeof stackMeta.stackGroupId === 'string' ? stackMeta.stackGroupId : null
  const stackSide = (['top', 'right', 'bottom', 'left'] as const).includes(
    stackMeta.stackSide as FrameStackSide
  )
    ? (stackMeta.stackSide as FrameStackSide)
    : null
  // Line between each snap gap: any frame that still has a mate further out on stackSide
  const showStackGapLine = useStore((s) => {
    if (!stackGroupId || !stackSide) return false
    const myIdx =
      typeof stackMeta.stackIndex === 'number'
        ? (stackMeta.stackIndex as number)
        : stackMeta.stackAnchor === true
          ? 0
          : 99
    let hasOut = false
    s.nodeInternals.forEach((n) => {
      if (n.id === id || n.type !== 'chatPanel') return
      const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
      if (m.stackGroupId !== stackGroupId) return
      const idx = typeof m.stackIndex === 'number' ? m.stackIndex : 99
      if (idx > myIdx) hasOut = true
    })
    return hasOut
  })
  // Indicators: selected frame (idle), OR nearby snap target while connecting — never during frame drag
  const showIndicators =
    isBlock &&
    !isFlashcard &&
    !dragging &&
    ((selected && !isThreadConnecting) || (isThreadConnecting && isNearThreadSnap))

  // Invisible edge connection point — idle: no hit/cursor; while selected, source can be armed by indicator
  const connectionPointStyle = (): React.CSSProperties => ({
    width: '8px',
    height: '8px',
    opacity: 0,
    backgroundColor: 'transparent',
    border: 'none',
    boxShadow: 'none',
    cursor: 'default',
  }) as React.CSSProperties

  // Outer indicator (DOM only) placement — outset scales with frame UI size
  const connectionIndicatorStyle = (
    side: 'left' | 'right' | 'top' | 'bottom',
    uiScale = 1
  ): React.CSSProperties => {
    const out = INDICATOR_OUTSET * uiScale
    if (side === 'left') return { left: -out, top: '50%', transform: 'translate(-50%, -50%)' }
    if (side === 'right') return { right: -out, top: '50%', transform: 'translate(50%, -50%)' }
    if (side === 'top') return { top: -out, left: '50%', transform: 'translate(-50%, -50%)' }
    return { bottom: -out, left: '50%', transform: 'translate(-50%, 50%)' }
  }
  
  // Measured item box for edge-title perimeter math (items = former notes)
  const [itemBoxSize, setItemBoxSize] = useState({ width: 200, height: 120 })
  // In-place nested board for a titled item’s linked page
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false)
  const [pagePreviewMounted, setPagePreviewMounted] = useState(false) // Keep iframe warm after first open/hover
  const [previewTargetPageId, setPreviewTargetPageId] = useState<string | null>(null) // Which page the preview shows (pageLink or frame)
  const linkedPageId = !isProjectBoard
    ? (promptMessage?.metadata?.linkedPageId as string | undefined)
    : undefined
  const activePreviewPageId = previewTargetPageId || linkedPageId || null // Page the shell renders
  const blockTitleLabel =
    (promptMessage?.metadata?.blockTitle as string | undefined) || ''
  // Notion deep link for Open in Notion in the shared page open menu
  const notionUrl =
    !isProjectBoard && typeof promptMessage?.metadata?.notionUrl === 'string'
      ? (promptMessage.metadata.notionUrl as string)
      : null
  const isPageBody = isPageBodyMeta(promptMessage?.metadata) // Body on its own page — no nested open menu
  // Frame already has a pageLink for this page → that NodeView owns the open menu
  const hasPageLinkForFrame = !!(
    linkedPageId &&
    (promptContent.includes(`data-page-id="${linkedPageId}"`) ||
      promptContent.includes(`data-page-id='${linkedPageId}'`))
  )
  // databaseBlock NodeView owns Preview/Open when this is a Notion DB frame
  const hasDatabaseBlockForFrame = /data-type=["']databaseBlock["']/i.test(promptContent)
  // Page frames whose content is still regular TipTap blocks (legacy title) need the menu too
  const showFramePageOpenMenu =
    !!linkedPageId &&
    !isPageBody &&
    !pagePreviewOpen &&
    !hasPageLinkForFrame &&
    !hasDatabaseBlockForFrame &&
    (isFrameHovering || selected)

  // One-shot: legacy sole-databaseBlock map frames → pageLink (pages only).
  // Notion **databases** keep databaseBlock so the structured table NodeView can render.
  // Check server content too — useState may already have rewritten promptContent locally.
  const migratedDbFrameRef = useRef(false)
  useEffect(() => {
    if (migratedDbFrameRef.current || isProjectBoard || isPageBody) return
    if (!promptMessage?.id || !conversationId) return
    if (hasPageLinkForFrame) return
    // Intentional DB map frames (mindmap / Add frame on a DB) must stay as databaseBlock
    if ((promptMessage.metadata as { notionObject?: string } | null)?.notionObject === 'database') {
      return
    }
    const serverContent = promptMessage.content || ''
    const needsMigrate =
      isSoleDatabaseBlockContent(serverContent) || isSoleDatabaseBlockContent(promptContent)
    if (!needsMigrate) return

    migratedDbFrameRef.current = true
    void (async () => {
      try {
        const client = createClient()
        const { data: auth } = await client.auth.getUser()
        const userId = auth.user?.id
        if (!userId) {
          migratedDbFrameRef.current = false
          return
        }
        const sourceHtml = isSoleDatabaseBlockContent(serverContent) ? serverContent : promptContent

        // Fast path: linkedPageId already known → rewrite HTML locally + persist
        if (linkedPageId) {
          const iconMeta = promptMessage.metadata?.notionIcon as { type?: string; emoji?: string } | null
          const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
          const next = migrateSoleDatabaseBlockToPageLink(sourceHtml, {
            pageId: linkedPageId,
            title: blockTitleLabel || null,
            icon: emoji,
          })
          if (!next) {
            migratedDbFrameRef.current = false
            return
          }
          setPromptContent(next)
          setPromptHasChanges(true) // Block content-sync from clobbering until write lands
          const existingMeta = (promptMessage.metadata as Record<string, unknown>) || {}
          await client
            .from('messages')
            .update({
              content: next,
              metadata: { ...existingMeta, isPage: true, blockType: 'page' },
            })
            .eq('id', promptMessage.id)
          setPromptHasChanges(false)
          await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
          return
        }

        // Slow path: no linkedPageId yet — resolve/create nested page then rewrite
        const result = await ensureNotionMapFrameIsPageLink(client, {
          messageId: promptMessage.id,
          userId,
          parentConversationId: conversationId,
          content: sourceHtml,
          metadata: (promptMessage.metadata as Record<string, unknown>) || {},
        })
        if (!result) {
          migratedDbFrameRef.current = false
          return
        }
        setPromptContent(result.content)
        setPromptHasChanges(false)
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
      } catch (err) {
        console.error('Failed to migrate Notion DB frame to pageLink:', err)
        migratedDbFrameRef.current = false
      }
    })()
  }, [
    isProjectBoard,
    isPageBody,
    linkedPageId,
    promptMessage?.id,
    promptMessage?.content,
    promptMessage?.metadata,
    hasPageLinkForFrame,
    promptContent,
    blockTitleLabel,
    conversationId,
    queryClient,
  ])

  // Warm lean embed document (and mount hidden iframe) so first nav isn’t a cold boot
  const prefetchPagePreview = () => {
    if (!linkedPageId) return
    prefetchPageEmbed(linkedPageId)
    router.prefetch(`/embed/${linkedPageId}`)
    setPagePreviewMounted(true)
  }

  // Actions handed to pageLink NodeViews (open/close preview, open page, prefetch, rename, Notion)
  const pageLinkActions = useMemo<PageLinkActions>(
    () => ({
      previewPageId: pagePreviewOpen ? activePreviewPageId : null,
      openPreview: (pid: string) => {
        setPreviewTargetPageId(pid) // Point the shared shell at this child page
        setPagePreviewMounted(true)
        setPagePreviewOpen(true)
      },
      closePreview: () => setPagePreviewOpen(false),
      openPage: (pid: string) => router.push(`/board/${pid}`),
      prefetch: (pid: string) => {
        prefetchPageEmbed(pid)
        router.prefetch(`/embed/${pid}`)
        setPagePreviewMounted(true)
      },
      renameTitle: async (pid: string, title: string) => {
        try {
          const supabase = createClient()
          await supabase.from('conversations').update({ title: title || 'Untitled' }).eq('id', pid)
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        } catch (err) {
          console.error('Failed to rename linked page:', err)
        }
      },
      setIcon: async (pid: string, iconEmoji: string | null) => {
        try {
          const supabase = createClient()
          const { data: row } = await supabase.from('conversations').select('metadata').eq('id', pid).single()
          const existing = (row?.metadata as Record<string, unknown>) || {}
          const nextMeta = { ...existing }
          if (iconEmoji) nextMeta.icon = { type: 'emoji', emoji: iconEmoji } // Notion-compatible icon shape
          else delete nextMeta.icon
          await supabase.from('conversations').update({ metadata: nextMeta }).eq('id', pid)
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await queryClient.invalidateQueries({ queryKey: ['path-board-menu'] })
        } catch (err) {
          console.error('Failed to set linked page icon:', err)
        }
      },
      notionUrl, // Open in Notion button when this frame is Notion-linked
      // DB / legacy titled frames (no pageLink NodeView) reuse this for PageOpenMenu
      hostLinkedPageId: hasPageLinkForFrame ? null : linkedPageId || null,
    }),
    [pagePreviewOpen, activePreviewPageId, router, queryClient, notionUrl, hasPageLinkForFrame, linkedPageId]
  )

  // Update title-chip perimeter when the note/item box changes size
  useEffect(() => {
    if (!isBlock || !panelRef.current) return
    const updateFromSize = () => {
      if (!panelRef.current) return
      const width = panelRef.current.offsetWidth || 200
      const height = panelRef.current.offsetHeight || 120
      setItemBoxSize((prev) =>
        Math.abs(prev.width - width) <= 1 && Math.abs(prev.height - height) <= 1
          ? prev
          : { width, height }
      )
    }
    updateFromSize()
    const resizeObserver = new ResizeObserver(updateFromSize)
    resizeObserver.observe(panelRef.current)
    return () => resizeObserver.disconnect()
  }, [isBlock])

  // Natural content box (not the stretched w-full width when unlocked+resized) — lock hug needs this.
  // Debounced: RO can fire in bursts; avoid setState storms into BoardFlow.
  // Skip while the frame is being dragged — RF transforms make Range/gBCR measurements collapse
  // (esp. for databaseBlock tables) and hug would shrink the frame so the table “disappears”.
  useEffect(() => {
    if (!isBlock || dragging) return
    const el = contentFitRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // databaseBlock: wait until the Notion table NodeView is mounted. Measuring the title
        // stub (~52×40) after a remount would hug-shrink the frame and clip the table away.
        const dbHost = el.querySelector('.tt-database-block') as HTMLElement | null
        if (dbHost && !dbHost.querySelector('.tt-notion-db')) return
        const width = Math.max(1, Math.round(measureNaturalContentWidth(el)))
        const height = Math.max(1, Math.round(measureNaturalContentHeight(el)))
        if (
          (dbHost || hasDatabaseBlockHtml(promptContent)) &&
          isCollapsedDatabaseFrameSize(width, height)
        ) {
          return // Reject collapsed stub measures
        }
        setIntrinsicMeasured(true)
        setIntrinsicSize((prev) =>
          Math.abs(prev.width - width) <= 1 && Math.abs(prev.height - height) <= 1
            ? prev
            : { width, height }
        )
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [isBlock, dragging, promptContent, frameUnlocked, frameTextWrap, frameScale])
  // Note: do NOT depend on resizeDimensions — hug writes that and would loop
  
  // Regular chat panels are those that are not flashcards and not notes
  const isRegularChatPanel = !isFlashcard && !isBlock

  // Explicit box → RF node style. NEVER drive this from ResizeObserver: RF also writes measured
  // node.width/height, so RO→setNodes fights those numbers and allocates a new nodes[] every tick
  // (LOOP-DIAG: nodes(ref) len N→N). Push only when resizeDimensions change.
  const lastPushedBoxRef = useRef<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!isBlock || !isUserResized || !resizeDimensions) {
      if (!isUserResized) lastPushedBoxRef.current = null // Next resize must push fresh
      return
    }
    const boxW = Math.ceil(resizeDimensions.width)
    const boxH = Math.ceil(resizeDimensions.height)
    const prev = lastPushedBoxRef.current
    if (prev && Math.abs(prev.w - boxW) <= 1 && Math.abs(prev.h - boxH) <= 1) return // Already pushed
    lastPushedBoxRef.current = { w: boxW, h: boxH }
    const setNodesFunc = getSetNodes()
    if (!setNodesFunc) return
    setNodesFunc((nodes: any[]) => {
      let changed = false
      const next = nodes.map((node: any) => {
        if (node.id !== id) return node
        const styleW =
          typeof node.style?.width === 'number' ? node.style.width : parseFloat(node.style?.width)
        const styleH =
          typeof node.style?.height === 'number' ? node.style.height : parseFloat(node.style?.height)
        // Compare intended style only — ignore RF measured node.width (drifts vs border-box)
        const styleOk =
          Number.isFinite(styleW) &&
          Number.isFinite(styleH) &&
          Math.abs(styleW - boxW) <= 1 &&
          Math.abs(styleH - boxH) <= 1
        if (styleOk) return node
        changed = true
        return {
          ...node,
          width: boxW,
          height: boxH,
          style: { ...node.style, width: boxW, height: boxH },
        }
      })
      return changed ? next : nodes
    })
  }, [isBlock, id, isUserResized, resizeDimensions?.width, resizeDimensions?.height, getSetNodes])

  // Unresized (max-content) frames: remasure handles via updateNodeInternals — never setNodes style.
  const lastSyncedNodeSizeRef = useRef<{ w: number; h: number } | null>(null)
  const syncRafRef = useRef<number | null>(null)
  const syncStormRef = useRef({ n: 0, t: 0 })
  const clearedAutoSizeStyleRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isBlock || !panelRef.current || !isInitialShrinkComplete) return
    if (isUserResized) {
      clearedAutoSizeStyleRef.current = null // Allow re-strip after unlock→relock → grow-with-line
      return // Explicit box path owns RF size above
    }
    const el = panelRef.current
    lastSyncedNodeSizeRef.current = null
    syncStormRef.current = { n: 0, t: Date.now() }

    // One-shot: strip leftover style.width/height so max-content can own size
    if (clearedAutoSizeStyleRef.current !== id) {
      clearedAutoSizeStyleRef.current = id
      const setNodesFunc = getSetNodes()
      if (setNodesFunc) {
        setNodesFunc((nodes: any[]) => {
          let changed = false
          const next = nodes.map((node: any) => {
            if (node.id !== id) return node
            const hasStyleW = node.style?.width != null && node.style?.width !== ''
            const hasStyleH = node.style?.height != null && node.style?.height !== ''
            if (!hasStyleW && !hasStyleH) return node
            changed = true
            const style = { ...(node.style || {}) }
            delete style.width
            delete style.height
            return { ...node, style, width: undefined, height: undefined }
          })
          return changed ? next : nodes
        })
      }
    }

    const syncNodeSize = () => {
      if (isResizingRef.current || !el) return
      const width = Math.ceil(el.offsetWidth)
      const height = Math.ceil(el.offsetHeight)
      if (width <= 0 || height <= 0) return
      const prev = lastSyncedNodeSizeRef.current
      if (prev && Math.abs(prev.w - width) <= 1 && Math.abs(prev.h - height) <= 1) return
      const now = Date.now()
      if (now - syncStormRef.current.t > 1000) syncStormRef.current = { n: 0, t: now }
      syncStormRef.current.n += 1
      if (syncStormRef.current.n > 20) return // Circuit breaker
      lastSyncedNodeSizeRef.current = { w: width, h: height }
      updateNodeInternals(id) // Remeasure only — never setNodes
    }

    const schedule = () => {
      if (syncRafRef.current != null) cancelAnimationFrame(syncRafRef.current)
      syncRafRef.current = requestAnimationFrame(() => {
        syncRafRef.current = null
        syncNodeSize()
      })
    }

    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (syncRafRef.current != null) cancelAnimationFrame(syncRafRef.current)
    }
  }, [isBlock, id, getSetNodes, isInitialShrinkComplete, isUserResized, updateNodeInternals])

  // Persist frame lock / scale / box size (resize end + lock toggle + overflow expand)
  const persistFrameMeta = useCallback(async (patch: Record<string, unknown>) => {
    if (isProjectBoard || !promptMessage) return // Nothing to persist on project boards
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', promptMessage.id)
      .single()
    if (fetchError) {
      console.error('Error fetching message for frame save:', fetchError)
      return
    }
    const existingMetadata = (message?.metadata as Record<string, any>) || {}
    const { error: updateError } = await supabase
      .from('messages')
      .update({ metadata: { ...existingMetadata, ...patch } })
      .eq('id', promptMessage.id)
    if (updateError) console.error('Error saving frame metadata:', updateError)
  }, [isProjectBoard, promptMessage, supabase])

  // Heal: post-drag hug can persist ~52×40 on a databaseBlock frame (NodeView remount stub).
  // Clear the clip box + relock so the table can hug open again.
  const healedCollapsedDbFrameRef = useRef(false)
  useEffect(() => {
    if (!isBlock || healedCollapsedDbFrameRef.current) return
    const fromLoadFlag = needsCollapsedDbFrameHealRef.current
    const fromLiveDims =
      !!resizeDimensions &&
      hasDatabaseBlockHtml(promptContent) &&
      isCollapsedDatabaseFrameSize(resizeDimensions.width, resizeDimensions.height)
    if (!fromLoadFlag && !fromLiveDims) return
    healedCollapsedDbFrameRef.current = true
    needsCollapsedDbFrameHealRef.current = false
    setFrameUnlocked(false)
    setResizeDimensions(null)
    setIsUserResized(false)
    setUnlockedFrameSize(null)
    void persistFrameMeta({
      frameUnlocked: false,
      frameScale: 1,
      resizeDimensions: null,
      unlockedFrameSize: null,
      unlockedFrameScale: null,
    })
  }, [isBlock, promptContent, resizeDimensions, persistFrameMeta])

  // Corner pointer down — only then treat size changes as a user resize (ignore spurious RF callbacks)
  const handleResizeStart = useCallback(() => {
    isResizingRef.current = true // Block observer from fighting live resize
    setIsUserResized(true) // Switch from line-grow to explicit frame box
    const startW = resizeDimensions?.width ?? panelRef.current?.offsetWidth ?? 200
    const startH = resizeDimensions?.height ?? panelRef.current?.offsetHeight ?? 40
    lockedResizeStartRef.current = { width: startW, height: startH, scale: frameScale } // Locked proportional baseline
  }, [resizeDimensions, frameScale])

  // Handle resize end - clear resizing flag and persist explicit box size from final params
  const handleResizeEnd = useCallback(async (_event: any, params?: { width: number; height: number }) => {
    isResizingRef.current = false // Allow size-sync observer again
    isFirstResizeCallRef.current = true // Reset first-call bookkeeping
    setIsUserResized(true) // Persist mode: explicit frame box
    lockedResizeStartRef.current = null // Drop drag baseline

    const minW = blockMinFrameWidth(promptContent)
    let width = Math.max(params?.width ?? resizeDimensions?.width ?? 0, minW)
    let height = Math.max(params?.height ?? resizeDimensions?.height ?? 0, BLOCK_MIN_FRAME_H)
    // RF end params are AABB when rotated — store unrotated content size
    if (Math.abs(rotation) > 0.5 && params?.width && params?.height) {
      const fallback = resizeDimensions || { width, height }
      const content = contentSizeFromAabb(params.width, params.height, rotation, fallback)
      width = Math.max(content.width, minW)
      height = Math.max(content.height, BLOCK_MIN_FRAME_H)
    }
    const finalScale = frameScaleRef.current // Latest scale from the drag (avoid stale closure)
    let colToPersist: number | undefined // New wrap column width to store (unlocked-wrap resize sets the point)
    if (!frameUnlocked && frameTextWrap) {
      // Locked wrap: hug WIDTH to the scaled FIXED columns (no reflow) + HEIGHT to wrapped content.
      if (wrapColWidth != null) width = Math.round(wrapColWidth * Math.max(0.15, finalScale)) + 2
      height = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(intrinsicSize.height * Math.max(0.15, finalScale)) + 2)
    } else if (!frameUnlocked) {
      const hugged = scaledFrameSize(intrinsicSize, finalScale, minW) // Nowrap: snap to scaled text
      width = hugged.width
      height = hugged.height
    } else if (frameTextWrap) {
      // Unlocked wrap: the dragged width IS the new wrap point — remember it (unscaled columns).
      colToPersist = Math.max(1, Math.floor((width - 2) / Math.max(0.15, finalScale)))
      setWrapColWidth(colToPersist)
    }
    // Unlocked (wrap or nowrap): keep the user's dragged box — a frame shorter than its
    // content clips the overflow (chevron expands), same for wrapped and non-wrapped text.
    if (width > 0 && height > 0) {
      setResizeDimensions({ width, height }) // Lock final box size into local state
    }
    // Unlocked drag refreshes the last free-resize shape (bookkeeping only — unlock keeps current size).
    if (frameUnlocked) {
      setUnlockedFrameSize({ width, height })
      setUnlockedFrameScale(finalScale)
    }

    await persistFrameMeta({
      resizeDimensions: { width, height },
      frameUnlocked,
      frameTextWrap, // Wrap persists in either lock state now
      frameScale: finalScale,
      fontScale,
      ...(frameUnlocked ? { unlockedFrameSize: { width, height }, unlockedFrameScale: finalScale } : {}),
      ...(colToPersist != null ? { wrapColWidth: colToPersist } : {}), // Save the new unlocked wrap point
    })
  }, [resizeDimensions, frameUnlocked, frameTextWrap, wrapColWidth, fontScale, persistFrameMeta, intrinsicSize, promptContent, rotation])

  // Corner-drag: locked → proportional content scale; unlocked → free frame (content stays)
  // When rotated, RF reports AABB size — convert back to unrotated content size.
  const handleResize = useCallback((_event: any, params: { width: number; height: number }) => {
    if (!isResizingRef.current) return // Ignore mount/select noise — only after handleResizeStart
    const minW = blockMinFrameWidth(promptContent)
    const fallback = resizeDimensions || lockedResizeStartRef.current || {
      width: minW,
      height: BLOCK_MIN_FRAME_H,
    }
    let width = Math.max(params.width, minW)
    let height = Math.max(params.height, BLOCK_MIN_FRAME_H)
    if (Math.abs(rotation) > 0.5) {
      const content = contentSizeFromAabb(width, height, rotation, fallback)
      width = Math.max(content.width, minW)
      height = Math.max(content.height, BLOCK_MIN_FRAME_H)
    }
    if (!frameUnlocked && lockedResizeStartRef.current) {
      // Locked (wrap OR nowrap): proportional content scale — width/text scale together.
      const start = lockedResizeStartRef.current
      const ratio = width / Math.max(1, start.width) // keepAspectRatio → width tracks height
      const nextScale = Math.max(0.15, start.scale * ratio)
      setFrameScale(nextScale) // Blocks scale with the frame
      if (frameTextWrap && wrapColWidth != null) {
        // Locked WRAP: derive the box from the FIXED column width × scale so NO character reflows —
        // the wrapped text just scales up/down (columns stay constant, +2 border).
        setResizeDimensions({
          width: Math.round(wrapColWidth * nextScale) + 2,
          height: Math.max(BLOCK_MIN_FRAME_H, Math.round(intrinsicSize.height * nextScale) + 2),
        })
        return
      }
    }
    setResizeDimensions({ width, height }) // Drive panel style — matches RF dimension changes
  }, [frameUnlocked, frameTextWrap, wrapColWidth, intrinsicSize, promptContent, rotation, resizeDimensions])

  // Persist item rotation degrees into message metadata after a rotate gesture ends
  const saveRotation = useCallback(async (nextRotation: number) => {
    if (isProjectBoard || !promptMessage) return // Project boards / missing message: skip DB write
    const { data: message, error: fetchError } = await supabase // Fetch current metadata blob
      .from('messages')
      .select('metadata')
      .eq('id', promptMessage.id)
      .single()
    if (fetchError) { // Bail if we cannot read existing metadata
      console.error('Error fetching message for rotation save:', fetchError)
      return
    }
    const existingMetadata = (message?.metadata as Record<string, any>) || {} // Keep other metadata keys
    const { error: updateError } = await supabase // Write rotation alongside existing fields
      .from('messages')
      .update({ metadata: { ...existingMetadata, rotation: nextRotation } })
      .eq('id', promptMessage.id)
    if (updateError) console.error('Error saving rotation to database:', updateError) // Surface write failures
  }, [isProjectBoard, promptMessage, supabase])

  // Begin rotate: measure angle from panel center to pointer and lock drag state
  const handleRotatePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation() // Do not select/drag the RF node
    e.preventDefault() // Avoid text selection while rotating
    if (!panelRef.current) return // Need geometry for center
    // Lock current unrotated content size so AABB math has a stable base (outer becomes AABB)
    if (!resizeDimensions) {
      const fit = contentFitRef.current
      const w = Math.max(
        blockMinFrameWidth(promptContent),
        fit?.offsetWidth || panelRef.current.offsetWidth || 200
      )
      const h = Math.max(BLOCK_MIN_FRAME_H, fit?.offsetHeight || panelRef.current.offsetHeight || 40)
      setResizeDimensions({ width: w, height: h })
      setIsUserResized(true)
    }
    const rect = panelRef.current.getBoundingClientRect() // Screen-space panel bounds
    const cx = rect.left + rect.width / 2 // Horizontal center in viewport
    const cy = rect.top + rect.height / 2 // Vertical center in viewport
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) // Initial pointer angle (radians)
    isRotatingRef.current = true // Mark active rotate session
    rotationDragRef.current = { startAngle, startRotation: rotation } // Baseline for delta math
    e.currentTarget.setPointerCapture(e.pointerId) // Keep events on this handle while dragging
  }, [rotation, resizeDimensions, promptContent])

  // Live-update rotation from pointer deltas relative to panel center
  const handleRotatePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current || !rotationDragRef.current || !panelRef.current) return // Ignore stray moves
    const rect = panelRef.current.getBoundingClientRect() // Re-measure (zoom/pan may change)
    const cx = rect.left + rect.width / 2 // Center X
    const cy = rect.top + rect.height / 2 // Center Y
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx) // Current pointer angle
    const deltaDeg = ((angle - rotationDragRef.current.startAngle) * 180) / Math.PI // Radians → degrees
    let next = rotationDragRef.current.startRotation + deltaDeg // Apply delta to start rotation
    if (e.shiftKey) next = Math.round(next / 15) * 15 // Hold Shift to snap to 15° increments
    setRotation(next) // Paint live rotation
  }, [])

  // End rotate: release capture and persist the final angle
  const handleRotatePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current) return // Only finish an active gesture
    isRotatingRef.current = false // Clear rotating flag
    rotationDragRef.current = null // Drop drag baseline
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    setRotation((current) => { // Read latest angle then persist
      void saveRotation(current) // Fire-and-forget metadata save
      return current // No state change needed
    })
  }, [saveRotation])

  // Toggle frame lock: lock hugs scaled text; unlock keeps the CURRENT visual box + scale
  // (blocks stay the size they were adjusted to while locked — no snap-back to a pre-lock shape).
  const handleToggleFrameLock = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const nextUnlocked = !frameUnlocked
    setFrameUnlocked(nextUnlocked)
    if (nextUnlocked) {
      // Keep locked visual size: same box + same frameScale (proportional resize stays).
      const el = panelRef.current
      const nextDims = resizeDimensions ?? {
        width: Math.max(blockMinFrameWidth(promptContent), el?.offsetWidth ?? intrinsicSize.width),
        height: Math.max(BLOCK_MIN_FRAME_H, el?.offsetHeight ?? intrinsicSize.height),
      }
      setResizeDimensions(nextDims)
      setIsUserResized(true)
      // Also seed the unlocked returnable shape to the CURRENT size so later unlocked
      // resize-end bookkeeping stays coherent (not used to snap size on unlock).
      setUnlockedFrameSize(nextDims)
      setUnlockedFrameScale(frameScale)
      void persistFrameMeta({
        frameUnlocked: true,
        frameScale, // Preserve locked scale so block size does not jump
        resizeDimensions: nextDims,
        frameTextWrap,
        unlockedFrameSize: nextDims,
        unlockedFrameScale: frameScale,
      })
      return
    }
    // Locking: remember the CURRENT unlocked shape (+scale) for metadata continuity.
    const unlockedShape =
      resizeDimensions ?? {
        width: Math.max(blockMinFrameWidth(promptContent), panelRef.current?.offsetWidth ?? intrinsicSize.width),
        height: Math.max(BLOCK_MIN_FRAME_H, panelRef.current?.offsetHeight ?? intrinsicSize.height),
      }
    setUnlockedFrameSize(unlockedShape)
    setUnlockedFrameScale(frameScale)
    const fitEl = contentFitRef.current
    const naturalH = fitEl ? measureNaturalContentHeight(fitEl) : intrinsicSize.height
    // Relock WHILE wrapped: keep the unlocked wrap WIDTH (text stays wrapped at that width);
    // hug HEIGHT only to the wrapped content. Wrap persists through lock.
    if (frameTextWrap && resizeDimensions) {
      const keepW = resizeDimensions.width // Same width the wrap had when unlocked
      const wrapH = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(naturalH * Math.max(0.15, frameScale)) + 2)
      const nextDims = { width: keepW, height: wrapH }
      setResizeDimensions(nextDims)
      setIsUserResized(true)
      void persistFrameMeta({
        frameUnlocked: false,
        frameScale,
        resizeDimensions: nextDims,
        frameTextWrap: true, // Keep wrap on through lock
        unlockedFrameSize: unlockedShape,
        unlockedFrameScale: frameScale,
      })
      return
    }
    // Relock (nowrap): hug width AND height to natural text (locked = hug to content)
    const naturalW = fitEl ? measureNaturalContentWidth(fitEl) : intrinsicSize.width
    const minW = blockMinFrameWidth(promptContent)
    const hugged = scaledFrameSize(
      { width: naturalW, height: naturalH },
      frameScale,
      minW
    )
    const nextDims = { width: hugged.width, height: hugged.height }
    setIntrinsicSize((prev) =>
      Math.abs(prev.width - naturalW) <= 1 && Math.abs(prev.height - naturalH) <= 1
        ? prev
        : { width: naturalW, height: naturalH }
    )
    setResizeDimensions(nextDims)
    setIsUserResized(true)
    void persistFrameMeta({
      frameUnlocked: false,
      frameScale,
      resizeDimensions: nextDims,
      frameTextWrap: false,
      unlockedFrameSize: unlockedShape,
      unlockedFrameScale: frameScale,
    })
  }, [frameUnlocked, frameScale, resizeDimensions, intrinsicSize, frameTextWrap, persistFrameMeta, promptContent])

  // Unlocked: wrap lines inside the frame width (vs clip overflow)
  const handleToggleFrameTextWrap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // Wrap works locked or unlocked: it wraps at a FIXED column width and keeps it.
    const next = !frameTextWrap
    const s = Math.max(0.15, frameScale)
    // Wrap needs a fixed box to wrap into. A locked frame that was hugging content may not have
    // resizeDimensions yet — snapshot the live box and switch to explicit-box (isUserResized) mode.
    const box = resizeDimensions ?? {
      width: Math.max(blockMinFrameWidth(promptContent), panelRef.current?.offsetWidth ?? intrinsicSize.width),
      height: Math.max(BLOCK_MIN_FRAME_H, panelRef.current?.offsetHeight ?? intrinsicSize.height),
    }
    if (!resizeDimensions) setResizeDimensions(box) // Seed the box so width is stable under wrap
    setIsUserResized(true)
    setFrameTextWrap(next)
    // Reuse the stored wrap point (set when unlocked) so unwrap→rewrap returns to the SAME columns;
    // only capture a fresh one the first time wrap is turned on and none exists yet.
    let col = wrapColWidth
    if (next && col == null) {
      col = Math.max(1, Math.floor((box.width - 2) / s))
      setWrapColWidth(col)
    }
    void persistFrameMeta({
      frameTextWrap: next,
      frameUnlocked, // Preserve lock state (was always forcing unlocked)
      frameScale,
      resizeDimensions: box,
      ...(col != null ? { wrapColWidth: col } : {}),
    })
    // Locked = hug to content. After the wrap/nowrap layout reflows, deterministically re-hug so
    // wrap-on restores the stored columns × scale + hugs height; wrap-off hugs BOTH dims to nowrap text.
    if (!frameUnlocked) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const cf = contentFitRef.current
        if (!cf) return
        const height = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(measureNaturalContentHeight(cf) * s) + 2)
        setResizeDimensions((prev) => {
          const base = prev ?? box
          const width = next // Wrap-on: restore stored columns × scale; Wrap-off: hug to nowrap content
            ? (col != null ? Math.round(col * s) + 2 : base.width)
            : Math.max(blockMinFrameWidth(promptContent), Math.ceil(measureNaturalContentWidth(cf) * s) + 2)
          return { width, height }
        })
      }))
    }
  }, [frameUnlocked, frameTextWrap, frameScale, wrapColWidth, resizeDimensions, persistFrameMeta, promptContent, intrinsicSize])

  // (Overflow caret removed — lock = fit-to-content; unlock keeps current visual size + free resize/clip.)

  // Locked + resized: hug WIDTH and HEIGHT to natural text (locked = hug to content) —
  // shrink/grow both dimensions on lock/type instead of keeping the taller resize box.
  useEffect(() => {
    if (!isBlock || frameUnlocked || !isUserResized || pagePreviewOpen || dragging) return
    if (!intrinsicMeasured || isResizingRef.current) return
    const minW = blockMinFrameWidth(promptContent)
    const natural = scaledFrameSize(intrinsicSize, frameScale, minW)
    // Never hug a databaseBlock frame down to the remount stub — that persists as a permanent clip.
    if (
      hasDatabaseBlockHtml(promptContent) &&
      isCollapsedDatabaseFrameSize(natural.width, natural.height)
    ) {
      return
    }
    let next = natural
    let changed = true
    setResizeDimensions((prev) => {
      // Wrap keeps its fixed width (text stays wrapped at that width); nowrap hugs width to content.
      const width = frameTextWrap && prev ? prev.width : natural.width
      // Hug height to content too (was: keep the taller box until a manual resize)
      const height = natural.height
      next = { width, height }
      if (
        prev &&
        hasDatabaseBlockHtml(promptContent) &&
        isCollapsedDatabaseFrameSize(width, height) &&
        !isCollapsedDatabaseFrameSize(prev.width, prev.height)
      ) {
        changed = false
        return prev // Keep the larger box; don't clip the table away
      }
      if (
        prev &&
        Math.abs(prev.width - width) <= 1 &&
        Math.abs(prev.height - height) <= 1
      ) {
        changed = false
        return prev
      }
      return next
    })
    if (!changed) return
    if (persistFrameMetaTimerRef.current) clearTimeout(persistFrameMetaTimerRef.current)
    persistFrameMetaTimerRef.current = setTimeout(() => {
      void persistFrameMeta({
        resizeDimensions: next,
        frameUnlocked: false,
        frameScale,
      })
    }, 250)
    return () => {
      if (persistFrameMetaTimerRef.current) clearTimeout(persistFrameMetaTimerRef.current)
    }
  }, [
    isBlock,
    frameUnlocked,
    isUserResized,
    pagePreviewOpen,
    dragging,
    intrinsicMeasured,
    intrinsicSize,
    frameScale,
    frameTextWrap,
    persistFrameMeta,
    promptContent,
  ])

  // Unlocked WRAP no longer auto-hugs height: like non-wrap clip, the frame keeps the user's box
  // and a frame shorter than the wrapped content clips the overflow + shows the expand chevron.

  // Auto-select panel when editor is focused or has a text range (not pageLink NodeSelection)
  const handleEditorActiveChange = useCallback((isActive: boolean) => {
    if (isActive && !selected) {
      // Editor is active (focused or has selection) but panel is not selected - auto-select it
      // First deselect all other nodes, then select this one
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, selected: true }
            : { ...node, selected: false }
        )
      )
    }
  }, [id, selected, setNodes])

  // Pane click deselected this frame — drop editor/title focus + atom NodeSelection so the
  // auto-select effect cannot immediately re-select (pageLink title is contentEditable inside PM).
  useEffect(() => {
    if (selected) return
    const ed = promptEditorRef.current
    if (!ed || ed.isDestroyed) return
    const root = ed.view.dom as HTMLElement
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae === root || root.contains(ae))) {
      ae.blur() // Title label or PM surface
    }
    const sel = ed.state.selection
    if (sel instanceof TextSelection && sel.empty) return // Already a caret — nothing to clear
    // near() lands a caret beside atoms (TextSelection.create at a pageLink pos throws)
    try {
      const pos = Math.max(0, Math.min(sel.from, ed.state.doc.content.size))
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos))))
    } catch {
      // ignore invalid pos
    }
  }, [selected])

  // Flashcard navigation - get all flashcards in the same board/project/study set
  // For regular boards that are part of a project, also enable cross-board navigation
  // Fetch project ID from board metadata if it's a regular board
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null)
  
  useEffect(() => {
    if (isProjectBoard || !conversationId || !isFlashcard) {
      setBoardProjectId(null)
      return
    }
    
    // Fetch conversation metadata to get project_id
    const fetchProjectId = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      
      if (!error && data?.metadata) {
        const metadata = data.metadata as Record<string, any>
        const projectId = metadata.project_id
        if (projectId) {
          setBoardProjectId(projectId)
        } else {
          setBoardProjectId(null)
        }
      } else {
        setBoardProjectId(null)
      }
    }
    
    fetchProjectId()
  }, [conversationId, isProjectBoard, isFlashcard, supabase])
  
  // Fetch all boards in the project (if board is part of a project)
  const { data: projectBoards = [] } = useQuery({
    queryKey: ['project-boards-for-flashcards', boardProjectId],
    queryFn: async () => {
      if (!boardProjectId) return []
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, metadata')
        .eq('user_id', user.id)
        .contains('metadata', { project_id: boardProjectId })
      
      if (error) {
        console.error('Error fetching project boards:', error)
        return []
      }
      return (data || []) as Array<{ id: string; title: string; metadata: any }>
    },
    enabled: !!boardProjectId && !isProjectBoard,
  })
  
  // Fetch flashcards from all boards (project or all boards if tag selected) to check if there are flashcards in other boards
  const { data: projectFlashcards = [] } = useQuery({
    queryKey: ['project-flashcards', boardProjectId, projectBoards.map(b => b.id).join(','), selectedTag],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      
      let boardIds: string[] = []
      
      // If a tag is selected, search across ALL boards (not just project)
      if (selectedTag) {
        // Fetch all user's boards
        const { data: allBoards, error: boardsError } = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', user.id)
        
        if (boardsError) {
          console.error('Error fetching all boards:', boardsError)
          return []
        }
        
        boardIds = (allBoards || []).map(b => b.id)
      } else if (boardProjectId && projectBoards.length > 0) {
        // No tag selected, use project boards
        boardIds = projectBoards.map(b => b.id)
      } else {
        return []
      }
      
      if (boardIds.length === 0) return []
      
      // Fetch all messages from relevant boards
      const { data: allMessages, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at, metadata, conversation_id')
        .eq('user_id', user.id)
        .in('conversation_id', boardIds)
        .order('created_at', { ascending: true })
      
      if (error) {
        console.error('Error fetching flashcards:', error)
        return []
      }
      
      if (!allMessages || allMessages.length === 0) return []
      
      // Filter for flashcards (user messages with isFlashcard metadata)
      // If tag is selected, also filter by studySetIds in the response message
      const flashcards: Array<{ boardId: string; messageId: string }> = []
      for (let i = 0; i < allMessages.length; i++) {
        const message = allMessages[i]
        if (message.role === 'user') {
          const metadata = (message.metadata as Record<string, any>) || {}
          if (metadata.isFlashcard === true) {
            // If tag is selected, check if the response message has that tag
            if (selectedTag) {
              // Find the next assistant message (response) for this flashcard
              let hasTag = false
              for (let j = i + 1; j < allMessages.length && allMessages[j].conversation_id === message.conversation_id; j++) {
                if (allMessages[j].role === 'assistant') {
                  const responseMetadata = (allMessages[j].metadata as Record<string, any>) || {}
                  const studySetIds = (responseMetadata.studySetIds || []) as string[]
                  if (studySetIds.includes(selectedTag)) {
                    hasTag = true
                    break
                  }
                  // Only check the first response message for this flashcard
                  break
                }
              }
              if (!hasTag) {
                continue // Skip flashcards without the selected tag
              }
            }
            
            flashcards.push({
              boardId: message.conversation_id || '',
              messageId: message.id
            })
          }
        }
      }
      
      return flashcards
    },
    enabled: (!!boardProjectId && !isProjectBoard && projectBoards.length > 0) || (!!selectedTag && isFlashcard),
  })
  
  // Check if there are flashcards in other boards (project or all boards if tag selected)
  const hasFlashcardsInOtherBoards = useMemo(() => {
    if (!projectFlashcards.length) return false
    
    // If tag is selected, check all boards (not just project)
    // Otherwise, check project boards only
    if (selectedTag) {
      // With tag selected, check if there are flashcards in any other board
      const otherBoardsFlashcards = projectFlashcards.filter(f => f.boardId !== conversationId)
      return otherBoardsFlashcards.length > 0
    } else {
      // No tag selected - only check project boards
      if (!boardProjectId || !conversationId) return false
      const otherBoardsFlashcards = projectFlashcards.filter(f => f.boardId !== conversationId)
      return otherBoardsFlashcards.length > 0
    }
  }, [boardProjectId, conversationId, projectFlashcards, selectedTag])
  
  // Use state to track nodes and force recomputation when nodes change
  const [flashcardCount, setFlashcardCount] = useState(0)
  
  // Update flashcard count when nodes change (using effect to watch for node changes)
  useEffect(() => {
    if (!reactFlowInstance || !isFlashcard) {
      setFlashcardCount(0)
      return
    }
    
    // Function to compute and update flashcard count
    const updateFlashcardCount = () => {
      const allNodes = reactFlowInstance.getNodes() || []
      const count = allNodes.filter((node) => {
        const nodeData = node.data as ChatPanelNodeData
        const nodeIsFlashcard = nodeData.promptMessage?.metadata?.isFlashcard === true
        if (!nodeIsFlashcard) return false
        
        // For project boards, check projectId
        if (isProjectBoard && projectId) {
          const nodeIsProjectBoard = isProjectBoardData(node.data)
          return nodeIsProjectBoard && node.data.projectId === projectId
        }
        
        // For regular boards, check conversationId
        if (conversationId) {
          return nodeData.conversationId === conversationId
        }
        
        // For study sets, include all flashcards
        return true
      }).length
      
      setFlashcardCount(count)
    }
    
    // Check immediately
    updateFlashcardCount()
    
    // Set up interval to check for changes (since React Flow doesn't expose node change events directly)
    const interval = setInterval(updateFlashcardCount, 300) // Check every 300ms
    
    return () => clearInterval(interval)
  }, [reactFlowInstance, isFlashcard, conversationId, isProjectBoard, projectId])
  
  const flashcardNodes = useMemo(() => {
    if (!isFlashcard || !reactFlowInstance) return []
    const allNodes = reactFlowInstance.getNodes() || []
    // Filter for flashcards in the same context (board/project/study set)
    // If tag is selected, also filter by tag
    return allNodes.filter((node) => {
      const nodeData = node.data as ChatPanelNodeData
      const nodeIsFlashcard = nodeData.promptMessage?.metadata?.isFlashcard === true
      if (!nodeIsFlashcard) return false
      
      // If tag is selected, check if flashcard has that tag (check response message metadata)
      if (selectedTag) {
        const responseMessage = nodeData.responseMessage
        if (responseMessage?.metadata) {
          const metadata = responseMessage.metadata as Record<string, any>
          const studySetIds = (metadata.studySetIds || []) as string[]
          if (!studySetIds.includes(selectedTag)) {
            return false // Skip flashcards without the selected tag
          }
        } else {
          return false // No response message or metadata, can't have the tag
        }
      }
      
      // If tag is selected, include flashcards from all boards (not just current context)
      if (selectedTag) {
        return true // Include all flashcards with the selected tag, regardless of board
      }
      
      // No tag selected - use original context filtering
      // For project boards, check projectId
      if (isProjectBoard && projectId) {
        const nodeIsProjectBoard = isProjectBoardData(node.data)
        if (nodeIsProjectBoard && node.data.projectId === projectId) return true
        return false
      }
      
      // For regular boards, check conversationId
      if (conversationId) {
        if (nodeData.conversationId === conversationId) return true
        return false
      }
      
      // For study sets (no conversationId or projectId), include all flashcards
      return true
    })
  }, [isFlashcard, reactFlowInstance, conversationId, isProjectBoard, projectId, flashcardCount, selectedTag])

  const currentFlashcardIndex = useMemo(() => {
    if (!isFlashcard || flashcardNodes.length === 0) return -1
    return flashcardNodes.findIndex((node) => node.id === id)
  }, [isFlashcard, flashcardNodes, id])

  const hasMultipleFlashcards = flashcardNodes.length > 1
  
  // Check if we're at the last flashcard in the current board
  // If there's only one flashcard in the board, it's both first and last
  const isAtLastFlashcardInBoard = useMemo(() => {
    if (currentFlashcardIndex < 0 || flashcardNodes.length === 0) return false
    return currentFlashcardIndex === flashcardNodes.length - 1
  }, [currentFlashcardIndex, flashcardNodes.length])
  
  // Check if we're at the first flashcard in the current board
  // If there's only one flashcard in the board, it's both first and last
  const isAtFirstFlashcardInBoard = useMemo(() => {
    if (currentFlashcardIndex < 0) return false
    return currentFlashcardIndex === 0
  }, [currentFlashcardIndex])

  // Find the next board with flashcards (all boards if tag selected, otherwise project boards)
  const nextBoardWithFlashcards = useMemo(() => {
    if (!hasFlashcardsInOtherBoards || !conversationId) return null
    
    // If tag is selected, get all boards from projectFlashcards (which includes all boards)
    // Otherwise, use projectBoards
    let boardsToSearch: Array<{ id: string; title: string }> = []
    if (selectedTag) {
      // Get unique board IDs from projectFlashcards
      const uniqueBoardIds = [...new Set(projectFlashcards.map(f => f.boardId))]
      // Fetch board titles (we'll use IDs for now, titles aren't critical for navigation)
      boardsToSearch = uniqueBoardIds.map(id => ({ id, title: '' }))
    } else {
      boardsToSearch = projectBoards
    }
    
    if (!boardsToSearch.length) return null
    
    // Find current board index
    const currentBoardIndex = boardsToSearch.findIndex(b => b.id === conversationId)
    if (currentBoardIndex < 0) return null
    
    // Find next board that has flashcards (with selected tag if tag is selected)
    for (let i = 1; i < boardsToSearch.length; i++) {
      const nextBoardIndex = (currentBoardIndex + i) % boardsToSearch.length
      const nextBoard = boardsToSearch[nextBoardIndex]
      // Check if this board has flashcards (with selected tag if tag is selected)
      const hasFlashcards = projectFlashcards.some(f => f.boardId === nextBoard.id)
      if (hasFlashcards) {
        return nextBoard
      }
    }
    
    return null
  }, [hasFlashcardsInOtherBoards, conversationId, projectBoards, projectFlashcards, selectedTag])
  
  // Find the previous board with flashcards (all boards if tag selected, otherwise project boards)
  const previousBoardWithFlashcards = useMemo(() => {
    if (!hasFlashcardsInOtherBoards || !conversationId) return null
    
    // If tag is selected, get all boards from projectFlashcards (which includes all boards)
    // Otherwise, use projectBoards
    let boardsToSearch: Array<{ id: string; title: string }> = []
    if (selectedTag) {
      // Get unique board IDs from projectFlashcards
      const uniqueBoardIds = [...new Set(projectFlashcards.map(f => f.boardId))]
      boardsToSearch = uniqueBoardIds.map(id => ({ id, title: '' }))
    } else {
      boardsToSearch = projectBoards
    }
    
    if (!boardsToSearch.length) return null
    
    const currentBoardIndex = boardsToSearch.findIndex(b => b.id === conversationId)
    if (currentBoardIndex < 0) return null
    
    // Find previous board that has flashcards (with selected tag if tag is selected)
    for (let i = 1; i < boardsToSearch.length; i++) {
      const previousBoardIndex = currentBoardIndex === 0 
        ? boardsToSearch.length - i 
        : (currentBoardIndex - i + boardsToSearch.length) % boardsToSearch.length
      const previousBoard = boardsToSearch[previousBoardIndex]
      // Check if this board has flashcards (with selected tag if tag is selected)
      const hasFlashcards = projectFlashcards.some(f => f.boardId === previousBoard.id)
      if (hasFlashcards) {
        return previousBoard
      }
    }
    
    return null
  }, [hasFlashcardsInOtherBoards, conversationId, projectBoards, projectFlashcards, selectedTag])

  // Ref to track when navigation is in progress (prevents deselect effect from exiting nav mode)
  const isNavigatingRef = useRef(false)

  // Navigate to previous flashcard (loops to last if at first, or to previous board if available)
  const navigateToPreviousFlashcard = useCallback(() => {
    // Allow navigation even with single flashcard if there are flashcards in other boards
    // If there's only one flashcard in the board, this will just loop to itself (which is fine for the single arrow)
    if ((!hasMultipleFlashcards && !hasFlashcardsInOtherBoards) || !reactFlowInstance || !getSetNodes || currentFlashcardIndex < 0) return
    
    // Mark that we're navigating (prevents deselect effect from exiting nav mode)
    isNavigatingRef.current = true
    
    // Enable flashcard mode to blur non-flashcard content during navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    
    // Loop: if at first flashcard, go to last; otherwise go to previous
    // If there's only one flashcard, this will loop to itself (index 0 -> index 0)
    const previousIndex = currentFlashcardIndex === 0 
      ? flashcardNodes.length - 1 
      : currentFlashcardIndex - 1
    const previousNode = flashcardNodes[previousIndex]
    if (previousNode) {
      const setNodes = getSetNodes()
      if (setNodes) {
        // Get current state of the target node
        const allNodes = reactFlowInstance.getNodes()
        const targetNode = allNodes.find(n => n.id === previousNode.id)
        const isTargetExpanded = !targetNode?.data?.isResponseCollapsed
        
        // If target is expanded, collapse it
        if (isTargetExpanded) {
          setNodes((nds: any[]) =>
            nds.map((n: any) => {
              if (n.id === previousNode.id) {
                return { ...n, data: { ...n.data, isResponseCollapsed: true } }
              }
              return n
            })
          )
        }
        
        // Deselect all nodes and select target
        setNodes((nds: any[]) =>
          nds.map((n: any) => ({ ...n, selected: n.id === previousNode.id }))
        )
        // Scroll to the previous flashcard
        reactFlowInstance.fitView({ nodes: [{ id: previousNode.id }], padding: 0.2, duration: 300 })
        
        // Reset navigation flag after a short delay (allows React to process the selection change)
        setTimeout(() => {
          isNavigatingRef.current = false
        }, 100)
      }
    }
  }, [hasMultipleFlashcards, hasFlashcardsInOtherBoards, flashcardNodes, currentFlashcardIndex, reactFlowInstance, getSetNodes, flashcardMode, setFlashcardMode])

  // Navigate to next flashcard (loops to first if at last, or to next board if available)
  const navigateToNextFlashcard = useCallback(() => {
    // Allow navigation even with single flashcard if there are flashcards in other boards
    // If there's only one flashcard in the board, this will just loop to itself (which is fine for the single arrow)
    if ((!hasMultipleFlashcards && !hasFlashcardsInOtherBoards) || !reactFlowInstance || !getSetNodes || currentFlashcardIndex < 0) return
    
    // Mark that we're navigating (prevents deselect effect from exiting nav mode)
    isNavigatingRef.current = true
    
    // Enable flashcard mode to blur non-flashcard content during navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    
    // Loop: if at last flashcard, go to first; otherwise go to next
    // If there's only one flashcard, this will loop to itself (index 0 -> index 0)
    const nextIndex = currentFlashcardIndex === flashcardNodes.length - 1 
      ? 0 
      : currentFlashcardIndex + 1
    const nextNode = flashcardNodes[nextIndex]
    if (nextNode) {
      const setNodes = getSetNodes()
      if (setNodes) {
        // Get current state of the target node
        const allNodes = reactFlowInstance.getNodes()
        const targetNode = allNodes.find(n => n.id === nextNode.id)
        const isTargetExpanded = !targetNode?.data?.isResponseCollapsed
        
        // If target is expanded, collapse it
        if (isTargetExpanded) {
          setNodes((nds: any[]) =>
            nds.map((n) => {
              if (n.id === nextNode.id) {
                return { ...n, data: { ...n.data, isResponseCollapsed: true } }
              }
              return n
            })
          )
        }
        
        // Deselect all nodes and select target
        setNodes((nds: any[]) =>
          nds.map((n) => ({ ...n, selected: n.id === nextNode.id }))
        )
        // Scroll to the next flashcard
        reactFlowInstance.fitView({ nodes: [{ id: nextNode.id }], padding: 0.2, duration: 300 })
        
        // Reset navigation flag after a short delay (allows React to process the selection change)
        setTimeout(() => {
          isNavigatingRef.current = false
        }, 100)
      }
    }
  }, [hasMultipleFlashcards, hasFlashcardsInOtherBoards, flashcardNodes, currentFlashcardIndex, reactFlowInstance, getSetNodes, flashcardMode, setFlashcardMode])
  
  // Navigate to next board's first flashcard
  const navigateToNextBoard = useCallback(() => {
    if (!nextBoardWithFlashcards) return
    // Enable flashcard mode to blur non-flashcard content during navigation
    // Pass nav mode and selected tag via URL param to maintain it across board navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    // Include selected tag in URL if one is selected
    const tagParam = selectedTag ? `&tag=${selectedTag}` : ''
    router.push(`/board/${nextBoardWithFlashcards.id}?nav=flashcard${tagParam}`)
  }, [nextBoardWithFlashcards, router, flashcardMode, setFlashcardMode, selectedTag])
  
  // Navigate to previous board's last flashcard
  const navigateToPreviousBoard = useCallback(() => {
    if (!previousBoardWithFlashcards) return
    // Enable flashcard mode to blur non-flashcard content during navigation
    // Pass nav mode and selected tag via URL param to maintain it across board navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    // Include selected tag in URL if one is selected
    const tagParam = selectedTag ? `&tag=${selectedTag}` : ''
    router.push(`/board/${previousBoardWithFlashcards.id}?nav=flashcard${tagParam}`)
  }, [previousBoardWithFlashcards, router, flashcardMode, setFlashcardMode, selectedTag])

  // Track previous selected state to detect deselection
  const prevSelectedRef = useRef(selected)
  
  // Track if selection is being restored from map click (to prevent nav mode exit)
  const isRestoringSelectionRef = useRef(false)
  
  // Listen for selection restoration events from board-flow
  useEffect(() => {
    const handleRestoring = () => {
      isRestoringSelectionRef.current = true
    }
    const handleRestored = () => {
      isRestoringSelectionRef.current = false
    }
    
    window.addEventListener('restoring-selection-from-map-click', handleRestoring)
    window.addEventListener('selection-restored-from-map-click', handleRestored)
    
    return () => {
      window.removeEventListener('restoring-selection-from-map-click', handleRestoring)
      window.removeEventListener('selection-restored-from-map-click', handleRestored)
    }
  }, [])
  
  // Exit nav mode when flashcard is deselected (user clicks elsewhere, not during arrow navigation or map click restoration)
  useEffect(() => {
    // Only handle deselection for flashcards when nav mode is active
    if (isFlashcard && flashcardMode !== null) {
      // Check if flashcard was selected and is now deselected
      if (prevSelectedRef.current && !selected) {
        // Skip if we're navigating between flashcards (arrow was clicked) or restoring selection from map click
        if (!isNavigatingRef.current && !isRestoringSelectionRef.current) {
          // User clicked elsewhere to deselect - exit nav mode
          setFlashcardMode(null)
        }
      }
    }
    // Update ref for next render
    prevSelectedRef.current = selected
  }, [selected, isFlashcard, flashcardMode, setFlashcardMode])

  // Frame deselect: prune empty TipTap blocks; sole-empty untitled frames → remove the frame
  const prevSelectedEmptyFrameRef = useRef(selected)
  useEffect(() => {
    const wasSelected = prevSelectedEmptyFrameRef.current
    prevSelectedEmptyFrameRef.current = selected
    if (!wasSelected || selected) return // Only fire on selected → unselected
    if (!isBlock || isFlashcard || isProjectBoard) return
    if (isRestoringSelectionRef.current) return

    const ed = promptEditorRef.current
    // Drop blank Enter lines (and other empty textblocks) while keeping real content / atoms
    if (ed && !ed.isDestroyed) pruneEmptyTextblocks(ed)

    // Sole-empty frame deletion — skip page-body / titled / linked pages
    if (isPageBody) return
    const meta = (promptMessage?.metadata || {}) as Record<string, unknown>
    if (meta.linkedPageId) return
    if (typeof meta.blockTitle === 'string' && meta.blockTitle.trim()) return

    // Must be exactly one empty textblock after prune (not a pageLink-only frame)
    let soleEmpty = false
    if (ed && !ed.isDestroyed) {
      const doc = ed.state.doc
      const only = doc.childCount === 1 ? doc.firstChild : null
      soleEmpty = !!(
        only &&
        only.isTextblock &&
        (only.content.size === 0 || only.textContent.length === 0)
      )
    } else {
      soleEmpty = isBlockContentEmpty(promptContent)
    }
    if (!soleEmpty) return

    // Board-flow owns DB + RF removal (same path as Delete / context menu)
    window.dispatchEvent(
      new CustomEvent('tt-delete-empty-frame', { detail: { nodeId: id } })
    )
  }, [
    selected,
    isBlock,
    isFlashcard,
    isProjectBoard,
    isPageBody,
    promptContent,
    promptMessage?.metadata,
    id,
  ])

  // Get current zoom level and update panel width when zoom is 100% or less
  const [currentZoom, setCurrentZoom] = useState(reactFlowInstance?.getViewport().zoom ?? 1)
  // Block panels grow with the longest TipTap line until manually resized
  const isBlockPanel = isBlockMeta(promptMessage?.metadata)
  const usesFitContent = isBlockPanel // Legacy name: block auto-width (measured px, not CSS fit-content)
  const frameMinW = blockMinFrameWidth(promptContent) // Grip+icon+menu, or grip+3ch for plain text
  const growsWithLine = usesFitContent && !isUserResized && !pagePreviewOpen // Line runs until Enter / corner resize
  const hasBlockContent = isBlock && !isBlockContentEmpty(promptContent) // Lock only when a content block exists
  // Shared size-with-frame scale for selection chrome: resize handles, blue lines, connection
  // indicators, and rotate/lock/wrap. Small frames shrink; large grow ~linear (was √ + 2.25 cap — too timid).
  const FRAME_UI_REF_W = 78 // Natural chrome row width — scale=1 near this / 0.7
  const FRAME_UI_MAX_FIT = 4 // Allow large frames to get substantially bigger chrome
  const frameUiHostW =
    itemBoxSize.width || panelRef.current?.offsetWidth || resizeDimensions?.width || 200
  const rawFrameUiFit = (frameUiHostW * 0.7) / FRAME_UI_REF_W
  const frameUiScale =
    rawFrameUiFit <= 1
      ? Math.max(0.55, rawFrameUiFit) // Floor so tiny frames keep a grabable handle
      : Math.min(FRAME_UI_MAX_FIT, Math.pow(rawFrameUiFit, 0.85)) // Near-linear growth on big frames
  // Rotate/lock/wrap also eases vs board zoom (handles/lines ride the viewport already)
  const frameChromeZoom = 1 / Math.max(1, Math.pow(rfZoom || 1, 0.35))
  const frameChromeScale = frameChromeZoom * frameUiScale
  const frameChromeGapY = INDICATOR_OUTSET * frameUiScale + 8 // Clear scaled bottom connection indicator
  const frameIndicatorSize = 10 * frameUiScale // Matches h-2.5 at scale 1
  const frameHandleSize = 10 * frameUiScale // Corner resize dots
  const frameLineW = Math.max(1, 1.5 * frameUiScale) // Blue selection stroke
  const frameLineHit = Math.max(4, 6 * frameUiScale) // Line hit target thickness
  const wrapActive =
    isBlock && frameTextWrap && isUserResized && !!resizeDimensions && !pagePreviewOpen // Soft-wrap in a fixed width (locked or unlocked)
  const wrapUnlocked = wrapActive && frameUnlocked // Unlocked wrap: fixed width + free/clip height
  const clipUnlocked =
    isBlock &&
    frameUnlocked &&
    !frameTextWrap &&
    isUserResized &&
    !!resizeDimensions &&
    !pagePreviewOpen // Free frame may hide overflow when not wrapping
  const huggedSize = scaledFrameSize(intrinsicSize, frameScale, frameMinW) // Scaled text + border
  const applyFrameScale = isBlock && isUserResized && frameScale !== 1 // Layout spacer + CSS scale
  const scaledLayoutW = Math.ceil(intrinsicSize.width * Math.max(0.15, frameScale)) // Visual content width (no border)
  const scaledLayoutH = Math.ceil(intrinsicSize.height * Math.max(0.15, frameScale)) // Visual content height (no border)
  const unlockedResized = wrapUnlocked || clipUnlocked // Free-resized frame (wrap or nowrap-clip)
  const unlockedInnerW = resizeDimensions ? Math.max(1, resizeDimensions.width - 2) : null // Frame inner (visual)
  const unlockedInnerH = resizeDimensions ? Math.max(1, resizeDimensions.height - 2) : null
  // Unlocked frame smaller than its visual content → blocks are clipped (nowrap: both axes; wrap: height only)
  const overflowRight =
    clipUnlocked && resizeDimensions!.width + 2 < huggedSize.width // Nowrap may hide trailing glyphs
  const overflowBottom =
    (clipUnlocked && resizeDimensions!.height + 2 < huggedSize.height) ||
    (wrapUnlocked && resizeDimensions!.height + 2 < huggedSize.height) // Short frame cuts lower blocks
  const contentOverflows = overflowRight || overflowBottom
  // Hover dwell can arm a preview — hide immediately while dragging / page preview / connecting
  const clipPreviewEligible =
    contentOverflows && isFrameHovering && !dragging && !pagePreviewOpen && !isThreadConnecting
  // After ~500ms hover: temporarily unclip so the full blocks read (saved size unchanged)
  const showClipPreview = clipPreviewEligible && clipPreviewReady
  // Soften chopped edges while clipped (removed during hover preview)
  const clipFadeStyle =
    !showClipPreview && contentOverflows
      ? clipFadeMaskStyle(overflowRight, overflowBottom)
      : undefined
  // Content lays out UNSCALED (÷ frameScale) so the CSS scale() lands exactly on the frame inner box.
  // Applies to wrap AND clip — using w-full here double-scaled the content and clipped the text.
  const wrapContentWidth =
    wrapActive && !frameUnlocked && wrapColWidth != null // LOCKED wrap: FIXED columns — no reflow on proportional resize, stable across unwrap/rewrap
      ? wrapColWidth
      : (unlockedResized || wrapActive) && unlockedInnerW != null // UNLOCKED wrap / clip: derive from current width (re-wrap on drag)
        ? Math.max(1, Math.floor(unlockedInnerW / Math.max(0.15, frameScale)))
        : null
  // Blocks start narrow; chat/flashcards use their fixed starting widths
  const initialWidth = isFlashcard ? 600 : (usesFitContent ? BLOCK_MIN_FRAME_W : 768)
  const [panelWidthToUse, setPanelWidthToUse] = useState(initialWidth)
  // Ref to track current width (avoids stale closures in callbacks)
  const panelWidthRef = useRef(initialWidth)
  // Track maximum width panel has been (so it doesn't grow beyond current width)
  const [maxPanelWidth, setMaxPanelWidth] = useState(isFlashcard ? 600 : (usesFitContent ? 100000 : 768))
  // Track if panel has been manually shrunk (so zoom effect doesn't override it)
  const [isManuallyShrunk, setIsManuallyShrunk] = useState(false)
  // Track if note panel uses fit-content (to prevent zoom-based width updates)
  const noteInitializedRef = useRef(usesFitContent)

  // Continuously check zoom level and update panel width
  useEffect(() => {
    if (!reactFlowInstance) return

    const updateZoomAndWidth = () => {
      const zoom = reactFlowInstance.getViewport().zoom
      setCurrentZoom(zoom)

      const targetMaxWidth = isFlashcard ? 600 : 768

      // Don't override manually shrunk width - only update if not manually shrunk
      if (isManuallyShrunk) {
        return // Keep the manually set width
      }
      
      // Note panels use fit-content and should not be affected by zoom-based width updates
      // Let the content determine their width naturally
      if (noteInitializedRef.current) {
        return // Keep note panel at fit-content width
      }

      // Use dynamic width when:
      // 1. Zoom is 100% or less (<= 1.0)
      // 2. AND panel width (from context) is >= prompt box width (so panels can shrink with prompt box)
      // This allows panels to shrink with prompt box when zoomed out or at 100%
      if (zoom <= 1.0 && panelWidth > 0) {
        // Use the smaller of panelWidth (from prompt box) or targetMaxWidth
        // This ensures panels shrink when prompt box shrinks, but don't exceed targetMaxWidth
        setPanelWidthToUse(Math.min(panelWidth, targetMaxWidth))
      } else {
        setPanelWidthToUse(targetMaxWidth)
      }
    }

    // Initial update
    updateZoomAndWidth()

    // Update periodically to catch zoom changes
    const interval = setInterval(updateZoomAndWidth, 100)

    return () => clearInterval(interval)
  }, [reactFlowInstance, panelWidth, isManuallyShrunk])

  // Track zoom level when nav mode started (to detect zoom out)
  const navModeStartZoomRef = useRef<number | null>(null)
  const [isZoomedOutInNavMode, setIsZoomedOutInNavMode] = useState(false)
  
  // Track zoom changes in nav mode to detect zoom out
  useEffect(() => {
    if (!reactFlowInstance) return
    
    // Reset when nav mode is exited
    if (flashcardMode === null) {
      navModeStartZoomRef.current = null
      setIsZoomedOutInNavMode(false)
      return
    }
    
    // Reset zoom reference when board changes (conversationId changes)
    // This ensures zoom detection is recalculated for the new board
    // Wait a bit for fitView to complete (if called) before starting zoom tracking
    navModeStartZoomRef.current = null
    setIsZoomedOutInNavMode(false)
    
    let intervalId: NodeJS.Timeout | null = null
    
    // Delay before starting zoom tracking to allow fitView to complete
    // fitView duration is 300ms, so wait 400ms to be safe
    const startTrackingTimeout = setTimeout(() => {
      const checkZoomChange = () => {
        const currentZoomLevel = reactFlowInstance.getViewport().zoom
        
        // Store the zoom level when nav mode first started (or when board changed)
        if (navModeStartZoomRef.current === null) {
          navModeStartZoomRef.current = currentZoomLevel
          // Check initial zoom - if less than 200%, unblur non-flashcard content
          if (currentZoomLevel < 2.0) {
            setIsZoomedOutInNavMode(true)
          } else {
            setIsZoomedOutInNavMode(false)
          }
          return
        }
        
        // After board switch, unblur if zoom is less than 200% (2.0)
        // This allows users to see all flashcards when zoomed out
        if (currentZoomLevel < 2.0) {
          // Zoom is less than 200% - show all flashcards but keep non-flashcards blurred
          setIsZoomedOutInNavMode(true)
        } else {
          // Zoom is 200% or more - return to single flashcard focus
          setIsZoomedOutInNavMode(false)
        }
      }
      
      // Check zoom changes periodically
      intervalId = setInterval(checkZoomChange, 200)
    }, 400)
    
    return () => {
      clearTimeout(startTrackingTimeout)
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [reactFlowInstance, flashcardMode, conversationId])

  // Update max width when panel width increases (so it doesn't grow beyond current width)
  useEffect(() => {
    if (panelWidthToUse > maxPanelWidth) {
      setMaxPanelWidth(panelWidthToUse)
    }
    // Keep ref in sync with state
    panelWidthRef.current = panelWidthToUse
  }, [panelWidthToUse, maxPanelWidth])

  // Keep measured width on the DOM after re-renders (chat/flashcards + user-resized blocks)
  useEffect(() => {
    if (pagePreviewOpen) return
    if (growsWithLine) {
      // Unresized blocks: CSS max-content owns size — clear any stale inline px width
      const panel = panelRef.current
      if (panel) {
        if (panel.style.width !== 'max-content') panel.style.width = 'max-content'
        if (panel.style.height !== 'fit-content') panel.style.height = 'fit-content'
      }
      return
    }
    if (isUserResized && resizeDimensions) return // Explicit box owns width
    if (panelRef.current && panelWidthRef.current) {
      const next = `${panelWidthRef.current}px`
      if (panelRef.current.style.width !== next) panelRef.current.style.width = next
    }
  })

  // Horizontal chrome around TipTap text: padding + border + optional ⋮⋮ gutter
  const blockWidthChrome = useCallback(() => {
    // Blocks: pl-0.5 (2) + pr-4 (16) + border (2) + buffer (10) + pl-6 gutter (24)
    // Non-blocks: px-3 (24) + border (2) + buffer (10) + p-1 (8)
    return usesFitContent ? 2 + 16 + 2 + 10 + 24 : 24 + 2 + 10 + 8
  }, [usesFitContent])

  // Measure longest TipTap line as nowrap (Enter = new block, not wrap)
  const measureTextWidthFromContent = useCallback((content: string) => {
    if (!content || !panelRef.current) return null

    const panelElement = panelRef.current
    const proseElement = panelElement.querySelector('.prose') as HTMLElement
    const stylesSource = proseElement || panelElement
    const computedStyle = window.getComputedStyle(stylesSource)

    const tempDiv = document.createElement('div')
    tempDiv.style.position = 'absolute'
    tempDiv.style.visibility = 'hidden'
    tempDiv.style.whiteSpace = 'nowrap' // One visual line
    tempDiv.style.fontSize = computedStyle.fontSize || '16px'
    tempDiv.style.fontFamily = computedStyle.fontFamily || 'inherit'
    tempDiv.style.fontWeight = computedStyle.fontWeight || 'normal'
    tempDiv.style.lineHeight = computedStyle.lineHeight || 'normal'
    tempDiv.style.letterSpacing = computedStyle.letterSpacing || 'normal'
    document.body.appendChild(tempDiv)

    const tempHtml = document.createElement('div')
    tempHtml.innerHTML = content
    // Measure each block separately — concatenated text would over-widen multi-line cards
    const blocks = tempHtml.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')
    let maxTextWidth = 0
    if (blocks.length > 0) {
      blocks.forEach((el) => {
        const line = el.textContent?.replace(/\u00a0/g, ' ') || ''
        if (!line.trim()) return
        tempDiv.textContent = line
        maxTextWidth = Math.max(maxTextWidth, tempDiv.offsetWidth)
      })
    } else {
      const plain = (tempHtml.textContent || '').replace(/\u00a0/g, ' ')
      for (const line of plain.split(/\n/)) {
        if (!line.trim()) continue
        tempDiv.textContent = line
        maxTextWidth = Math.max(maxTextWidth, tempDiv.offsetWidth)
      }
    }
    document.body.removeChild(tempDiv)

    if (maxTextWidth === 0) return null
    const totalWidth = maxTextWidth + blockWidthChrome()
    // Blocks: no wrap cap; chat/flashcards keep maxPanelWidth
    const cap = usesFitContent ? Number.POSITIVE_INFINITY : maxPanelWidth
    return Math.max(200, Math.min(totalWidth, cap))
  }, [maxPanelWidth, usesFitContent, blockWidthChrome])

  // Expand/shrink panel width from longest line — sync DOM before React paint to avoid wrap
  const expandPanelWidth = useCallback((newContent?: string) => {
    if (pagePreviewOpen) return
    // Unresized blocks: max-content + nowrap hug the line — don’t force oversized px widths
    if (growsWithLine) {
      if (panelRef.current) {
        panelRef.current.style.width = 'max-content'
        panelRef.current.style.height = 'fit-content'
      }
      return
    }
    if (isUserResized && resizeDimensions) return // Fixed resized box

    const promptToMeasure = newContent !== undefined ? newContent : promptContent
    const promptWidth = measureTextWidthFromContent(promptToMeasure) || 0
    const responseWidth = measureTextWidthFromContent(responseContent) || 0
    const minWidth = isFlashcard ? 300 : 200
    const measuredTotalWidth = Math.max(promptWidth, responseWidth, minWidth)
    if (!measuredTotalWidth) return

    const currentWidth = panelWidthRef.current
    // Chat panels: only grow; flashcards: grow and shrink with content
    const shouldUpdate = isRegularChatPanel
      ? measuredTotalWidth > currentWidth
      : measuredTotalWidth !== currentWidth
    if (!shouldUpdate) return

    const newWidth = Math.min(measuredTotalWidth, maxPanelWidth)

    if (panelRef.current) {
      panelRef.current.style.width = `${newWidth}px` // Sync before paint
    }
    panelWidthRef.current = newWidth
    setPanelWidthToUse(newWidth)
    setIsManuallyShrunk(true)
  }, [
    measureTextWidthFromContent,
    maxPanelWidth,
    isFlashcard,
    isRegularChatPanel,
    promptContent,
    responseContent,
    isUserResized,
    resizeDimensions,
    pagePreviewOpen,
    growsWithLine,
  ])

  // Shrink block/flashcard to longest line on blur
  const handleEditorBlur = useCallback(() => {
    if (isRegularChatPanel) return // Chat stays wide
    if ((isUserResized && resizeDimensions) || pagePreviewOpen) return

    setTimeout(() => {
      const promptWidth = measureTextWidthFromContent(promptContent) || 0
      const responseWidth = measureTextWidthFromContent(responseContent) || 0
      const minWidth = isFlashcard ? 300 : 200
      const measuredWidth = Math.max(promptWidth, responseWidth, minWidth)
      const currentWidth = panelWidthRef.current
      if (measuredWidth < currentWidth) {
        if (panelRef.current) {
          panelRef.current.style.width = `${measuredWidth}px`
        }
        panelWidthRef.current = measuredWidth
        setPanelWidthToUse(measuredWidth)
        setIsManuallyShrunk(true)
      }
    }, 100)
  }, [
    measureTextWidthFromContent,
    promptContent,
    responseContent,
    isFlashcard,
    isRegularChatPanel,
    isUserResized,
    resizeDimensions,
    pagePreviewOpen,
  ])

  // Sync single text body when underlying messages change (plain-merge prompt + response)
  // Force-sync only when Turn into changes metadata.blockType — not on every keystroke.
  // (All blocks have blockType: 'text'; treating that as “always remote” wiped local typing.)
  const remoteBlockType = promptMessage?.metadata?.blockType as string | undefined
  const prevRemoteBlockTypeRef = useRef(remoteBlockType) // Detect Turn into flips only
  const prevPromptMessageIdRef = useRef(promptMessage?.id) // Reset autofocus only on new message
  useEffect(() => {
    const blockTypeChanged = remoteBlockType !== prevRemoteBlockTypeRef.current
    prevRemoteBlockTypeRef.current = remoteBlockType

    if (isProjectBoard) {
      if (data.boardTitle !== promptContent && !promptHasChanges) {
        setPromptContent(data.boardTitle)
      }
    } else {
      const responseHtml = responseMessage?.content
        ? formatResponseContent(responseMessage.content)
        : ''
      let merged = mergePanelHtml(promptMessage?.content, responseHtml)
      // Legacy: sole databaseBlock → pageLink for pages only (DB frames keep the table NodeView)
      const meta = (promptMessage?.metadata || {}) as Record<string, unknown>
      const linkedId = typeof meta.linkedPageId === 'string' ? meta.linkedPageId : null
      if (linkedId && meta.notionObject !== 'database' && isSoleDatabaseBlockContent(merged)) {
        const iconMeta = meta.notionIcon as { type?: string; emoji?: string } | null
        const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
        merged =
          migrateSoleDatabaseBlockToPageLink(merged, {
            pageId: linkedId,
            title: typeof meta.blockTitle === 'string' ? meta.blockTitle : null,
            icon: emoji,
          }) || merged
      }
      // When this frame has a pending AI edit, always show session display
      // (proposed, or original when eye preview is on) — never clobber with raw server HTML.
      if (promptMessage?.id && isFramePending(promptMessage.id)) {
        const next = displayContentFor(promptMessage.id, merged)
        if (next !== promptContent) setPromptContent(next)
      } else if (promptMessage?.id && justRestoredByMessage[promptMessage.id] !== undefined) {
        // Sticky Save/Remove content — ignore stale cache until it catches up
        const sticky = justRestoredByMessage[promptMessage.id]
        if (sticky !== promptContent) setPromptContent(sticky)
      } else if (
        merged !== promptContent &&
        (!promptHasChanges || blockTypeChanged || wasAiPendingRef.current)
      ) {
        // Accept server content when idle, after Turn into, or right after AI Remove/Save
        setPromptContent(merged)
        if (blockTypeChanged || wasAiPendingRef.current) setPromptHasChanges(false)
      }
    }

    // Autofocus once per new message — not on every content sync (that steals the caret)
    if (promptMessage?.id !== prevPromptMessageIdRef.current) {
      prevPromptMessageIdRef.current = promptMessage?.id
      hasAutoFocusedRef.current = false
    }
  }, [
    isProjectBoard,
    isProjectBoard ? data.boardTitle : promptMessage?.content,
    responseMessage?.content,
    promptContent,
    promptHasChanges,
    promptMessage?.id,
    promptMessage?.metadata?.linkedPageId,
    promptMessage?.metadata?.notionObject,
    promptMessage?.metadata?.blockTitle,
    remoteBlockType,
    isFramePending,
    displayContentFor,
    previewOriginal,
    justRestoredByMessage,
  ])

  // Keep responseContent mirror for width-measurement helpers that still read it
  useEffect(() => {
    if (responseMessage && responseMessage.content) {
      const formattedContent = formatResponseContent(responseMessage.content)
      if (formattedContent !== responseContent && !responseHasChanges) {
        setResponseContent(formattedContent)
        setTimeout(() => {
          expandPanelWidth() // Grow for longest line (blocks + chat/flashcards)
        }, 100)
      }
    } else if (!responseMessage) {
      setResponseContent('')
    }
  }, [responseMessage?.id, responseMessage?.content, responseContent, responseHasChanges, expandPanelWidth])

  // Initial width fit on mount — blocks + flashcards measure longest line; chat stays max width
  useEffect(() => {
    if (isRegularChatPanel) {
      setIsInitialShrinkComplete(true)
      return
    }
    if ((isUserResized && resizeDimensions) || pagePreviewOpen) {
      setIsInitialShrinkComplete(true)
      return
    }
    // Map I-bar / grip-created frames must stay visible — the 300ms opacity:0 hid typed text
    if (promptMessage?.metadata?.fadeIn === true) {
      hasInitialShrunkRef.current = promptMessage?.id || id
      setIsInitialShrinkComplete(true)
      return
    }

    const panelId = promptMessage?.id || id
    if (hasInitialShrunkRef.current === panelId) {
      setIsInitialShrinkComplete(true)
      return
    }

    const timeoutId = setTimeout(() => {
      if (!panelRef.current) {
        setIsInitialShrinkComplete(true)
        return
      }
      const promptWidth = measureTextWidthFromContent(promptContent) || 0
      const responseWidth = measureTextWidthFromContent(responseContent) || 0
      const minWidth = isFlashcard ? 300 : 200
      const measuredWidth = Math.max(promptWidth, responseWidth, minWidth)
      const targetWidth = (!promptContent && !responseContent) ? minWidth : measuredWidth
      if (panelRef.current) {
        panelRef.current.style.width = `${targetWidth}px`
      }
      panelWidthRef.current = targetWidth
      setPanelWidthToUse(targetWidth)
      setIsManuallyShrunk(true)
      hasInitialShrunkRef.current = panelId
      setIsInitialShrinkComplete(true)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [
    promptContent,
    responseContent,
    measureTextWidthFromContent,
    isFlashcard,
    isRegularChatPanel,
    promptMessage?.id,
    promptMessage?.metadata?.fadeIn,
    id,
    isUserResized,
    resizeDimensions,
    pagePreviewOpen,
  ])

  // Debounced width adjust when content changes (blocks grow/shrink with longest line)
  useEffect(() => {
    if ((isUserResized && resizeDimensions) || pagePreviewOpen) return
    if (!promptContent && !responseContent) return
    if (isRegularChatPanel && !promptContent && !responseContent) return

    const timeoutId = setTimeout(() => {
      expandPanelWidth()
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [
    promptContent,
    responseContent,
    expandPanelWidth,
    isRegularChatPanel,
    isUserResized,
    resizeDimensions,
    pagePreviewOpen,
  ])

  const handlePromptChange = async (newContent: string) => {
    // Expand panel width FIRST (before content update) to prevent wrapping
    // Wrapping should not happen if panel is not at max width
    expandPanelWidth(newContent)
    
    setPromptContent(newContent)

    if (isProjectBoard) {
      // For project boards, update board title
      const { error } = await supabase
        .from('conversations')
        .update({ title: newContent })
        .eq('id', data.boardId)

      if (error) {
        console.error('Error updating board title:', error)
      } else {
        // Invalidate project boards query to refresh
        queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
      }
    } else {
      // For regular panels, update message in database
      if (promptMessage) {
        // While an AI proposal is pending, keep DB at the original so eye/remove stay correct
        if (isFramePending(promptMessage.id)) {
          return
        }
        const { error } = await supabase
          .from('messages')
          .update({ content: newContent })
          .eq('id', promptMessage.id)

        if (error) {
          console.error('Error updating prompt:', error)
        }
      }
    }
  }

  const handlePromptRevert = async () => {
    // Revert to original content
    if (isProjectBoard) {
      setPromptContent(data.boardTitle)
      setPromptHasChanges(false)

      const { error } = await supabase
        .from('conversations')
        .update({ title: data.boardTitle })
        .eq('id', data.boardId)

      if (error) {
        console.error('Error reverting board title:', error)
      } else {
        queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
      }
    } else {
      if (promptMessage) {
        setPromptContent(promptMessage.content)
        setPromptHasChanges(false)

        const { error } = await supabase
          .from('messages')
          .update({ content: promptMessage.content })
          .eq('id', promptMessage.id)

        if (error) {
          console.error('Error reverting prompt:', error)
        }
      }
    }
  }

  const handleResponseChange = async (newContent: string) => {
    if (isProjectBoard || !responseMessage) return // Project boards: read-only

    // Expand panel width FIRST (before content update) to prevent wrapping
    // Wrapping should not happen if panel is not at max width
    expandPanelWidth(newContent)
    
    setResponseContent(newContent)
    // Update message in database
    const { error } = await supabase
      .from('messages')
      .update({ content: newContent })
      .eq('id', responseMessage.id)

    if (error) {
      console.error('Error updating response:', error)
    }
  }

  const handleResponseRevert = async () => {
    if (isProjectBoard || !responseMessage) return // Project boards: read-only

    // Revert to original content
    setResponseContent(responseMessage.content)
    setResponseHasChanges(false)

    // Update in database
    const { error } = await supabase
      .from('messages')
      .update({ content: responseMessage.content })
      .eq('id', responseMessage.id)

    if (error) {
      console.error('Error reverting response:', error)
    }
  }

  const handleDeletePanel = async () => {
    if (isDeleting) return

    setIsDeleting(true)
    try {
      if (isProjectBoard) {
        // For project boards, remove board from project (set project_id to null)
        const { data: conversation } = await supabase
          .from('conversations')
          .select('metadata')
          .eq('id', data.boardId)
          .single()

        if (conversation?.metadata) {
          const { project_id: _, ...updatedMetadata } = conversation.metadata as Record<string, any>
          const finalMetadata = Object.keys(updatedMetadata).length > 0 ? updatedMetadata : {}

          const { error } = await supabase
            .from('conversations')
            .update({ metadata: finalMetadata })
            .eq('id', data.boardId)

          if (error) {
            throw new Error(error.message || 'Failed to remove board from project')
          }

          // Invalidate project boards query
          await queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
        }
      } else {
        // For regular panels, delete messages — and linked page if this item was titled
        if (!promptMessage) return

        const messageIds = [promptMessage.id]
        if (responseMessage) {
          messageIds.push(responseMessage.id)
        }

        // Keep Pages menu in sync: deleting a titled item removes its page map
        try {
          await deleteLinkedPageForBlock(supabase, promptMessage.metadata as Record<string, unknown>)
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        } catch (linkErr) {
          console.error('Failed to delete linked page for item:', linkErr)
        }

        const { error } = await supabase
          .from('messages')
          .delete()
          .in('id', messageIds)

        if (error) {
          throw new Error(error.message || 'Failed to delete panel')
        }

        // Invalidate queries to refresh the board
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })

        // Trigger refetch
        setTimeout(() => {
          queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
        }, 200)
      }
    } catch (error: any) {
      console.error('Failed to delete panel:', error)
      alert(error.message || 'Failed to delete panel. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // Determine if this is a component panel (empty prompt content OR a note) - check once at top level
  // Component panels should only show white editable area, no grey area, no loading spinner
  // UNLESS it's a flashcard - flashcards show grey area even if empty content
  // Notes are always component panels (simple note nodes)
  const promptContentValue = promptMessage?.content || ''
  const isComponentPanel = isBlock || promptContentValue.trim().length === 0
  // const isFlashcard = promptMessage?.metadata?.isFlashcard === true // Already defined at top
  // Show grey area if: has content OR is a flashcard (even if empty) OR has response message (to show nested on response load, even if content is empty during streaming)
  // Notes never show grey area (they're simple note nodes)
  const shouldShowGreyArea = !isBlock && (promptContentValue.trim().length > 0 || isFlashcard || !!responseMessage)
  // Calculate loading state: response is loading when responseMessage doesn't exist or has no content yet
  // Notes never show loading state (they don't have responses)
  const isLoading = !isBlock && (!responseMessage || (responseMessage && !responseMessage.content))
  
  // Measure panel's content aspect ratio for note panels (needed for proper height calculation during resize)
  // This captures the natural aspect ratio of the panel content (text + padding) when first rendered
  useEffect(() => {
    if (isBlock && panelRef.current && isInitialShrinkComplete && !resizeDimensions) {
      // Wait a bit for the panel to fully render and settle
      const timeoutId = setTimeout(() => {
        const panelElement = panelRef.current
        if (!panelElement) return
        
        // Measure the panel's current dimensions (this represents the natural aspect ratio of the content)
        const panelWidth = panelElement.offsetWidth
        const panelHeight = panelElement.offsetHeight
        
        if (panelWidth > 0 && panelHeight > 0 && initialTextAspectRatioRef.current === null) {
          // Calculate panel's natural aspect ratio (width/height)
          // This includes the text content plus all padding
          initialTextAspectRatioRef.current = panelWidth / panelHeight
        }
      }, 100) // Small delay to ensure panel is fully rendered
      
      return () => clearTimeout(timeoutId)
    }
  }, [isBlock, isInitialShrinkComplete, promptContent, resizeDimensions])

  // Auto-focus note editor when first created (empty component panel or inline note with fadeIn flag)
  // Map I-bar typing seeds arrive via tt-ibar-typed-seed so keystrokes aren't dropped while the frame spawns
  useEffect(() => {
    if (!isComponentPanel || isFlashcard) return

    const applySeed = (html: string, text: string) => {
      const ed = promptEditorRef.current
      if (!ed || ed.isDestroyed) return false
      const current = ed.getText()
      // Only replace when seed is ahead — avoid setContent flicker when already in sync
      if (text.length > current.length || (text.length === current.length && text !== current)) {
        ed.commands.setContent(html || '<p></p>')
        ed.commands.focus('end')
        setPromptContent(html || '<p></p>')
        setPromptHasChanges(true) // Persist the buffered typing; block remote wipe
        hasAutoFocusedRef.current = true
        return true
      }
      if (!ed.isFocused) ed.commands.focus('end')
      hasAutoFocusedRef.current = true
      setPromptHasChanges(true)
      return true
    }

    const onSeed = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; text?: string; html?: string }>).detail
      if (!detail?.messageId || detail.messageId !== promptMessage?.id) return
      const ok = applySeed(detail.html || '<p></p>', detail.text || '')
      const ed = promptEditorRef.current
      // Only release map capture once TipTap actually has focus (otherwise more keys would drop)
      if (ok && ed && !ed.isDestroyed && ed.isFocused) {
        window.dispatchEvent(
          new CustomEvent('tt-ibar-seed-applied', { detail: { messageId: detail.messageId } })
        )
      }
    }

    window.addEventListener('tt-ibar-typed-seed', onSeed)

    // Normal fadeIn autofocus (grip-click empty frame, or seed already in message content)
    if (promptEditorRef.current && !hasAutoFocusedRef.current) {
      const isEmpty =
        !promptContent ||
        promptContent === '' ||
        promptContent === '<p></p>' ||
        promptContent === '<p><br></p>'
      const isNewInlineNote = promptMessage?.metadata?.fadeIn === true
      if (isEmpty || isNewInlineNote) {
        const t = window.setTimeout(() => {
          if (!promptEditorRef.current || promptEditorRef.current.isDestroyed) return
          promptEditorRef.current.commands.focus('end')
          hasAutoFocusedRef.current = true
          // If a seed is still in flight, ask board-flow to re-push it
          if (promptMessage?.id) {
            window.dispatchEvent(
              new CustomEvent('tt-ibar-request-seed', { detail: { messageId: promptMessage.id } })
            )
          }
        }, 0) // Immediate — was 100ms and felt like a typing gap
        return () => {
          window.clearTimeout(t)
          window.removeEventListener('tt-ibar-typed-seed', onSeed)
        }
      }
    }

    return () => window.removeEventListener('tt-ibar-typed-seed', onSeed)
  }, [
    isComponentPanel,
    isFlashcard,
    promptContent,
    promptMessage?.id,
    promptMessage?.metadata?.fadeIn,
  ])

  // Debug logging for flashcard conversion
  if (isComponentPanel && promptMessage?.id) {
    console.log('🔍 Component panel check:', {
      panelId: id,
      messageId: promptMessage.id,
      hasContent: promptContentValue.trim().length > 0,
      isFlashcard,
      metadata: promptMessage.metadata,
      shouldShowGreyArea
    })
  }

  // Determine if this panel should be blurred based on nav mode state
  // - Normal nav mode: only the focused/selected flashcard visible, everything else blurred
  // - Zoomed out nav mode: selected flashcard visible, other flashcards blurred, non-flashcards unblurred
  const shouldBlur = flashcardMode !== null && (
    isZoomedOutInNavMode 
      ? (isFlashcard && !selected)  // Zoomed out: blur non-selected flashcards, unblur everything else including selected flashcard
      : !(isFlashcard && selected)  // Normal: only unblur selected flashcard
  )

  // Comments should blur the same as non-flashcard map content:
  // - Blur during nav mode when not zoomed out
  // - Don't blur when zoomed out in nav mode
  // - Even focused flashcard comments should blur
  const shouldBlurComments = flashcardMode !== null && !isZoomedOutInNavMode

  // Corner resize dots — size tracks frameUiScale (small frame → smaller dots, big → larger)
  const itemCornerResizeStyle = {
    width: frameHandleSize,
    height: frameHandleSize,
    background: resolvedTheme === 'dark' ? '#1a1a1a' : '#ffffff', // Contrast against board
    border: `${Math.max(1, 1.5 * frameUiScale)}px solid #9ca3af`, // Ring scales with the dot
    borderRadius: '50%', // Circular corner handles
    boxSizing: 'border-box' as const, // Include border in box size
    zIndex: 60, // Above title chip / connection dots so drag hits resize, not node drag
  }

  // Dwell before revealing clipped blocks — leave / drag cancels immediately
  useEffect(() => {
    if (!clipPreviewEligible) {
      setClipPreviewReady(false) // Snap closed the moment hover ends
      return
    }
    const t = window.setTimeout(() => setClipPreviewReady(true), 500) // ~tooltip dwell
    return () => window.clearTimeout(t)
  }, [clipPreviewEligible])

  // Hover clip-preview: lift this RF node above siblings so spilled blocks paint on top
  useEffect(() => {
    const rfNode = panelRef.current?.closest('.react-flow__node') as HTMLElement | null
    if (!rfNode) return
    if (!showClipPreview) return
    const prev = rfNode.style.zIndex
    rfNode.style.zIndex = '1000' // Above neighboring frames while the full content peeks out
    return () => {
      rfNode.style.zIndex = prev
    }
  }, [showClipPreview])

  // AI pending edits: show proposed (or original when eye preview is on); restore on Remove/Save
  useEffect(() => {
    if (isProjectBoard || !promptMessage?.id) {
      wasAiPendingRef.current = false
      return
    }
    const mid = promptMessage.id
    const pending = isFramePending(mid)
    if (pending) {
      const next = displayContentFor(mid, promptMessage.content || '')
      setPromptContent(next)
      setPromptHasChanges(false)
      wasAiPendingRef.current = true
      setAiForceSyncKey((k) => k + 1) // Sync TipTap even if caret is in the frame
      return
    }
    // Prefer session original/final from Remove/Save — query cache may still be stale
    const restored = justRestoredByMessage[mid]
    if (restored !== undefined) {
      if (promptContent !== restored) {
        setPromptContent(restored)
        setPromptHasChanges(false)
        setAiForceSyncKey((k) => k + 1)
      }
      wasAiPendingRef.current = false
      // Hold sticky until optimistic/refetch content matches (prevents Save → revert race)
      if ((promptMessage.content || '') === restored) {
        consumeRestoredContent(mid)
      }
      return
    }
    // Pending just cleared without restore map — fall back to message content
    if (wasAiPendingRef.current) {
      const responseHtml = responseMessage?.content
        ? formatResponseContent(responseMessage.content)
        : ''
      const merged = mergePanelHtml(promptMessage.content, responseHtml)
      setPromptContent(merged)
      setPromptHasChanges(false)
      wasAiPendingRef.current = false
      setAiForceSyncKey((k) => k + 1)
    }
  }, [
    isProjectBoard,
    promptMessage?.id,
    promptMessage?.content,
    responseMessage?.content,
    previewOriginal,
    isFramePending,
    displayContentFor,
    justRestoredByMessage,
    consumeRestoredContent,
  ])

  // Map-card frame is a container (like a Notion page) — ⋮⋮ lives on TipTap content blocks inside
  // Logical (unrotated) content box — never use outer AABB measure when rotated
  const contentBoxW =
    (isUserResized && resizeDimensions?.width) ||
    (Math.abs(rotation) > 0.5
      ? Math.max(intrinsicSize.width + 8, BLOCK_MIN_FRAME_W) // +pad; outer RO is AABB — don't use it
      : itemBoxSize.width) ||
    FRAME_SHAPE_DEFAULT_SIZE.width
  const contentBoxH =
    (isUserResized && resizeDimensions?.height) ||
    (Math.abs(rotation) > 0.5
      ? Math.max(intrinsicSize.height + 8, BLOCK_MIN_FRAME_H)
      : itemBoxSize.height) ||
    FRAME_SHAPE_DEFAULT_SIZE.height
  const isContentRotated = isBlock && Math.abs(rotation) > 0.5
  // Upright blue adjust frame = AABB of rotated content (snap / resize chrome)
  const displayBox = isContentRotated
    ? rotatedAabbSize(contentBoxW, contentBoxH, rotation)
    : { width: contentBoxW, height: contentBoxH }
  const shapeBoxW = contentBoxW
  const shapeBoxH = contentBoxH
  const shapeClip = frameShape ? frameShapeClipCss(frameShape) : undefined
  const shapeStroke =
    data.borderColor && data.borderColor !== ''
      ? data.borderColor
      : resolvedTheme === 'dark'
        ? '#9ca3af'
        : '#6b7280'
  const shapeFill =
    data.fillColor && data.fillColor !== ''
      ? data.fillColor
      : 'transparent'
  const shapeStrokeW = Math.max(1, parseFloat(String(data.borderWeight || '2')) || 2)

  return (
    <div
        ref={panelRef}
        data-panel-container="true" // Data attribute to help find panel container for comment popup
        data-block-node={isBlock ? 'true' : undefined} // Marks blocks for selected connection-dot styling
        data-block-resized={wrapActive ? 'wrap' : undefined} // Wrap (locked/unlocked): soft-wrap in fixed width; else nowrap / clip
        data-clip-preview={showClipPreview ? 'true' : undefined} // Unlocked hover: full-content peek
        data-frame-shape={frameShape || undefined} // Silhouette id when frames act as shapes
        data-ai-pending-frame={
          !isProjectBoard && promptMessage?.id && isFramePending(promptMessage.id) ? 'true' : undefined
        }
        className={cn(
          'group border relative cursor-grab active:cursor-grabbing overflow-visible transition-[opacity,box-shadow,background-color,border-color] duration-300', // Chrome sits outside; clip only inner body
          // When rotated, fill lives on the inner shell only (avoids upright+rotated double shape)
          !frameShape && !isContentRotated && 'rounded-2xl',
          !isFillTransparent && !frameShape && !isContentRotated && 'backdrop-blur-sm',
          // Always show blue border when selected, otherwise use custom border color or default theme-based color
          // Selection uses the connected resize rectangle (not a rounded card border)
          selected && isBlock
            ? (data.borderColor ? '' : 'border-transparent') // Selection chrome is the resize rect, not the frame border
            : selected
              ? 'border-blue-500 dark:border-blue-400'
              : (data.borderColor || frameShape ? '' : 'border-transparent'), // Default frame: no visible border until styled
          isBookmarked
            ? 'shadow-[0_0_8px_rgba(250,204,21,0.6)] dark:shadow-[0_0_8px_rgba(250,204,21,0.4)]'
            : isBorderNone || frameShape || isContentRotated
              ? 'shadow-none' // Transparent / none border / silhouette / rotated — no card shadow on outer
              : showClipPreview
                ? 'shadow-md' // Soft lift while full clipped content is revealed
                : 'shadow-sm',
          // Blur non-flashcard panels when flashcard study mode is active
          shouldBlur && 'blur-sm opacity-40 pointer-events-none',
          !isProjectBoard &&
            promptMessage?.id &&
            isFramePending(promptMessage.id) &&
            'tt-ai-pending-frame'
        )}
      style={{
        // Rotated: outer = AABB so blue adjust box covers content; unrotated: hug / resize as before
        width: pagePreviewOpen
          ? '520px'
          : isContentRotated
            ? `${displayBox.width}px`
            : isUserResized && resizeDimensions
              ? `${resizeDimensions.width}px`
              : growsWithLine
                ? 'max-content'
                : `${panelWidthToUse}px`,
        height: pagePreviewOpen
          ? '420px'
          : isContentRotated
            ? `${displayBox.height}px`
            : isUserResized && resizeDimensions
              ? `${resizeDimensions.height}px`
              : growsWithLine
                ? 'fit-content'
                : undefined,
        minWidth: pagePreviewOpen
          ? '520px'
          : usesFitContent && !isContentRotated
            ? `${frameMinW}px`
              : isFlashcard
                ? '300px'
                : '200px',
        minHeight: pagePreviewOpen ? '420px' : '0px',
        maxWidth: undefined,
        opacity: isInitialShrinkComplete ? 1 : 0,
        // Rotated: outer is transparent shell (fill on inner) — kills upright ghost under rotated card
        backgroundColor:
          frameShape || isContentRotated ? 'transparent' : panelBackgroundColor,
        borderColor: selected
          ? undefined
          : frameShape || isBorderColorTransparent || isContentRotated
            ? 'transparent'
            : data.borderColor,
        borderStyle: selected
          ? 'solid'
          : frameShape || isBorderNone || isContentRotated
            ? 'none'
            : ((data.borderStyle as React.CSSProperties['borderStyle']) || undefined),
        borderWidth: selected
          ? (data.borderWeight || '1px')
          : frameShape || isBorderNone || isContentRotated
            ? 0
            : (data.borderWeight || undefined),
        ['--tt-frame-ui-scale' as string]: frameUiScale,
        ['--tt-frame-line-w' as string]: `${frameLineW}px`,
        ['--tt-frame-line-hit' as string]: `${frameLineHit}px`,
        ['--tt-frame-handle' as string]: `${frameHandleSize}px`,
        ['--tt-frame-handle-border' as string]: `${Math.max(1, 1.5 * frameUiScale)}px`,
      }}
      onPointerDownCapture={(e) => {
        const t = e.target as HTMLElement | null
        // Resize / rotate chrome / grips must stay mounted — `pressing` would unmount them mid-gesture
        const onFrameChrome = !!t?.closest?.(
          '.react-flow__resize-control, [data-frame-chrome], [data-tt-block-handle], [data-tt-insert-line], .block-actions-menu'
        )
        if (!onFrameChrome) {
          // Hide selection chrome until mouseup — gesture may become a drag (blue box only)
          setPressing(true)
          const clearPress = () => setPressing(false)
          window.addEventListener('pointerup', clearPress, { once: true })
          window.addEventListener('pointercancel', clearPress, { once: true })
        }
        // RF snapshots dragItems before onNodeDragStart — a selected wrapper rides along with this frame.
        const store = rfStoreApi.getState() as {
          unselectNodesAndEdges?: (p: { nodes: unknown[]; edges: unknown[] }) => void
          nodeInternals?: Map<string, { type?: string; selected?: boolean; draggable?: boolean }>
        }
        const groups = getNodes().filter((n) => n.type === 'blockGroup')
        if (groups.length > 0) store.unselectNodesAndEdges?.({ nodes: groups, edges: [] })
        store.nodeInternals?.forEach((internal) => {
          if (internal.type !== 'blockGroup') return
          internal.selected = false
          internal.draggable = false
        })
        if (groups.some((g) => g.selected || g.draggable !== false)) {
          setNodes((nds) =>
            nds.map((n) =>
              n.type === 'blockGroup' ? { ...n, selected: false, draggable: false } : n
            )
          )
        }
      }}
      onMouseEnter={() => setIsFrameHovering(true)} // Page-open menu + keep chrome hover bridge
      onMouseLeave={(e) => {
        const related = e.relatedTarget as HTMLElement | null
        if (related?.closest?.('[data-frame-chrome]')) return // Moving onto overflow caret / selected chrome
        setIsFrameHovering(false)
      }}
      onClick={(e) => {
        // Click rainbow pending span → focus that edit in the review bar
        const pendingSpan = (e.target as HTMLElement | null)?.closest?.(
          '[data-ai-pending="true"]'
        )
        if (pendingSpan && promptMessage?.id) {
          const edit = pendingForMessage(promptMessage.id)
          if (edit) setFocusedEditId(edit.id)
        }
      }}
      onDoubleClick={(e) => {
        // Double-click anywhere on panel focuses the single text editor
        const target = e.target as HTMLElement
        if (target.closest('button, a, [contenteditable="true"], input, textarea, select')) {
          return
        }
        e.stopPropagation()
        const editorToFocus = promptEditorRef.current
        if (editorToFocus && !editorToFocus.isDestroyed) {
          setTimeout(() => {
            editorToFocus.commands.focus()
            const docSize = editorToFocus.state.doc.content.size
            if (docSize > 1) {
              editorToFocus.commands.setTextSelection(docSize - 1)
            }
          }, 0)
        }
      }}
    >
      {/* Frame silhouette + body: one rotated shell (no double fill). Outer AABB stays upright. */}
      {isBlock && frameShape && !pagePreviewOpen && !isContentRotated && (
        <FrameShapeBackdrop
          type={frameShape}
          width={shapeBoxW}
          height={shapeBoxH}
          fill={shapeFill}
          fillOpacity={0.2}
          stroke={shapeStroke}
          strokeWidth={shapeStrokeW}
        />
      )}

      {/* Drag move: blue box only (no resize corners / indicators / chrome) — not a real selection */}
      {showDragBorderOnly && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 z-[20]',
            !frameShape && 'rounded-2xl'
          )}
          style={{
            boxShadow: `inset 0 0 0 ${frameLineW}px #3b82f6`, // Same blue as selection chrome, no hit target
            // Upright AABB outline — don't clip to rotated silhouette
            clipPath: !isContentRotated ? shapeClip : undefined,
          }}
        />
      )}

      {/* Selected frames: connected blue rectangle + circular corner handles (hidden while moving / thread drag) */}
      {showAdjustFrame && (
        <>
          {(['top', 'right', 'bottom', 'left'] as const).map((position) => (
            <NodeResizeControl
              key={`line-${position}`} // Side line that joins the four corners
              position={position}
              variant="line" // RF line control (rectangle edges that meet the corner dots)
              className="nodrag nopan tt-frame-resize-line" // nodrag: resize must not start frame drag
              minWidth={frameMinW}
              minHeight={BLOCK_MIN_FRAME_H}
              keepAspectRatio={!frameUnlocked && hasBlockContent}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
              onResizeEnd={handleResizeEnd}
            />
          ))}
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((position) => (
            <NodeResizeControl
              key={position} // One control per corner
              position={position} // RF places the handle on that corner
              className="nodrag nopan" // Resize only — never start RF frame drag / pan
              style={itemCornerResizeStyle} // White circular handle styling
              minWidth={frameMinW} // pageLink vs plain-text floor
              minHeight={BLOCK_MIN_FRAME_H} // Keep a usable box; pairs with handleResize clamp
              keepAspectRatio={!frameUnlocked && hasBlockContent} // Locked + content: proportional only
              onResizeStart={handleResizeStart} // Arm user-resize mode (line-grow off)
              onResize={handleResize} // Apply explicit width/height while dragging
              onResizeEnd={handleResizeEnd} // Persist resizeDimensions
            />
          ))}
        </>
      )}

      {/* Stacked mates: line on each gap (not only the outermost host) */}
      {showStackGapLine && stackGroupId && stackSide && !dragging && (
        <FrameStackRevealLine
          nodeId={id}
          stackGroupId={stackGroupId}
          stackSide={stackSide}
          frameUiScale={frameUiScale}
        />
      )}

      {/* Connection indicators — DOM only (not RF Handles); arm the edge connection point */}
      {showIndicators && (
        <>
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <ConnectionIndicator
              key={`indicator-${side}`}
              side={side}
              className={cn(
                'nodrag nopan absolute z-[30] rounded-full border border-white bg-blue-500 shadow-sm',
                isThreadConnecting
                  ? 'pointer-events-none' // Visual snap target only — don't steal hit from edge Handles
                  : 'cursor-crosshair hover:bg-blue-600'
              )}
              style={{
                ...connectionIndicatorStyle(side, frameUiScale), // Outset scales with frame
                width: frameIndicatorSize, // Dot grows/shrinks with frame size
                height: frameIndicatorSize,
              }}
            />
          ))}
        </>
      )}

      {/* Frame chrome — rotate · lock · wrap (selected + idle only; hidden while dragging) */}
      {isBlock && !pagePreviewOpen && !isThreadConnecting && selected && !dragging && (
          <div
            data-frame-chrome
            className="nodrag nopan absolute z-[25] flex items-center gap-0.5" // Below connection indicators (z-30)
            style={(() => {
              // Outer node is always upright — pin chrome under the blue box bottom-left
              return {
                left: 0,
                top: '100%',
                marginLeft: `${-8 * frameChromeScale}px`,
                marginTop: `${frameChromeGapY * frameChromeScale}px`,
                transform: `scale(${frameChromeScale})`,
                transformOrigin: 'top left' as const,
              }
            })()}
            onMouseEnter={() => setIsFrameHovering(true)} // Keep hover while on chrome
            onMouseLeave={(e) => {
              const related = e.relatedTarget as HTMLElement | null
              if (related?.closest?.('[data-panel-container="true"]') === panelRef.current) return
              setIsFrameHovering(false)
            }}
            onMouseDown={(e) => e.stopPropagation()} // Don't start node drag
          >
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              style={{ cursor: 'grab' }}
              title="Rotate"
              aria-label="Rotate item"
              onPointerDown={handleRotatePointerDown}
              onPointerMove={handleRotatePointerMove}
              onPointerUp={handleRotatePointerUp}
              onPointerCancel={handleRotatePointerUp}
              onClick={(e) => e.stopPropagation()}
            >
              <RotateCw className="h-4 w-4 pointer-events-none" />
            </button>
            {hasBlockContent && (
              <button
                type="button"
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
                  !frameUnlocked && 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-50' // Active when fitted to text
                )}
                title={frameUnlocked ? 'Fit to text' : 'Free resize (keep size)'}
                aria-label={frameUnlocked ? 'Fit to text' : 'Free resize'}
                aria-pressed={!frameUnlocked}
                onClick={handleToggleFrameLock}
              >
                <ScanText className="h-4 w-4 pointer-events-none" />
              </button>
            )}
            {hasBlockContent && (
              <button
                type="button"
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
                  frameTextWrap && 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-50' // Active wrap state
                )}
                title={frameTextWrap ? 'Unwrap text (clip overflow)' : 'Wrap text in frame'}
                aria-label={frameTextWrap ? 'Unwrap text' : 'Wrap text'}
                aria-pressed={frameTextWrap}
                onClick={handleToggleFrameTextWrap}
              >
                <WrapText className="h-4 w-4 pointer-events-none" />
              </button>
            )}
          </div>
      )}

      {/* Page titles/links now render inline as pageLink blocks inside the editor (no edge chip). */}
      
      {/* Left handle with flashcard navigation */}
      {isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) && previousBoardWithFlashcards && isAtFirstFlashcardInBoard && selected ? (
        // Expanded pill with two buttons when cross-board navigation is available and flashcard is selected
        <div
          className={cn(
            'absolute left-0 top-1/2 z-20 flex items-center justify-center -translate-x-1/2 -translate-y-1/2'
          )}
          style={{ 
            width: '24px', 
            height: '48px',
            transition: 'height 300ms ease-in-out'
          }}
        >
          <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-0.5 flex flex-col gap-0.5 h-12 w-6 items-center justify-center transition-all duration-300 ease-in-out">
            {/* Single arrow button - cycles through current board */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToPreviousFlashcard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-all duration-300"
              title="Previous flashcard in this board"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
            {/* Double arrow button - navigates to previous board (only when selected) */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToPreviousBoard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center animate-fade-in"
              title="Previous board"
            >
              <ChevronsLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      ) : isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) ? (
        <div
          className={cn(
            'absolute left-0 top-1/2 z-20 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer'
          )}
          style={{ 
            width: '24px', 
            height: '24px',
            transition: 'height 300ms ease-in-out'
          }}
          onClick={(e) => {
            e.stopPropagation()
            navigateToPreviousFlashcard()
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id="left"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default',
              'handle-dot-flashcard-large'
            )}
            style={{
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-30">
            <ChevronLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
          </div>
        </div>
      ) : !isFlashcard ? (
        <>
          {/* Connection points — always mounted on frames (even unselected/minimal) so settled
              threads have Handle geometry to attach to; visibility is CSS-only. */}
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
            const position =
              side === 'left'
                ? Position.Left
                : side === 'right'
                  ? Position.Right
                  : side === 'top'
                    ? Position.Top
                    : Position.Bottom
            return (
              <Fragment key={`cp-${side}`}>
                <Handle
                  type="target"
                  position={position}
                  id={side}
                  isConnectable
                  isConnectableStart={false}
                  isConnectableEnd
                  className="handle-dot tt-connection-point"
                  style={connectionPointStyle()}
                />
                <Handle
                  type="source"
                  position={position}
                  id={side}
                  isConnectable
                  isConnectableStart={false} // Drag starts from ConnectionIndicator (DOM), not this Handle
                  isConnectableEnd
                  className="handle-dot tt-connection-point"
                  style={connectionPointStyle()}
                />
              </Fragment>
            )
          })}
        </>
      ) : null}

      {/* Top and bottom handles for flashcards - regular handles (not arrow handles) */}
      {/* These are always shown for flashcards, regardless of navigation arrows */}
      {isFlashcard && !shouldHideHandles && (
        <>
          {/* Top handle for flashcards - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Top handle for flashcards - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle for flashcards - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle for flashcards - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
        </>
      )}

      {/* Single text body — when rotated, one centered shell holds fill + shape + blocks (no double card). */}
      <div
        className={cn(
          'relative z-[1]', // Above shape backdrop
          !frameShape && 'rounded-2xl',
          !isFillTransparent && !frameShape && 'backdrop-blur-sm',
          !isBlock && 'p-1',
          pagePreviewOpen && 'flex flex-col h-full min-h-0',
          unlockedResized && !showClipPreview && !isContentRotated
            ? 'h-full overflow-hidden'
            : 'overflow-visible',
          promptMessage?.metadata?.fadeIn === true &&
            isBlockContentEmpty(promptContent) &&
            'animate-note-fade-in',
          isContentRotated && 'absolute'
        )}
        style={{
          backgroundColor: frameShape ? 'transparent' : responseAreaBackgroundColor,
          clipPath: frameShape && !showClipPreview ? shapeClip : undefined,
          ...(isContentRotated
            ? {
                width: contentBoxW,
                height: contentBoxH,
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }
            : {}),
        }}
      >
        {isBlock && frameShape && !pagePreviewOpen && isContentRotated && (
          <FrameShapeBackdrop
            type={frameShape}
            width={shapeBoxW}
            height={shapeBoxH}
            fill={shapeFill}
            fillOpacity={0.2}
            stroke={shapeStroke}
            strokeWidth={shapeStrokeW}
          />
        )}
        {/* Hover full-content preview: fill behind spilled blocks (frame box stays the saved size) */}
        {showClipPreview && resizeDimensions && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 rounded-2xl -z-[1]"
            style={{
              width: Math.max(resizeDimensions.width, huggedSize.width),
              height: Math.max(resizeDimensions.height, huggedSize.height),
              backgroundColor: responseAreaBackgroundColor || panelBackgroundColor,
              boxShadow:
                resolvedTheme === 'dark'
                  ? '0 10px 28px rgba(0,0,0,0.45)'
                  : '0 10px 28px rgba(0,0,0,0.12)',
            }}
          />
        )}
        {/* Page frame with regular blocks (no pageLink) — pin open menu to the visible frame edge
            (inside the overflow clip), not to the wider content box. */}
        {showFramePageOpenMenu && linkedPageId && (
          <PageLinkProvider value={pageLinkActions}>
            <PageOpenMenu
              pageId={linkedPageId}
              notionUrl={notionUrl}
              forceVisible
              className="!right-1 !top-2 !translate-y-0"
            />
          </PageLinkProvider>
        )}
        {/* Hide body while previewing — keeps page title (edge chip / preview chrome) from sitting under the map */}
        {!pagePreviewOpen && (
          <div
            style={
              applyFrameScale
                ? {
                    // Unlocked resized (wrap or clip): spacer = frame inner box; content is scaled to fill it.
                    // Locked/other: spacer = scaled content (hug). Hover preview grows spacer to full content.
                    width:
                      showClipPreview
                        ? Math.max(unlockedInnerW ?? 0, scaledLayoutW)
                        : unlockedResized && unlockedInnerW != null
                          ? unlockedInnerW
                          : scaledLayoutW,
                    height:
                      showClipPreview
                        ? Math.max(unlockedInnerH ?? 0, scaledLayoutH)
                        : unlockedResized && unlockedInnerH != null
                          ? unlockedInnerH
                          : scaledLayoutH,
                    overflow: unlockedResized && !showClipPreview ? 'hidden' : 'visible', // Unclip on hover preview
                    ...clipFadeStyle, // Soften half-cut glyphs at overflowing edges
                  } // CSS scale doesn’t affect layout — spacer holds visual size
                : unlockedResized
                  ? {
                      // frameScale === 1: no spacer scale, but still clip / unclip on hover
                      overflow: showClipPreview ? 'visible' : 'hidden',
                      height: showClipPreview
                        ? Math.max(unlockedInnerH ?? 0, scaledLayoutH)
                        : unlockedInnerH ?? undefined,
                      width: showClipPreview
                        ? Math.max(unlockedInnerW ?? 0, scaledLayoutW)
                        : unlockedInnerW ?? undefined,
                      ...clipFadeStyle, // Soften half-cut glyphs at overflowing edges
                    }
                  : undefined
            }
          >
          <div
            ref={contentFitRef} // Unscaled content box (offsetWidth ignores CSS scale)
            className={cn(
              'relative', // Anchor for in-content absolute chrome
              // Locked+resized: natural width so hug measures real text (not the stretched box).
              // Unlocked resized / wrap: fill the free frame. Unresized: w-max from longest line.
              wrapContentWidth != null
                ? undefined
                : !frameUnlocked && isUserResized
                  ? 'w-max'
                  : isUserResized || !growsWithLine
                    ? 'w-full'
                    : 'w-max',
              // Blocks: horizontal pad only in class; equal tight vertical pad via style (avoids asymmetric leftovers)
              isBlock ? 'pr-4 pl-0.5' : 'px-3 py-3'
            )}
            style={{
              ...(isBlock ? { paddingTop: 4, paddingBottom: 4 } : {}), // Equal 4px top/bottom — less than legacy pt-4/pb-4
              lineHeight: '1.7', // Stable typography — height-based line-height broke lock-to-text
              ...(wrapContentWidth != null ? { width: wrapContentWidth, maxWidth: wrapContentWidth } : {}), // Soft-wrap inside frame
              ...(applyFrameScale
                ? { transform: `scale(${frameScale})`, transformOrigin: 'top left' }
                : {}),
            }}
            onClick={(e) => {
              // Clicks in frame padding (right of short/empty lines) still place the I-bar
              if (!isBlock || !selected) return
              const t = e.target as HTMLElement
              if (t.closest?.('.ProseMirror, [data-tt-block-handle], [data-tt-insert-line], .block-actions-menu')) {
                return // Editor / grip / nest already handle these
              }
              const ed = promptEditorRef.current
              if (!ed || ed.isDestroyed) return
              e.stopPropagation()
              const block = findEditorBlockAtClientY(ed, e.clientY)
              if (!block) return
              const caret = Math.max(block.from + 1, block.to - 1) // End of that block’s content
              ed.chain().focus().setTextSelection(caret).run()
            }}
          >
            <PageLinkProvider value={pageLinkActions}>
            <TipTapContent
              content={promptContent || ''}
              className="text-gray-900 dark:text-gray-100"
              originalContent={
                isProjectBoard
                  ? (data.boardTitle || '')
                  : mergePanelHtml(
                      promptMessage?.content,
                      responseMessage?.content ? formatResponseContent(responseMessage.content) : ''
                    )
              }
              onContentChange={handlePromptChange}
              onHasChangesChange={setPromptHasChanges}
              onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
              comments={comments.filter(c => c.section === 'prompt')}
              editorRef={promptEditorRef}
              fontScale={isBlock ? 1 : fontScale} // Blocks use frameScale CSS; chat/flashcards keep fontScale
              onCommentHover={(commentId) => {
                if (commentId) {
                  if (showComments) {
                    setSelectedCommentId(commentId)
                  } else {
                    setSelectedCommentId(null)
                  }
                }
              }}
              onCommentClick={(commentId) => {
                if (commentId) {
                  setShowComments(true)
                  setSelectedCommentId(commentId)
                }
              }}
              onAddReaction={handleAddReaction}
              section="prompt"
              placeholder=""
              isFlashcard={isFlashcard}
              isPanelSelected={!!selected && !dragging} // Mid-drag: treat as unselected so ⋮⋮ / caret stay off
              suspendContentSync={!!dragging} // Keep databaseBlock NodeView mounted while the frame moves
              forceContentSyncKey={aiForceSyncKey} // AI eye / remove / save swaps content even while focused
              isLoading={false}
              onBlur={handleEditorBlur}
              onEditorActiveChange={handleEditorActiveChange}
              enableBlockHandles={isBlock && !isFlashcard} // ⋮⋮ on each TipTap block, not this frame
              singleLineUntilEnter={isBlock && !isFlashcard && !wrapActive} // nowrap until Enter; wrap mode (locked/unlocked) soft-wraps
              hostNodeId={id}
              conversationId={conversationId}
              pageInTargets={(() => {
                const convs =
                  (queryClient.getQueryData(['conversations']) as
                    | Array<{ id: string; title?: string | null }>
                    | undefined) || []
                return [
                  { id: conversationId || '', title: 'Current page' },
                  ...convs
                    .filter((c) => c.id !== conversationId)
                    .slice(0, 40)
                    .map((c) => ({ id: c.id, title: c.title?.trim() || 'Untitled' })),
                ]
              })()}
              onPageTurnInto={async (blockType, pageInParentId) => {
                if (!promptMessage?.id || !conversationId) return
                try {
                  const {
                    data: { user },
                  } = await supabase.auth.getUser()
                  if (!user) return
                  await applyTurnInto(supabase, {
                    messageId: promptMessage.id,
                    conversationId,
                    userId: user.id,
                    blockType,
                    pageInParentId: pageInParentId || null,
                  })
                  await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
                  await queryClient.invalidateQueries({ queryKey: ['conversations'] })
                } catch (err) {
                  console.error('Failed Page turn into from content block:', err)
                }
              }}
            />
            </PageLinkProvider>
          </div>
          </div>
        )}

        {/* Keep iframe mounted after warm/open; fills card while visible. Targets the active page
            (a pageLink's child page) — falls back to the frame's own linked page. */}
        {pagePreviewMounted && activePreviewPageId && (
          <div
            className={cn(
              pagePreviewOpen ? 'flex-1 min-h-0 min-w-0 flex flex-col p-2 pt-2' : 'hidden'
            )}
          >
            <NestedBoardPreview
              key={activePreviewPageId} // Remount when switching between different child pages
              conversationId={activePreviewPageId}
              title={blockTitleLabel}
              visible={pagePreviewOpen}
              fill={pagePreviewOpen}
              hostNodeId={id} // Chrome drag moves this host item
              onClose={() => setPagePreviewOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Right handle with flashcard navigation */}
      {/* Hide handle when comment popup is visible */}
      {isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) && nextBoardWithFlashcards && isAtLastFlashcardInBoard && selected ? (
        // Expanded pill with two buttons when cross-board navigation is available and flashcard is selected
        <div
          className={cn(
            'absolute right-0 top-1/2 z-20 flex items-center justify-center translate-x-1/2 -translate-y-1/2'
          )}
          style={{ 
            width: '24px', 
            height: '48px',
            transition: 'height 300ms ease-in-out'
          }}
        >
          <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-0.5 flex flex-col gap-0.5 h-12 w-6 items-center justify-center transition-all duration-300 ease-in-out">
            {/* Single arrow button - cycles through current board */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToNextFlashcard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-all duration-300"
              title="Next flashcard in this board"
            >
              <ChevronRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
            {/* Double arrow button - navigates to next board (only when selected) */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToNextBoard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center animate-fade-in"
              title="Next board"
            >
              <ChevronsRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      ) : isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) ? (
        <div
          className={cn(
            'absolute right-0 top-1/2 z-20 flex items-center justify-center translate-x-1/2 -translate-y-1/2 cursor-pointer'
          )}
          style={{ 
            width: '24px', 
            height: '24px',
            transition: 'height 300ms ease-in-out'
          }}
          onClick={(e) => {
            e.stopPropagation()
            navigateToNextFlashcard()
          }}
        >
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default',
              'handle-dot-flashcard-large'
            )}
            style={{
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-30">
            <ChevronRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
          </div>
        </div>
      ) : null}
      {/* Non-flashcard right Handle removed — edge connection points cover all sides above */}


      {/* New comment box - appears to the right when creating a comment */}
      {newCommentData && (
        <div
          className="absolute left-full ml-4 top-0 w-64 bg-white dark:bg-[#171717] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] z-30"
        >
          <div className="p-3 flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setNewCommentData(null)}
            >
              <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </Button>
          </div>
          <div className="p-3 pt-0">
            <Textarea
              ref={newCommentTextareaRef}
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Add a comment..."
              data-comment-input="true"
              className="text-sm resize-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
              style={{
                borderRadius: '26px', // Always pill shape - fully rounded sides
                minHeight: '52px', // Minimum height (2x corner radius) - ensures fully rounded sides at default
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '0px', // No top padding to maintain pill shape (will be adjusted by useEffect)
                paddingBottom: '0px', // No bottom padding to maintain pill shape (will be adjusted by useEffect)
                boxSizing: 'border-box',
                // Height and padding will be adjusted by useEffect to maintain pill shape
              }}
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNewCommentData(null)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveComment}
                disabled={!newCommentText.trim()}
                className="text-xs rounded-full"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Emoji reaction pills - appear to the right, vertically aligned with selected text */}
      {emojiReactions.length > 0 && (
        <div>
          {emojiReactions.map((reaction) => {
            // Calculate vertical position based on text position in editor
            const editor = reaction.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current
            let topPosition = 0

            if (editor && panelRef.current) {
              try {
                const coords = editor.view.coordsAtPos(reaction.from)
                const panelRect = panelRef.current.getBoundingClientRect()
                if (panelRect && coords) {
                  // Calculate position relative to panel top - align with top of selection
                  topPosition = coords.top - panelRect.top
                }
              } catch (error) {
                console.error('Error calculating emoji reaction position:', error)
              }
            }

            return (
              <EmojiReactionPill
                key={reaction.id}
                reaction={reaction}
                topPosition={topPosition}
                onAddReaction={() => {
                  // When clicking the pill, increment the count
                  setEmojiReactions(prev =>
                    prev.map(r =>
                      r.id === reaction.id
                        ? { ...r, count: r.count + 1 }
                        : r
                    )
                  )
                }}
              />
            )
          })}
        </div>
      )}

      {/* Comment panels - appear to the right, vertically aligned with highlighted text */}
      {showComments && comments.length > 0 && (
        <div 
          ref={commentPanelsRef}
          className={cn(
            // Comments blur the same as non-flashcard map content during nav mode
            shouldBlurComments && 'blur-sm opacity-40 pointer-events-none'
          )}
        >
          {comments.map((comment) => {
            // Calculate vertical position based on text position in editor
            const editor = comment.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current
            let topPosition = 0

            if (editor && panelRef.current) {
              try {
                const coords = editor.view.coordsAtPos(comment.from)
                const panelRect = panelRef.current.getBoundingClientRect()
                if (panelRect && coords) {
                  // Calculate position relative to panel top
                  topPosition = coords.top - panelRect.top + (coords.bottom - coords.top) / 2 // Center of selection
                }
              } catch (error) {
                console.error('Error calculating comment position:', error)
              }
            }

            const isSelected = selectedCommentId === comment.id

            return (
              <CommentPanel
                key={comment.id}
                comment={comment}
                isSelected={isSelected}
                topPosition={topPosition}
                onSelect={() => {
                  const newSelectedId = isSelected ? null : comment.id
                  setSelectedCommentId(newSelectedId)
                  // Clear reply text when deselecting
                  if (!newSelectedId && replyTexts[comment.id]) {
                    setReplyTexts(prev => {
                      const updated = { ...prev }
                      delete updated[comment.id]
                      return updated
                    })
                  }
                }}
                onDelete={() => {
                  setComments(prev => prev.filter(c => c.id !== comment.id))
                  if (selectedCommentId === comment.id) {
                    setSelectedCommentId(null)
                  }
                }}
                replyText={replyTexts[comment.id] || ''}
                onReplyChange={(text) => setReplyTexts(prev => ({ ...prev, [comment.id]: text }))}
                replyTextareaRef={(el) => {
                  if (el) {
                    replyTextareaRefs.current[comment.id] = el
                  } else {
                    delete replyTextareaRefs.current[comment.id]
                  }
                }}
              />
            )
          })}
        </div>
      )}
      
      {/* Flashcard tags only — copy / collapse / more under-item menu removed */}
      {selected && isFlashcard && responseMessage?.id && tagsLoaded && (
        <div 
          className="absolute left-0 flex items-start gap-1 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 z-50 pointer-events-auto"
          style={{
            top: '100%', // Position below the panel
            marginTop: '8px', // Gap between panel and toolbar (matches note resize toolbar gap)
          }}
          onClick={(e) => e.stopPropagation()} // Prevent clicks from propagating to panel
        >
          <TagButton responseMessageId={responseMessage.id} />
          <TagBoxes responseMessageId={responseMessage.id} initialTagIds={tagIds} />
        </div>
      )}
      
    </div>
  )
}

// Separate component for emoji reaction pill
function EmojiReactionPill({
  reaction,
  topPosition,
  onAddReaction,
}: {
  reaction: EmojiReaction
  topPosition: number
  onAddReaction: () => void
}) {
  return (
    <div
      className="absolute pointer-events-auto z-[100]"
      style={{
        top: `${topPosition}px`,
        right: '-48px', // Position to the right of panel, similar to comment button popup
      }}
    >
      <button
        onClick={onAddReaction}
        className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-md border border-gray-200 dark:border-[#2f2f2f] px-2 py-1 flex items-center gap-1.5 hover:shadow-lg transition-shadow"
        title="Click to add reaction"
      >
        <span className="text-base">{reaction.emoji}</span>
        <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">{reaction.count}</span>
      </button>
    </div>
  )
}

// Separate component for comment panel to manage hover state
function CommentPanel({
  comment,
  isSelected,
  topPosition,
  onSelect,
  onDelete,
  replyText,
  onReplyChange,
  replyTextareaRef
}: {
  comment: Comment
  isSelected: boolean
  topPosition: number
  onSelect: () => void
  onDelete: () => void
  replyText: string
  onReplyChange: (text: string) => void
  replyTextareaRef: (el: HTMLTextAreaElement | null) => void
}) {
  const [isHovering, setIsHovering] = useState(false)

  return (
    <div
      className={cn(
        "absolute left-full ml-4 w-64 rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] z-30 cursor-pointer transition-colors",
        isSelected
          ? "bg-white dark:bg-[#171717]"
          : "bg-blue-50 dark:bg-[#2a2a3a]"
      )}
      style={{
        top: `${topPosition}px`,
        transform: 'translateY(-50%)', // Center vertically with highlighted text
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={(e) => {
        // Stop propagation to prevent click-away from firing when clicking on the panel
        e.stopPropagation()
        // Only handle clicks on the panel itself, not on child elements
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.p-3')) {
          onSelect()
        }
      }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 text-sm text-gray-700 dark:text-gray-300 break-words min-w-0">
            {comment.comment}
          </div>
          {/* More menu button - only show on hover when not selected (condensed version), always show when selected */}
          {((!isSelected && isHovering) || isSelected) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Reply input box - only shown when comment is selected */}
        {isSelected && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#2f2f2f]">
            <Textarea
              ref={replyTextareaRef}
              value={replyText}
              onChange={(e) => onReplyChange(e.target.value)}
              placeholder="Reply or add others with @"
              data-comment-input="true"
              className="w-full text-sm resize-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
              style={{
                borderRadius: '26px', // Always pill shape - fully rounded sides
                minHeight: '52px', // Minimum height (2x corner radius) - ensures fully rounded sides at default
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '0px', // No top padding to maintain pill shape (will be adjusted by useEffect)
                paddingBottom: '0px', // No bottom padding to maintain pill shape (will be adjusted by useEffect)
                boxSizing: 'border-box',
                // Height and padding will be adjusted by useEffect to maintain pill shape
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  )
}

