'use client'

// Custom React Flow node for chat panels (prompt + response)
import { NodeProps, Handle, Position, useReactFlow, useStore, useStoreApi, NodeResizeControl, useUpdateNodeInternals } from 'reactflow' // RF node primitives + store (unselect groups before dragItems) + remeasure; useStore = live zoom for screen-constant chrome
import {
  useIsThreadConnecting,
  useIsNearThreadConnection,
  ConnectionIndicator,
  INDICATOR_OUTSET,
  frameScreenChromeScale,
} from '@/components/threads' // Miro: DOM indicators arm edge connection points; proximity while dragging


import { cn, generateUUID } from '@/lib/utils'
import { boardTitleOrDefault } from '@/lib/board-title' // Empty conversation names show New board
import { useEditor, EditorContent } from '@tiptap/react'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model' // Parse stored HTML → PM doc for exact (non-string) sync compare
import { TextSelection } from '@tiptap/pm/state' // Only text ranges keep a frame "active" — not boardLink NodeSelection
import { createPanelExtensions } from '@/lib/tiptap/extensions' // StarterKit + Turn into nodes
import { TipTapBlockHandles } from '@/components/tiptap-block-handles' // Per-content-block ⋮⋮ (Notion)
import { FrameStackRevealLine } from '@/components/frame-stack-reveal-line' // Stack edge dashed line → reveal
import { FrameShapeBackdrop } from '@/components/frame-shape-backdrop' // SVG silhouette behind TipTap
import {
  frameShapeClipCss,
  parseFrameShape,
  FRAME_SHAPE_DEFAULT_SIZE,
  rotatedFrameAabbSize,
  rotatedRectAabbSize,
  type FrameShapeType,
} from '@/lib/frame-shape' // Frame-as-shape parse + clip + rotation AABB
import type { FrameStackSide } from '@/components/use-frame-nest-stack-drag'
import {
  applySnapMateRelayout,
  persistSnapMateRelayout,
} from '@/components/use-frame-nest-stack-drag' // Repark snap mates when AABB changes (rotation)
import {
  FRAME_STACK_SIDES,
  readSideStacks,
} from '@/lib/frame-side-stacks' // Per adjust-box side stack trees
import { findEditorBlockAtClientY } from '@/lib/tiptap/block-selection' // Click in frame padding → block at Y
import {
  isBoardNavigating,
  navigationZoom,
} from '@/lib/board-navigating' // Freeze zoom selectors + skip hug while pinching
import { deleteLinkedBoardForBlock, getLinkedBoardId, isBlockContentEmpty, isBlockMeta, isBoardBodyMeta, readNotionConnection, type NotionSyncMode } from '@/lib/blocks' // Block detection + Notion connection
import {
  readFramePropertyType,
  PROPERTY_GROUP_H,
  type PropertyTypeId,
} from '@/lib/blocks/property' // Turn into → Property → top chrome
import {
  htmlHasPropertyBlocks,
  readPropertyBlockHeadersFromDoc,
  readPropertyBlockHeadersFromHtml,
  readPropertyBlockAt,
  setPropertyBlockValue,
  type PropertyHeaderItem,
} from '@/lib/tiptap/property-block' // Top icons = empty propertyBlocks only
import {
  bindPropertyIconDrag,
  resolvePropertyHeaderFrom,
  type PropertyDropLine,
} from '@/lib/tiptap/property-block-drag' // Drag between property cells
import { PropertyDropLinePortal } from '@/components/property-drop-line-portal' // Blue dashed insert line
import type { Editor } from '@tiptap/core' // Property header drag + popup edits
import { PropertyIconWithTooltip } from '@/components/property-icon-with-tooltip' // Top-strip icon + name popup
import { PropertyValuePopup, type PropertyEditorAnchor } from '@/components/property-value-popup' // Calendar / checkbox / text

import { NotionMarkIcon } from '@/components/notion-mark-icon' // Logo at bottom of a Notion-connected frame
import { createPortal } from 'react-dom'
import {
  FrameContentShimmer,
  frameHasVisibleText,
  shimmerBarCountFromHtml,
  BOARD_LOAD_FADE_MS,
} from '@/components/frame-content-shimmer' // Frame vs text-line load shell while TipTap mounts
import { pruneEmptyTextblocks } from '@/lib/tiptap/empty-block-backspace' // Strip blank lines on frame deselect
import { setAiTextSelection } from '@/lib/ai/selection-bridge' // Live highlighted-text pills in AI composer
import { BlockActionsMenu, type BoardInTarget } from '@/components/block-actions-menu'
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, Fragment } from 'react'
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

const BLOCK_HANDLE_GUTTER_W = 24 // TipTap ⋮⋮ column inside the blue adjust strip
/** Extra air between blue adjust ring and fill (beyond ⋮⋮ / property band) — × screenChromeScale */
const ADJUST_CONTENT_GAP_Y = 6 // Top/bottom band air
const ADJUST_CONTENT_GAP_X = 1 // L/R — tighter than T/B
const BOARD_LINK_ICON_W = 22 // Title emoji / page icon column
const BOARD_OPEN_MENU_W = 52 // Open-menu pill ≈ preview + open (Notion adds a bit more)
const BLOCK_THREE_CHARS_W = 28 // ~3ch of body text for plain frames
const BLOCK_MIN_FRAME_H = 32 // One line (~24) + equal 4px content pads — hug the block, don't float chrome
const BLOCK_FRAME_PAD_Y = 4 // Top/bottom inset inside the fill
const BLOCK_FRAME_PAD_X = 6 // Slightly more L/R than T/B (property cell ↔ frame edge)
const BLOCK_FRAME_PAD = BLOCK_FRAME_PAD_X // Default / band inset = horizontal pad
/** Property cell radius at scale 1 — fill lives outside CSS scale so multiply by chromeScale; adjust ring stays square */
const FRAME_CORNER_RADIUS = 6
const CONNECTIONS_GROUP_H = 28 // h-7 footer strip — hug spacer + pinned group when the free frame clips
const DATABASE_BLOCK_HTML_RE = /data-type=["']databaseBlock["']/i // TipTap Notion DB atom in frame HTML
const FRAME_ATOM_HTML_RE =
  /data-type=["'](?:boardLink|pageLink|databaseBlock|imageBlock|propertyBlock)["']/i // Attr-only TipTap atoms
const MIN_DATABASE_FRAME_W = 240 // Below this a DB frame is a collapsed stub (grip + title only)
const MIN_DATABASE_FRAME_H = 120 // Title row alone is ~40; table needs more height than that

/** True when this frame's TipTap HTML embeds a Notion databaseBlock. */
function hasDatabaseBlockHtml(html: string): boolean {
  return DATABASE_BLOCK_HTML_RE.test(html || '')
}

/** True when HTML carries boardLink / property / DB / image atoms (must not wipe on drag). */
function hasFrameAtomHtml(html: string): boolean {
  return FRAME_ATOM_HTML_RE.test(html || '')
}

/** Count propertyBlock atoms — row cards lose these when NodeViews remount mid-drag. */
function countPropertyBlocks(html: string): number {
  const m = (html || '').match(/data-type=["']propertyBlock["']/gi)
  return m ? m.length : 0
}

/** Row→card frames (boardLink + property cells) — not sole databaseBlock tables. */
function isRowCardAtomHtml(html: string): boolean {
  return countPropertyBlocks(html) > 0
}

/** Post-drag hug sometimes measures a remounting DB NodeView as ~52×40 and persists it — reject those. */
function isCollapsedDatabaseFrameSize(width: number, height: number): boolean {
  return width < MIN_DATABASE_FRAME_W || height < MIN_DATABASE_FRAME_H
}

/** Min frame width: boardLink → (optional grip)+icon+menu; plain text → (optional grip)+3 letters. */
function blockMinFrameWidth(html: string, withGutter = true): number {
  const gutter = withGutter ? BLOCK_HANDLE_GUTTER_W : 0 // Unselected frames omit the ⋮⋮ column
  if (/data-type="boardLink"/i.test(html || '')) {
    return gutter + BOARD_LINK_ICON_W + BOARD_OPEN_MENU_W
  }
  return gutter + BLOCK_THREE_CHARS_W
}

const BLOCK_MIN_FRAME_W = BLOCK_HANDLE_GUTTER_W + BOARD_LINK_ICON_W + BOARD_OPEN_MENU_W // Default / boardLink floor
const BLOCK_LOCKED_MIN_W = BLOCK_HANDLE_GUTTER_W + BLOCK_THREE_CHARS_W // Absolute floor when hugging
const GRIP_ICON_INSET = 2 // ⋮⋮ glyph (16px) centered in its 20px hit button → (20-16)/2 from the gutter left

/** Axis-aligned box that contains a w×h rect rotated by `deg` degrees (around center). */
function rotatedAabbSize(w: number, h: number, deg: number): { width: number; height: number } {
  return rotatedRectAabbSize(w, h, deg)
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
  const padL = parseFloat(cs.paddingLeft) || 0 // Content-box left pad (BLOCK_FRAME_PAD on blocks)
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
    const boardLink =
      (child.classList.contains('tt-board-link') && child) ||
      (child.classList.contains('tt-page-link') && child) ||
      (child.querySelector('.tt-board-link, .tt-page-link') as HTMLElement | null)
    if (boardLink) {
      // icon LAYOUT box + gap + real title text — never getBoundingClientRect on the icon:
      // boardLink chromeScale is a CSS transform, and gBCR would report the counter-scaled
      // visual width → locked hug / RF node box thrash (nodes(ref) storm / max update depth).
      const label =
        (boardLink.querySelector('.tt-board-link-label') as HTMLElement | null) ||
        (boardLink.querySelector('.tt-page-link-label') as HTMLElement | null)
      const iconWrap =
        (boardLink.querySelector('.tt-board-link-icon-wrap') as HTMLElement | null) ||
        (boardLink.querySelector('.tt-page-link-icon-wrap') as HTMLElement | null)
      const icon =
        iconWrap ||
        (boardLink.querySelector('.tt-board-link-icon') as HTMLElement | null) ||
        (boardLink.querySelector('.tt-page-link-icon') as HTMLElement | null)
      const gap = parseFloat(getComputedStyle(boardLink).gap) || 6
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
      // Prefer the table’s intrinsic scrollWidth — under data-single-line the NodeView is
      // width:100%, so offsetWidth echoes the frame and atomExplicitBox/hug inflate forever.
      const table = dbBlock.querySelector('.tt-notion-db') as HTMLElement | null
      const tableEl = table?.querySelector('table') as HTMLElement | null
      const w = Math.max(
        tableEl?.scrollWidth || 0,
        table?.scrollWidth || 0,
        // Title row only (loading shell) — still need a floor wider than the grip stub
        (dbBlock.querySelector('.tt-database-block-row') as HTMLElement | null)?.scrollWidth || 0
      )
      maxLine = Math.max(maxLine, w)
      continue
    }
    maxLine = Math.max(maxLine, rangeWidth(child)) // Longest real text line
  }
  // Right margin: equal to padL when there is no ⋮⋮ gutter (gutter lives in select chrome).
  // With an in-fill gutter, mirror frame-left→⋮⋮ icon. Honor live paddingRight.
  const padR = parseFloat(cs.paddingRight) || 0
  const rightInset = gutter > 0 ? Math.max(padR, padL + GRIP_ICON_INSET) : Math.max(padR, padL)
  return Math.ceil(Math.max(1, padL + gutter + maxLine + rightInset))
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

// Visual frame = unscaled content × frameScale. Do NOT add a phantom +2 border — selected
// frames use borderWidth 0 (blue adjust chrome), so +2 left slack under the content and the
// left/right connection indicators sat below the ⋮⋮ / text midline.
function scaledFrameSize(
  intrinsic: { width: number; height: number },
  scale: number,
  minWidth = BLOCK_LOCKED_MIN_W,
) {
  const safeScale = Math.max(0.15, scale) // Same floor as locked corner-drag
  return {
    width: Math.max(minWidth, Math.ceil(intrinsic.width * safeScale)),
    height: Math.max(BLOCK_MIN_FRAME_H, Math.ceil(intrinsic.height * safeScale)),
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
import { useBoardAccess } from '@/lib/share/board-access-context' // Gate TipTap editable for shared viewers
import { useReactFlowContext } from './react-flow-context'
import { useTheme } from './theme-provider'
import { SelectionFormatPopupAnchor } from './selection-format-popup' // Notion-style selection menu (stable edge anchor)
import { BoardLinkProvider, type BoardLinkActions } from '@/lib/board-link-context' // Bridge boardLink NodeViews → frame preview/open/rename
import { BoardOpenMenu } from '@/components/board-open-menu' // Preview/open chrome for page frames without a boardLink
import { NestedBoardPreview, prefetchBoardEmbed } from './nested-board-preview' // Page-within-page board preview
import { unwrapNestedFramesHtml } from '@/lib/tiptap/unwrap-nested-frames' // Flatten legacy nest wrappers
import { applyTurnInto, bodyHtmlWithoutBoardTitle } from '@/lib/blocks/turn-into' // Page promote + strip title from board body
import { migrateSoleDatabaseBlockToBoardLink, ensureNotionMapFrameIsBoardLink, isSoleDatabaseBlockContent, isSoleBoardLinkContent, repairBoardFrameToSoleLink, restoreWipedDatabaseBlockHtml } from '@/lib/notion/migrate-frame' // Notion DB map frames → boardLink; repair polluted board frames; heal wiped tables

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

const PROPERTY_ICON_SIZE = 20 // h-5 w-5 top-strip glyph
const PROPERTY_ICON_GAP = 6 // gap-1.5 between icons / carets
const PROPERTY_CARET_SIZE = 20 // Chevron buttons match icon hit target

/** Width of N property icons in a row (incl. gaps). */
function propertyIconsRowWidth(count: number): number {
  if (count <= 0) return 0
  return count * PROPERTY_ICON_SIZE + (count - 1) * PROPERTY_ICON_GAP
}


/** Top strip: **empty** type icons in document order — one **block** (⋮⋮ comes from TipTapBlockHandles). */
function FramePropertyGroup({
  items,
  className,
  bandWidth,
  layoutScale = 1,
  editor = null,
  editorRef,
}: {
  items: PropertyHeaderItem[] // Same sequence as header-only property blocks in the frame
  className?: string
  bandWidth?: number // Constrained host width (chrome band) — self-measure grows with icons without this
  layoutScale?: number // screenChromeScale on the wrapper — layout must be narrower so scaled glyphs fit
  editor?: Editor | null // Live TipTap — drag into body + click-to-edit popups
  editorRef?: React.MutableRefObject<Editor | null> // Host chrome reads the live editor from a ref
}) {
  const liveEditor = () => {
    const fromRef = editorRef?.current
    if (fromRef && !fromRef.isDestroyed) return fromRef
    if (editor && !editor.isDestroyed) return editor
    return null
  }
  const containerRef = useRef<HTMLDivElement>(null) // Clip + aria target
  const [containerWidth, setContainerWidth] = useState(0) // Layout px available for icons (post-scale)
  const [pageStart, setPageStart] = useState(0) // Index of first visible icon when paginated
  const scale = layoutScale > 0 ? layoutScale : 1
  const [editorOpen, setEditorOpen] = useState<PropertyEditorAnchor & { from: number; type: PropertyTypeId; name: string; value: string } | null>(null)
  const [dropLine, setDropLine] = useState<PropertyDropLine | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; type: PropertyTypeId } | null>(null)

  const openEditorAt = useCallback(
    (item: PropertyHeaderItem, el: HTMLElement) => {
      const ed = liveEditor()
      if (!ed || item.from < 0) return
      const live = readPropertyBlockAt(ed, item.from)
      const r = el.getBoundingClientRect()
      setEditorOpen({
        from: item.from,
        type: live?.type ?? item.type,
        name: live?.name || item.name,
        value: live?.value ?? '',
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      })
    },
    [editor, editorRef]
  )

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>, item: PropertyHeaderItem) => {
      const ed = liveEditor()
      if (!ed) return
      const from = resolvePropertyHeaderFrom(ed, item)
      if (from < 0) return
      bindPropertyIconDrag(e, {
        getEditor: liveEditor,
        from,
        el: e.currentTarget,
        headerEl: containerRef.current,
        pageStart,
        iconType: item.type,
        onClick: () => openEditorAt({ ...item, from }, e.currentTarget),
        callbacks: { setGhost, setDropLine },
      })
    },
    [editor, editorRef, openEditorAt, pageStart]
  )

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measureHost = () =>
      (el.closest('[data-tt-property-band]') as HTMLElement | null) ??
      (el.closest('[data-tt-frame-chrome-top]') as HTMLElement | null) ??
      el.parentElement
    const sync = () => {
      const hostW = bandWidth ?? measureHost()?.clientWidth ?? 0
      setContainerWidth(hostW > 0 ? hostW / scale : 0)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    const host = measureHost()
    if (host && host !== el) ro.observe(host)
    return () => ro.disconnect()
  }, [bandWidth, scale])

  const itemsKey = useMemo(
    () => items.map((it) => `${it.type}\0${it.name}`).join('\x1e'),
    [items]
  ) // Reset page when the property list changes
  useEffect(() => {
    setPageStart(0)
  }, [itemsKey])

  const { perPage, needsPagination } = useMemo(() => {
    const total = items.length
    if (!total) return { perPage: 0, needsPagination: false }
    if (containerWidth <= 0) {
      return { perPage: 1, needsPagination: total > 1 } // Conservative until the band is measured
    }
    if (propertyIconsRowWidth(total) <= containerWidth) {
      return { perPage: total, needsPagination: false } // Everything fits — no carets
    }
    const showLeft = pageStart > 0
    let available = containerWidth
    if (showLeft) available -= PROPERTY_CARET_SIZE + PROPERTY_ICON_GAP
    available -= PROPERTY_CARET_SIZE + PROPERTY_ICON_GAP // Reserve right caret
    const perPage = Math.max(
      1,
      Math.floor((available + PROPERTY_ICON_GAP) / (PROPERTY_ICON_SIZE + PROPERTY_ICON_GAP))
    )
    return { perPage, needsPagination: true }
  }, [items.length, containerWidth, pageStart])

  useEffect(() => {
    if (!needsPagination) {
      if (pageStart !== 0) setPageStart(0)
      return
    }
    const maxStart = Math.max(0, items.length - perPage)
    if (pageStart > maxStart) setPageStart(maxStart) // Clamp after resize / perPage shift
  }, [needsPagination, items.length, perPage, pageStart])

  if (items.length === 0) return null // No property cells → no top chrome

  const visibleItems = needsPagination ? items.slice(pageStart, pageStart + perPage) : items
  const canGoBack = needsPagination && pageStart > 0
  const canGoForward = needsPagination && pageStart + perPage < items.length
  const markClass =
    'nodrag nopan flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]'
  const layoutMaxW = bandWidth != null && bandWidth > 0 ? bandWidth / scale : containerWidth > 0 ? containerWidth : undefined

  return (
    <>
    <div
      ref={containerRef}
      data-tt-property-header
      className={cn('flex h-7 w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden', className)}
      style={layoutMaxW != null ? { width: layoutMaxW, maxWidth: layoutMaxW } : undefined}
    >
      {canGoBack && (
        <button
          type="button"
          className={markClass}
          title="Previous properties"
          aria-label="Previous properties"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setPageStart((s) => Math.max(0, s - perPage))
          }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {visibleItems.map((item, i) => (
          <PropertyIconWithTooltip
            key={`${item.type}-${item.name}-${item.from}-${pageStart + i}`}
            type={item.type}
            name={item.name}
            className={cn(markClass, item.from >= 0 && liveEditor() && 'cursor-grab active:cursor-grabbing')}
            onPointerDown={(e) => onHeaderPointerDown(e, item)}
          />
        ))}
      </div>
      {canGoForward && (
        <button
          type="button"
          className={markClass}
          title="Next properties"
          aria-label="Next properties"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setPageStart((s) => Math.min(s + perPage, Math.max(0, items.length - perPage)))
          }}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
    {ghost &&
      typeof document !== 'undefined' &&
      createPortal(
        <div
          className="pointer-events-none fixed z-[120] flex h-6 w-6 items-center justify-center rounded bg-white shadow-md ring-1 ring-gray-200 dark:bg-[#1f1f1f] dark:ring-[#2f2f2f]"
          style={{ left: ghost.x + 8, top: ghost.y + 8 }}
        >
          <PropertyIconWithTooltip type={ghost.type} name="" className="flex h-5 w-5 items-center justify-center text-gray-500" />
        </div>,
        document.body
      )}
    <PropertyDropLinePortal line={dropLine} />
    <PropertyValuePopup
      open={!!editorOpen}
      anchor={editorOpen}
      type={editorOpen?.type ?? 'text'}
      name={editorOpen?.name ?? ''}
      value={editorOpen?.value ?? ''}
      onCommit={(next) => {
        const ed = liveEditor()
        if (ed && editorOpen && editorOpen.from >= 0) setPropertyBlockValue(ed, editorOpen.from, next)
      }}
      onClose={() => setEditorOpen(null)}
    />
    </>
  )
}

/** Bottom strip: Notion (and later connectors) — one **block** (⋮⋮ from TipTapBlockHandles). */
function FrameConnectionsGroup({
  notionSync,
  onNotionConnection,
  className,
}: {
  notionSync: NotionSyncMode
  onNotionConnection?: (next: { connected: boolean; sync?: NotionSyncMode }) => void
  className?: string
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null) // Sync menu next to the mark
  useEffect(() => {
    if (!menu) return // Nothing to dismiss
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.('.block-actions-menu, [data-tt-connections-header]')) return // Keep open on mark / menu
      setMenu(null) // Click away closes
    }
    document.addEventListener('mousedown', onDoc, true) // Capture so frame clicks still dismiss
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [menu])
  return (
    <>
      <div
        data-tt-connections-header
        data-tt-notion-footer
        className={cn(
          'flex h-7 w-full items-center', // Full-width Y band so ⋮⋮ hover matches property row
          className
        )}
      >
        <button
          type="button"
          className="nodrag nopan flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
          title="Notion connection"
          aria-label="Notion connection"
          onPointerDown={(e) => e.stopPropagation()} // Don't start frame drag
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom }) // Open Live Sync / Manual / Remove
          }}
        >
          <NotionMarkIcon
            className={cn('h-4 w-4', notionSync === 'live' ? 'text-[#2383e2]' : 'text-gray-500')}
          />
        </button>
      </div>
      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <BlockActionsMenu
            variant="notionConnection"
            x={menu.x}
            y={menu.y}
            positionMode="fixed"
            openLeft
            notionSync={notionSync}
            onAction={(action, payload) => {
              if (action === 'setNotionSync') {
                onNotionConnection?.({ connected: true, sync: payload?.notionSync ?? 'live' })
              } else if (action === 'removeNotionConnection') {
                onNotionConnection?.({ connected: false })
              }
              setMenu(null)
            }}
            onClose={() => setMenu(null)}
          />,
          document.body
        )}
    </>
  )
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
  enableBlockHandles = false, // Keep ⋮⋮ gutter (`pl-6`) for **blocks** — must not flip mid-drag
  showBlockHandles = true, // Paint/arm ⋮⋮ grips; false while RF frame-dragging (gutter stays)
  singleLineUntilEnter = false, // Unresized blocks: one visual line per TipTap block
  hostNodeId,
  conversationId,
  hostMessageId,
  boardInTargets,
  onPageTurnInto,
  suspendContentSync = false, // True while RF frame-dragging — skip setContent remounts
  dragSuspendRef, // Sync flag armed on pointerdown (React state alone is one frame late)
  frameDragging = false, // RF frame drag — databaseBlock swaps to a light shell
  forceContentSyncKey = 0, // Bump to setContent even while editor is focused (AI eye / remove / save)
  notionConnected = false, // Connections → Notion selected
  notionSync = 'live', // Live Sync vs Manual
  onNotionConnection,
  propertyType = null, // Turn into → Property on this frame
  onPropertyTurnInto,
  pinConnectionsToFrame = false, // Free-frame clip: hug spacer only; real group is pinned to the frame
  loadCrossfade = false, // Board load: keep the shell overlay and fade it out; new frames skip this
  chromeBandsOutside = false, // Host paints property / connections in adjust chrome (selected only)
  onPropertyHeadersChange,
  contentPadLeft = 0, // contentFit paddingLeft — ⋮⋮ centers in the blue gutter past this pad
  frameScale = 1, // Locked-resize CSS scale — grips remeasure when it changes
  handleGutterFlow = 0, // Blue L/R gutter width (flow px) — ⋮⋮ local left compensates contentFit scale
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
  enableBlockHandles?: boolean // Gutter + property/Notion chrome for frames that own TipTap blocks
  showBlockHandles?: boolean // False mid-drag so ⋮⋮ unmount without collapsing `pl-6`
  singleLineUntilEnter?: boolean // Unresized map blocks: grow width; Enter starts a new line
  hostNodeId?: string
  conversationId?: string // Page id — ⋮⋮ extract a block onto the page
  hostMessageId?: string // Frame message id — Convert layout API source
  boardInTargets?: BoardInTarget[]
  onPageTurnInto?: (blockType: 'board' | 'boardIn', boardInParentId?: string | null) => void
  suspendContentSync?: boolean
  dragSuspendRef?: React.MutableRefObject<boolean> // Parent mutates sync on pointerdown
  frameDragging?: boolean
  forceContentSyncKey?: number
  notionConnected?: boolean
  notionSync?: NotionSyncMode
  onNotionConnection?: (next: { connected: boolean; sync?: NotionSyncMode }) => void
  propertyType?: PropertyTypeId | null // Frame property chrome at top
  onPropertyTurnInto?: (propertyType: PropertyTypeId) => void // ⋮⋮ Turn into → Property
  pinConnectionsToFrame?: boolean
  loadCrossfade?: boolean // Fade the load shell out as TipTap fades in (skip for fadeIn creates)
  chromeBandsOutside?: boolean // Host paints property / connections in adjust chrome
  onPropertyHeadersChange?: (items: PropertyHeaderItem[]) => void // Live headers for host chrome bands
  contentPadLeft?: number // contentFit padL — grip centering past the fill edge
  frameScale?: number // Locked-resize scale — ⋮⋮ remeasure (CSS transform skips RO)
  handleGutterFlow?: number // Adjust-box L gutter (flow px); grips inverse-scale into it
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setActiveEditor } = useEditorContext()
  const { canEdit } = useBoardAccess() // view/comment → read-only editors (RLS still enforces)
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
  const suspendContentSyncRef = useRef(suspendContentSync)
  suspendContentSyncRef.current = suspendContentSync
  const contentRef = useRef(content)
  contentRef.current = content

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
        // Desktop / pen: claim the gesture when selected (phone uses non-passive touchstart below —
        // PM registers touchstart as passive, so preventDefault there is a no-op).
        pointerdown: (view: any, event: Event) => {
          const pe = event as PointerEvent
          if (pe.pointerType === 'touch') return false // Phone: non-passive touchstart owns placement
          if (pe.button === 2) return false // Right-click → frame menu
          if (!isPanelSelectedRef.current) return false // Unselected: RF selects/drags
          // Preview / open / Notion / DB table (and ⋮⋮) must receive the click — don't steal for caret
          const target = pe.target as HTMLElement | null
          if (
            target?.closest?.(
              '[data-tt-block-handle], [data-tt-insert-line], .block-actions-menu, [data-page-link-preview], .tt-database-block, .tt-notion-db'
            )
          ) {
            return false
          }
          pe.preventDefault()
          pe.stopPropagation()
          selectOnlyClickRef.current = false
          try {
            const hit = view.posAtCoords({ left: pe.clientX, top: pe.clientY })
            if (hit != null && hit.pos >= 0) {
              const sel = TextSelection.near(view.state.doc.resolve(hit.pos))
              view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
            }
            view.focus()
          } catch {
            try {
              view.focus()
            } catch {
              /* ignore */
            }
          }
          return true
        },
        mousedown: (view: any, event: Event) => {
          const mouseEvent = event as MouseEvent
          // Right-click: skip PM I-bar. Do NOT stopPropagation/preventDefault — Chrome
          // then never fires contextmenu, so the frame menu never opens.
          if (mouseEvent.button === 2) {
            return true // Skip ProseMirror caret; let contextmenu bubble to the frame menu
          }
          // Unselected: editor is already editable:false — do NOT preventDefault here
          // (that aborted RF/d3 frame drag on press+move). Only suppress the follow-up I-bar.
          if (!isPanelSelectedRef.current) {
            selectOnlyClickRef.current = true // Suppress I-bar on the matching click
            return false
          }
          // DB table / title chrome owns clicks (cells, toolbar) — table nodrag stops RF drag
          const mouseTarget = mouseEvent.target as HTMLElement | null
          if (mouseTarget?.closest?.('.tt-database-block, .tt-notion-db')) {
            return false
          }
          selectOnlyClickRef.current = false
          // Selected frame: keep pointer inside the editor so RF does not start a frame drag
          mouseEvent.stopPropagation()
          mouseEvent.preventDefault() // Sync with pointerdown — own caret placement

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

          try {
            const hit = view.posAtCoords({ left: mouseEvent.clientX, top: mouseEvent.clientY })
            if (hit != null && hit.pos >= 0) {
              const sel = TextSelection.near(view.state.doc.resolve(hit.pos))
              view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
            }
            view.focus()
          } catch {
            try {
              view.focus()
            } catch {
              /* ignore */
            }
          }
          return true
        },
        contextmenu: (_view: any, event: Event) => {
          event.preventDefault() // Block native Cut/Copy so the frame menu can show
          return false // Let it bubble to RF / board-flow capture
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

  const editor = useEditor(
    {
      extensions,
      content,
      // Unselected frames are not contenteditable — iOS long-press opens the frame menu, not text select
      editable: canEdit && !!isPanelSelected,
      immediatelyRender: false, // Prevent SSR hydration mismatches
      shouldRerenderOnTransaction: false, // Avoid parent re-render storms; NodeViews update themselves
      editorProps,
      onUpdate: ({ editor: ed }) => {
        // Frame drag: NodeView remount noise must not wipe boardLink / property cells to the DB.
        // dragSuspendRef is set sync on pointerdown — React suspendContentSync lags one frame.
        if (suspendContentSyncRef.current || dragSuspendRef?.current) return
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
        // Keep frame selected only for a real TEXT range (format popup). boardLink atoms use
        // NodeSelection (from≠to) — counting that re-selected the frame on every pane click.
        if (ed && onEditorActiveChangeRef.current) {
          const sel = ed.state.selection
          const hasTextRange = sel instanceof TextSelection && !sel.empty
          onEditorActiveChangeRef.current(hasTextRange)
        } else {
          onEditorActiveChangeRef.current?.(false)
        }
      },
    },
    // Non-empty deps: TipTap skips per-render setOptions (deps=[] compares options every RF
    // drag tick → remounts databaseBlock NodeView → table vanishes / frame hugs to a stub).
    [extensions, editorProps]
  )

  // Keep FrameHost storage in sync so databaseBlock NodeViews can convert layout without React context
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const storage = editor.storage as {
      frameHost?: {
        conversationId: string | null
        hostMessageId: string | null
        frameDragging: boolean
      }
    }
    if (!storage.frameHost) return
    storage.frameHost.conversationId = conversationId || null
    storage.frameHost.hostMessageId = hostMessageId || null
  }, [editor, conversationId, hostMessageId])

  // Sync RF drag so databaseBlock can drop the heavy table DOM while the frame moves
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const storage = editor.storage as {
      frameHost?: {
        conversationId: string | null
        hostMessageId: string | null
        frameDragging: boolean
      }
    }
    if (!storage.frameHost) return
    storage.frameHost.frameDragging = !!frameDragging
    const dom = editor.view?.dom as HTMLElement | undefined
    if (dom) {
      if (frameDragging) dom.setAttribute('data-frame-dragging', 'true')
      else dom.removeAttribute('data-frame-dragging')
    }
  }, [editor, frameDragging])

  // Top icons = **empty** propertyBlock headers in doc order (filled cells stay in the body only)
  const [propertyHeaders, setPropertyHeaders] = useState<PropertyHeaderItem[]>(() => {
    const fromHtml = readPropertyBlockHeadersFromHtml(content)
    if (fromHtml.length > 0) return fromHtml
    if (htmlHasPropertyBlocks(content)) return []
    return propertyType ? [{ type: propertyType, name: '', from: -1 }] : []
  })
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const sync = () => {
      const fromDoc = readPropertyBlockHeadersFromDoc(editor.state.doc)
      let next = fromDoc
      if (fromDoc.length === 0) {
        let anyProp = false
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'propertyBlock') {
            anyProp = true
            return false
          }
          return true
        })
        next = !anyProp && propertyType ? [{ type: propertyType, name: '', from: -1 }] : []
      }
      setPropertyHeaders((prev) =>
        prev.length === next.length &&
        prev.every(
          (it, i) =>
            it.type === next[i].type && it.name === next[i].name && it.from === next[i].from
        )
          ? prev
          : next
      )
    }
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor, propertyType])
  useEffect(() => {
    onPropertyHeadersChange?.(propertyHeaders)
  }, [propertyHeaders, onPropertyHeadersChange])

  // Editable only when this frame is selected (and share role allows). Unselected = no iOS text loupe.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const next = canEdit && !!isPanelSelected
    if (editor.isEditable !== next) editor.setEditable(next)
    // Drop any caret / native selection when the frame becomes unselected
    if (!next && editor.view?.dom) {
      try {
        editor.commands.blur()
        window.getSelection()?.removeAllRanges()
      } catch {
        // ignore
      }
    }
  }, [editor, canEdit, isPanelSelected])

  // Phone: PM registers touchstart as {passive:true}, so handleDOMEvents cannot preventDefault.
  // Non-passive capture listener claims the tap → I-bar on first finger press (not second).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !isPanelSelected || !canEdit) return
    const dom = editor.view.dom as HTMLElement
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return // Pinch / multi-finger → board zoom/pan
      const target = e.target as HTMLElement | null
      // Preview / open / Notion / DB live inside TipTap NodeViews — preventDefault here kills
      // their click AND suppresses pointerdown for finger 1, so a later pinch never arms.
      if (
        target?.closest?.(
          '[data-tt-block-handle], [data-tt-insert-line], .block-actions-menu, [data-page-link-preview], .tt-database-block, .tt-notion-db'
        )
      ) {
        return // ⋮⋮ / insert line / board open / DB table own the gesture (pinch still arms)
      }
      e.preventDefault() // Requires non-passive — stops iOS focus-only first tap
      e.stopPropagation() // RF d3-drag listens for touchstart on the node
      selectOnlyClickRef.current = false
      const t = e.touches[0]
      try {
        const hit = editor.view.posAtCoords({ left: t.clientX, top: t.clientY })
        if (hit != null && hit.pos >= 0) {
          const sel = TextSelection.near(editor.state.doc.resolve(hit.pos))
          editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView())
        }
        editor.view.focus()
      } catch {
        try {
          editor.view.focus()
        } catch {
          /* ignore */
        }
      }
    }
    dom.addEventListener('touchstart', onTouchStart, { passive: false, capture: true })
    return () => dom.removeEventListener('touchstart', onTouchStart, { capture: true })
  }, [editor, isPanelSelected, canEdit])

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
        // Text range only — NodeSelection on boardLink/databaseBlock is from≠to and must NOT
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
      // While RF is dragging the frame, never setContent AND never consume a force-sync key
      // (consuming here dropped the post-drag restore and left row cards empty until a 2nd drag).
      if (suspendContentSync || dragSuspendRef?.current) return
      if (forceContentSyncKey !== lastAiForceSyncRef.current) {
        lastAiForceSyncRef.current = forceContentSyncKey
      }
      // Compare DOCUMENTS, not HTML strings. The boardLink NodeView adds a class and TipTap emits
      // attributes in its own order, so editor.getHTML() never byte-equals the stored HTML once a
      // boardLink exists — a raw string compare re-ran setContent every sync (infinite loop / page
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
      // Same Notion DB atom already in the editor — skip setContent (avoids table remount on drag-end)
      if (differs && hasDatabaseBlockHtml(content)) {
        const propId = content.match(/data-notion-database-id=["']([^"']+)["']/i)?.[1]
        let editorId: string | null = null
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'databaseBlock') {
            editorId = (node.attrs.notionDatabaseId as string) || null
            return false
          }
          return true
        })
        if (propId && editorId && propId.replace(/-/g, '') === editorId.replace(/-/g, '')) {
          differs = false
        }
      }
      // Row card / atom frames: editor may look “eq” after a remount stripped propertyBlocks — force restore
      if (hasFrameAtomHtml(content)) {
        const live = editor.getHTML()
        const lostProps =
          countPropertyBlocks(content) > 0 && countPropertyBlocks(live) < countPropertyBlocks(content)
        const lostAtoms = !hasFrameAtomHtml(live) || isBlockContentEmpty(live)
        if (lostProps || lostAtoms) differs = true
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
    if (e.button !== 0) return // Right-click is the frame menu, not an I-bar
    // Unselected: never place caret — RF selects/drags the frame first
    if (!isPanelSelected) return
    // Same gesture that just selected the frame / armed a nest — no I-bar
    if (selectOnlyClickRef.current) {
      selectOnlyClickRef.current = false
      return
    }
    e.stopPropagation()
    if (editor.isDestroyed) return
    // Sync in this tap — setTimeout(0) broke iOS: first tap focused nothing, second placed I-bar
    try {
      // Always resolve against click coords so empty lines get the caret (not doc start/end)
      const posResult = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (posResult != null && posResult.pos >= 0) {
        editor.chain().focus().setTextSelection(posResult.pos).run()
        return
      }
    } catch {
      /* fall through */
    }
    editor.commands.focus()
  }, [editor, isPanelSelected])

  // Extract 'inline' from className if present to apply inline-block display
  const isInline = className?.includes('inline')
  const otherClasses = className?.replace(/\binline\b/g, '').trim()
  // Keep the load shell until it finishes fading — TipTap mounts under it (immediatelyRender: false)
  const [keepShimmer, setKeepShimmer] = useState(
    () => !!loadCrossfade && !!enableBlockHandles && !isFlashcard && !editor // Load shells only — not new fadeIn frames
  )
  const [shimmerExiting, setShimmerExiting] = useState(false) // Opacity 1→0 once the editor exists
  const showFrameShimmer = !!enableBlockHandles && !isFlashcard && (!editor || keepShimmer) // Mount shell, then load overlay
  const shimmerHasText = frameHasVisibleText(content) // Text lines vs solid box (empty / spaces)

  useEffect(() => {
    if (!editor || !keepShimmer) return // Nothing to fade, or already gone
    if (!enableBlockHandles || isFlashcard || !loadCrossfade) {
      setKeepShimmer(false) // Chat/flashcard/new frames never overlay a load shell
      return
    }
    setShimmerExiting(true) // Fade the shell out as real blocks are on screen
    const t = window.setTimeout(() => setKeepShimmer(false), BOARD_LOAD_FADE_MS) // Unmount after the CSS fade
    return () => window.clearTimeout(t)
  }, [editor, enableBlockHandles, isFlashcard, keepShimmer, loadCrossfade])

  if (!editor && (!enableBlockHandles || isFlashcard)) return null // Chat/flashcard keep prior null mount

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-visible w-full', // Full frame content width so short/empty blocks stretch
        // Unselected → grab (drag frame); selected → text caret; flashcards keep pointer
        isFlashcard ? 'cursor-pointer' : isPanelSelected ? 'cursor-text' : 'cursor-grab',
        !isPanelSelected && 'tt-frame-unselected', // CSS: no text select / callout until selected
        // Selected: nodrag on the whole editor chrome so padding taps don't start RF drag either
        isPanelSelected && !isFlashcard && 'nodrag nopan',
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
      {editor ? <SelectionFormatPopupAnchor editor={editor} containerRef={containerRef} /> : null}

      {/* Apply shimmer animation to prompt text when response is loading (not for flashcards) */}
      <div
        className={cn(
          'relative w-full overflow-visible', // Grips sit in the panel’s left chrome (negative left)
          isLoading && !isFlashcard && 'shimmer'
        )}
      >
        {editor ? (
          <div>
            {/* Unselected: icons stay in the fill. Selected: host paints them in the top chrome band. */}
            {!chromeBandsOutside &&
              propertyHeaders.length > 0 &&
              enableBlockHandles &&
              !isFlashcard &&
              !showFrameShimmer && (
                <div className="w-full min-w-0 overflow-hidden" data-tt-property-band>
                  <FramePropertyGroup items={propertyHeaders} editor={editor} />
                </div>
              )}
            {/* ⋮⋮ paints outside the fill (negative left into panel chrome); no pl-6 inside the frame.
                Keep mounted during RF drag (invisible) — unmounting mid-drag remounted atom NodeViews. */}
            <div
              className={cn(suspendContentSync && 'invisible pointer-events-none')}
              aria-hidden={suspendContentSync || undefined}
            >
              <TipTapBlockHandles
                editor={editor}
                enabled={enableBlockHandles && showBlockHandles && !isFlashcard}
                isPanelSelected={!!isPanelSelected}
                hostNodeId={hostNodeId}
                conversationId={conversationId}
                hostMessageId={hostMessageId}
                boardInTargets={boardInTargets}
                onPageTurnInto={onPageTurnInto}
                onPropertyTurnInto={onPropertyTurnInto}
                notionConnected={notionConnected}
                notionSync={notionSync}
                onNotionConnection={onNotionConnection}
                contentPadLeft={contentPadLeft}
                frameScale={frameScale}
                handleGutterFlow={handleGutterFlow}
              />
            </div>
            <EditorContent
              editor={editor}
              className={cn('block w-full', isPanelSelected && 'nodrag nopan')}
            />
          </div>
        ) : null}
        {showFrameShimmer ? (
          <div
            className={cn(
              editor && 'absolute inset-0 z-[1]',
              shimmerExiting && 'tt-board-load-fade-out'
            )}
            aria-hidden={!!editor}
          >
            <FrameContentShimmer
              hasText={shimmerHasText}
              barCount={shimmerBarCountFromHtml(content)}
              withGutter={false} // Gutter is panel chrome, not inside the fill shell
              style={
                !editor && !shimmerHasText
                  ? { width: BLOCK_LOCKED_MIN_W, height: BLOCK_MIN_FRAME_H, minWidth: BLOCK_LOCKED_MIN_W }
                  : undefined
              }
            />
          </div>
        ) : null}
        {/* Connections: unselected stay in the fill; selected → host bottom chrome band */}
        {!chromeBandsOutside &&
          notionConnected &&
          enableBlockHandles &&
          !isFlashcard &&
          !showFrameShimmer &&
          (pinConnectionsToFrame ? (
            <div className="h-7" aria-hidden data-tt-notion-hug />
          ) : (
            <FrameConnectionsGroup
              notionSync={notionSync}
              onNotionConnection={onNotionConnection}
            />
          ))}
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
  const handleNotionConnection = useCallback(async (next: { connected: boolean; sync?: NotionSyncMode }) => {
    if (!promptMessage?.id) return // No row to patch
    const existing = { ...((promptMessage.metadata as Record<string, unknown>) || {}) } // Keep other frame meta
    if (!next.connected) {
      existing.notionConnected = false // Explicit unlink
      delete existing.notionSync
    } else {
      existing.notionConnected = true
      existing.notionSync = next.sync === 'manual' ? 'manual' : 'live'
    }
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                promptMessage: { ...promptMessage, metadata: existing },
              },
            }
          : n
      )
    )
    try {
      await supabase.from('messages').update({ metadata: existing }).eq('id', promptMessage.id)
    } catch (err) {
      console.error('Failed to save Notion connection:', err)
    }
  }, [promptMessage, setNodes, id, supabase])
  // Turn into → Property: stamp propertyType on the host frame (top icon only).
  // First-time apply shifts the frame up by PROPERTY_GROUP_H so block text stays where it was.
  const handlePropertyTurnInto = useCallback(
    async (nextType: PropertyTypeId) => {
      if (!promptMessage?.id) return // No row to patch
      const existing = { ...((promptMessage.metadata as Record<string, unknown>) || {}) }
      const firstProperty = readFramePropertyType(existing) == null // Only shift when the strip is new
      existing.propertyType = nextType // Persist chosen Property pane type
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n
          const nextPos = firstProperty
            ? { x: n.position.x, y: n.position.y - PROPERTY_GROUP_H } // Keep text on the original I-bar / line
            : n.position
          if (firstProperty) existing.position = nextPos // Persist board placement with the strip
          return {
            ...n,
            position: nextPos,
            data: {
              ...n.data,
              promptMessage: { ...promptMessage, metadata: { ...existing } },
            },
          }
        })
      )
      try {
        await supabase.from('messages').update({ metadata: existing }).eq('id', promptMessage.id)
      } catch (err) {
        console.error('Failed to save frame property type:', err)
      }
    },
    [promptMessage, setNodes, id, supabase]
  )
  const updateNodeInternals = useUpdateNodeInternals() // Remeasure auto-sized frames without setNodes (avoids RO→setNodes storms)
  const rfStoreApi = useStoreApi() // Unselect legacy wrapper before RF snapshots dragItems (frame-body drag)
  // Zoom only drives selected-frame chrome. Unselected frames return a constant so pinch/pan
  // does not re-render TipTap + large Notion DB tables every tick (phone Safari OOM over tunnel).
  // While pinching, navigationZoom freezes the value so chrome doesn’t re-render mid-gesture.
  const rfZoom = useStore((s) => {
    if (!selected) return 1
    return navigationZoom(Math.round((s.transform[2] || 1) * 8) / 8)
  })
  const [promptHasChanges, setPromptHasChanges] = useState(false)
  const [responseHasChanges, setResponseHasChanges] = useState(false)
  // Single text body: plain-merge legacy prompt + response (no section split).
  // Legacy: sole databaseBlock → boardLink when linkedBoardId exists (pages only).
  // Notion DB frames / board bodies keep the live databaseBlock (row→card must not wipe the table).
  const [promptContent, setPromptContent] = useState(() => {
    if (isProjectBoard) return data.boardTitle || ''
    const responseRaw = data.responseMessage?.content
    const responseHtml = responseRaw ? formatResponseContent(responseRaw) : ''
    const merged = mergePanelHtml(data.promptMessage?.content, responseHtml)
    const meta = (data.promptMessage?.metadata || {}) as Record<string, unknown>
    if (isBoardBodyMeta(meta) || meta.notionObject === 'database') return merged
    const linkedId = getLinkedBoardId(meta)
    if (!linkedId) return merged
    const iconMeta = meta.notionIcon as { type?: string; emoji?: string } | null
    const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
    return (
      migrateSoleDatabaseBlockToBoardLink(merged, {
        boardId: linkedId,
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

  // Seed at plain-text hug (grip+3ch × one line) — boardLink floor inflated empty frames before first measure
  const [intrinsicSize, setIntrinsicSize] = useState({ width: BLOCK_LOCKED_MIN_W, height: BLOCK_MIN_FRAME_H })
  const [intrinsicMeasured, setIntrinsicMeasured] = useState(false) // True after first contentFit measure (avoid hug flash)
  const [isFrameHovering, setIsFrameHovering] = useState(false) // Frame hover — page-open menu (not lock/rotate)
  const [clipPreviewReady, setClipPreviewReady] = useState(false) // True after hover dwell — delayed full-content peek
  const [rotation, setRotation] = useState(0) // Degrees of item rotation (persisted in message metadata)
  const [frameShape, setFrameShape] = useState<FrameShapeType | null>(null) // Silhouette (null = default frame)
  const [chromePropertyHeaders, setChromePropertyHeaders] = useState<PropertyHeaderItem[]>([])
  const propBandRef = useRef<HTMLDivElement>(null) // Top property band — width cap for pagination
  const [propBandWidth, setPropBandWidth] = useState(0) // Measured band px (pre screenChromeScale)
  const isResizingRef = useRef(false) // Track if currently resizing
  const contentFitRef = useRef<HTMLDivElement>(null) // Inner unscaled content wrapper for intrinsic measure
  const frameScaleRef = useRef(1) // Latest scale — resize-end must not close over a stale render
  frameScaleRef.current = frameScale // Keep ref in sync every render
  const frameUnlockedRef = useRef(frameUnlocked) // Live lock — resize callbacks stay identity-stable
  frameUnlockedRef.current = frameUnlocked // Sync every render so d3-drag can read without rebinding
  const frameTextWrapRef = useRef(frameTextWrap) // Live wrap flag for the same stable resize handlers
  frameTextWrapRef.current = frameTextWrap
  const wrapColWidthRef = useRef(wrapColWidth) // Live wrap columns — locked proportional math
  wrapColWidthRef.current = wrapColWidth
  const rotationRef = useRef(rotation) // Live frame rotation for AABB → content size
  rotationRef.current = rotation
  const promptContentRef = useRef(promptContent) // Live HTML for min-width during a drag
  promptContentRef.current = promptContent
  const intrinsicSizeRef = useRef(intrinsicSize) // Live unscaled content box for locked-wrap height
  intrinsicSizeRef.current = intrinsicSize
  const fontScaleRef = useRef(fontScale) // Persist on resize-end without closing over a stale callback
  fontScaleRef.current = fontScale
  const resizeRafRef = useRef<number | null>(null) // Coalesce live resize setState to one paint
  const pendingResizeRef = useRef<{ width: number; height: number; scale?: number } | null>(null) // Last drag sample waiting for rAF
  const persistFrameMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Debounce hug-to-text saves
  const lockedResizeStartRef = useRef<{ width: number; height: number; scale: number } | null>(null) // Locked drag baseline
  const initialResizeWidthRef = useRef<number | null>(null) // Track initial panel width when resize starts (for note panels)
  const initialResizeHeightRef = useRef<number | null>(null) // Track initial panel height when resize starts (for note panels)
  const initialTextWidthRef = useRef<number | null>(null) // Track initial TEXT content width (for proper fill scaling)
  const isFirstResizeCallRef = useRef(true) // Track if this is the first resize call in the current session
  const initialTextAspectRatioRef = useRef<number | null>(null) // Track text's natural aspect ratio (width/height)
  const hasLoadedResizeStateRef = useRef(false) // Track if we've already loaded and applied resize state from metadata
  const isRotatingRef = useRef(false) // True while pointer-dragging the rotation handle
  // Pointer math for live rotate — pivot is frozen at gesture start (left-locked AABB would drift center)
  const rotationDragRef = useRef<{
    startAngle: number
    startRotation: number
    pivotX: number
    pivotY: number
  } | null>(null)

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

  // Calculate panel background color
  // Notion-style pastels are stored as-is (full color); empty = transparent
  const panelBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return data.fillColor // Solid wash — pastels read correctly (0.15 made them invisible)
    }
    return 'transparent'
  }, [data.fillColor])

  // Calculate prompt/grey area background color — inherit frame fill when set
  const promptAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return data.fillColor
    }
    return 'transparent'
  }, [data.fillColor])

  // Calculate response/white area background color — inherit frame fill when set
  const responseAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return data.fillColor
    }
    return 'transparent'
  }, [data.fillColor])

  // Connection points: blue fill + white border (matches selection chrome blue-500)
  const handleColor = '#3b82f6'
  const handleHoverColor = '#2563eb' // Slightly darker on hover/active
  const handleBorderColor = '#ffffff'

  // Check if panel is minimal (transparent fill + no visible border)
  // When minimal and not selected, handles should be hidden
  // Empty borderColor = transparent; only explicit borderStyle 'none' hides a colored border
  const isFillTransparent = !data.fillColor || data.fillColor === '' || data.fillColor === null
  const isBorderColorTransparent =
    !data.borderColor || data.borderColor === '' || data.borderColor === null
  const isBorderNone =
    isBorderColorTransparent || data.borderStyle === 'none' // Color alone is enough to show a border
  // Empty frames (no text / atoms) get a soft grey outline so the box is findable on the board
  const showEmptyFrameBorder =
    isBlockContentEmpty(promptContent) && // Live TipTap HTML — flips off as soon as content lands
    isBorderColorTransparent && // User-set borderColor wins over empty chrome
    data.borderStyle !== 'none' && // Explicit "no border" stays invisible
    !frameShape // Silhouette stroke is the outline when shaped
  const emptyFrameBorderColor = resolvedTheme === 'dark' ? '#4b5563' : '#d1d5db' // Thin grey (gray-600 / gray-300)
  const isMinimalPanel = isFillTransparent && isBorderNone // Empty grey chrome does not count as styled
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

            // RF chrome size = upright AABB when rotated (content dims stay in resizeDimensions)
            const rot =
              typeof metadata.rotation === 'number' ? metadata.rotation : 0
            const shape = parseFrameShape(metadata.frameShape)
            const aabb =
              Math.abs(rot) > 0.5
                ? rotatedFrameAabbSize(dims.width, dims.height, rot, shape)
                : { width: dims.width, height: dims.height }
            const setNodesFunc = getSetNodes()
            if (setNodesFunc) {
              setNodesFunc((nodes: any[]) =>
                nodes.map((node: any) =>
                  node.id === id
                    ? {
                        ...node,
                        width: aabb.width,
                        height: aabb.height,
                        style: {
                          ...(node.style || {}),
                          width: aabb.width,
                          height: aabb.height,
                        },
                      }
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
  const { connected: notionConnected, sync: notionSync } = readNotionConnection(
    promptMessage?.metadata as Record<string, unknown> | undefined
  ) // Frame Connections → Notion
  const framePropertyType = readFramePropertyType(
    promptMessage?.metadata as Record<string, unknown> | undefined
  ) // Turn into → Property → top chrome

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
      const contentHtml =
        typeof promptMessage?.content === 'string' ? promptMessage.content : ''
      // Don't re-apply a post-drag stub size onto a live Notion database frame
      if (
        hasDatabaseBlockHtml(contentHtml) &&
        isCollapsedDatabaseFrameSize(dims.width, dims.height)
      ) {
        return
      }
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
  // Mid-press on the body — hide connection indicators only (resize / ⋮⋮ / rotate stay mounted)
  const [pressing, setPressing] = useState(false)
  // Full adjust chrome when selected + idle (not mid-drag / thread connect)
  const showAdjustFrame = Boolean(selected && isBlock && !isThreadConnecting && !dragging)
  // Transient blue outline while moving; selected frames keep `selected` and regain adjust chrome on release
  const showDragBorderOnly = Boolean(dragging && isBlock)
  // Blue-box L/R gutters when selected. Property / connections bands sit OUTSIDE the fill
  // — only while selected (hide entirely when the frame is idle).
  const showFrameChrome = Boolean(isBlock && (selected || dragging) && !isThreadConnecting)
  const hasPropBand = Boolean(showFrameChrome && chromePropertyHeaders.length > 0)
  const hasConnBand = Boolean(showFrameChrome && notionConnected && isBlock && !isFlashcard)
  // Screen-relative L/R gutter fits the ⋮⋮ (zoom comfort) — not × frameScale (that left empty
  // blue pad when grips counter-scaled). Grips use localGutter = adjustChromeX/chromeScale so
  // after contentFit CSS scale they still sit centered in this strip.
  const chromeScale =
    isBlock && isUserResized && frameScale !== 1 ? Math.max(0.15, frameScale) : 1
  // Cell radius is 6px inside contentFit’s CSS scale; fill + blue ring are outside — keep them matched
  const frameCornerRadius = frameShape ? 0 : FRAME_CORNER_RADIUS * chromeScale
  // Band height + L/R strip: ⋮⋮/property column + extra blue→content air (screen-relative)
  const screenChromeScale = frameScreenChromeScale(rfZoom || 1)
  // ⋮⋮ column only — grips size/center here (flush to fill); blue box is wider by ADJUST_CONTENT_GAP
  const handleGutterFlow = showFrameChrome
    ? Math.round(BLOCK_HANDLE_GUTTER_W * screenChromeScale)
    : 0
  const adjustChromeX = showFrameChrome
    ? Math.round((BLOCK_HANDLE_GUTTER_W + ADJUST_CONTENT_GAP_X) * screenChromeScale)
    : 0 // Blue→fill = handle column + extra gap (tighter on L/R)
  const chromeBandH = Math.round(
    (CONNECTIONS_GROUP_H + ADJUST_CONTENT_GAP_Y) * screenChromeScale
  ) // Property / connections strip + T/B blue→content air
  const chromePadX = Math.round(BLOCK_FRAME_PAD_X * chromeScale) // Band inset matches scaled fill pad
  // T/B bands only while selected — even empty strips keep the blue box balanced
  const adjustChromeYTop = showFrameChrome ? chromeBandH : 0
  const adjustChromeYBottom = showFrameChrome ? chromeBandH : 0
  useLayoutEffect(() => {
    const el = propBandRef.current
    if (!el || !hasPropBand) {
      setPropBandWidth(0)
      return
    }
    const sync = () => setPropBandWidth(el.clientWidth)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasPropBand, adjustChromeX, chromePadX, screenChromeScale]) // Re-measure when frame chrome insets change
  // Keep the filled frame glued when selection chrome appears/disappears (grow left/up).
  // Do NOT shift RF position when chrome scale changes with zoom — that deferred setNodes
  // jumped the frame (looked like the board slid) after phone pinch over DB tables.
  const frameChromeOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!isBlock) return
    const wantX = showFrameChrome ? adjustChromeX : 0
    const wantY = showFrameChrome ? adjustChromeYTop : 0
    const prev = frameChromeOffsetRef.current
    const wasOn = prev.x > 0 || prev.y > 0
    const nowOn = wantX > 0 || wantY > 0
    // Still selected (or still idle): zoom only resizes chrome visually — leave node put
    if (wasOn === nowOn) return
    const dx = wantX - prev.x
    const dy = wantY - prev.y
    if (dx === 0 && dy === 0) return
    frameChromeOffsetRef.current = { x: wantX, y: wantY }
    const setNodesFunc = getSetNodes()
    if (!setNodesFunc) return
    setNodesFunc((nds: any[]) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, position: { x: n.position.x - dx, y: n.position.y - dy } }
          : n
      )
    )
    updateNodeInternals(id)
  }, [
    isBlock,
    id,
    showFrameChrome,
    adjustChromeX,
    adjustChromeYTop,
    getSetNodes,
    updateNodeInternals,
  ])
  // Stack/hide unmounts the node while chrome is still on — without this, RF keeps the
  // chrome-shifted XY and remount reapplies chrome → frame jumps up/left one gutter.
  useLayoutEffect(() => {
    if (!isBlock) return
    return () => {
      const applied = frameChromeOffsetRef.current // Chrome still baked into RF position
      if (applied.x === 0 && applied.y === 0) return
      frameChromeOffsetRef.current = { x: 0, y: 0 } // Remount starts from fill origin
      const setNodesFunc = getSetNodes()
      if (!setNodesFunc) return
      setNodesFunc((nds: any[]) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, position: { x: n.position.x + applied.x, y: n.position.y + applied.y } }
            : n
        )
      )
    }
  }, [isBlock, id, getSetNodes])
  // Stack lines: one per adjust-box side that has a mate further out on that side’s tree.
  // Equality fn is required — a fresh `[]` every store tick re-rendered every frame on pinch
  // (large Notion DB tables → phone Safari tab reload over tunnel).
  const stackMeta = (promptMessage?.metadata || {}) as Record<string, unknown>
  const stackGapSides = useStore(
    (s) => {
      const mine = readSideStacks(stackMeta)
      const sides: Array<{ side: FrameStackSide; groupId: string }> = []
      for (const side of FRAME_STACK_SIDES) {
        const entry = mine[side]
        if (!entry) continue
        const myIdx = entry.anchor ? 0 : entry.index
        let hasOut = false
        s.nodeInternals.forEach((n) => {
          if (n.id === id || n.type !== 'chatPanel') return
          const m = (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
          const other = readSideStacks(m)[side]
          if (!other || other.groupId !== entry.groupId) return
          const idx = other.anchor ? 0 : other.index
          if (idx > myIdx) hasOut = true
        })
        if (hasOut) sides.push({ side, groupId: entry.groupId })
      }
      return sides
    },
    (a, b) =>
      a.length === b.length &&
      a.every((x, i) => x.side === b[i].side && x.groupId === b[i].groupId)
  )

  // Indicators: selected frame (idle), OR nearby snap target while connecting — never during frame drag.
  // Mid-press on the *body* hides them (`pressing`); press on the indicator itself is excluded so
  // the simulator stays mounted and can arm the thread instead of RF frame-dragging.
  const showIndicators =
    isBlock &&
    !isFlashcard &&
    !dragging &&
    !pressing && // Body mid-press hides simulators; resize corners stay (onFrameChrome exclusion)
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

  // Outer indicator (DOM only) placement — center sits just outside the blue edge
  const connectionIndicatorStyle = (
    side: 'left' | 'right' | 'top' | 'bottom',
    out: number // Distance from frame edge to indicator center (flow px)
  ): React.CSSProperties => {
    if (side === 'left') return { left: -out, top: '50%', transform: 'translate(-50%, -50%)' }
    if (side === 'right') return { right: -out, top: '50%', transform: 'translate(50%, -50%)' }
    if (side === 'top') return { top: -out, left: '50%', transform: 'translate(-50%, -50%)' }
    return { bottom: -out, left: '50%', transform: 'translate(-50%, 50%)' }
  }
  
  // Measured frame box for chrome scale / AABB — seed at plain-text hug (not 200×120 card stub)
  const [itemBoxSize, setItemBoxSize] = useState({ width: BLOCK_LOCKED_MIN_W, height: BLOCK_MIN_FRAME_H })
  // In-place nested board for a titled item’s linked page
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false)
  const [pagePreviewMounted, setPagePreviewMounted] = useState(false) // Keep iframe warm after first open/hover
  const [previewTargetBoardId, setPreviewTargetBoardId] = useState<string | null>(null) // Which page the preview shows (boardLink or frame)
  const linkedBoardId = !isProjectBoard
    ? (getLinkedBoardId(promptMessage?.metadata as Record<string, unknown> | null) || undefined)
    : undefined
  const activePreviewBoardId = previewTargetBoardId || linkedBoardId || null // Page the shell renders
  const blockTitleLabel =
    (promptMessage?.metadata?.blockTitle as string | undefined) || ''
  // Notion deep link for Open in Notion in the shared page open menu
  const notionUrl =
    !isProjectBoard && typeof promptMessage?.metadata?.notionUrl === 'string'
      ? (promptMessage.metadata.notionUrl as string)
      : null
  const isBoardBody = isBoardBodyMeta(promptMessage?.metadata) // Body on its own page — no nested open menu
  // Frame already has a boardLink for this page → that NodeView owns the open menu
  const hasBoardLinkForFrame = !!(
    linkedBoardId &&
    (promptContent.includes(`data-board-id="${linkedBoardId}"`) ||
      promptContent.includes(`data-board-id='${linkedBoardId}'`) ||
      promptContent.includes(`data-page-id="${linkedBoardId}"`) ||
      promptContent.includes(`data-page-id='${linkedBoardId}'`))
  )
  // databaseBlock NodeView owns Preview/Open when this is a Notion DB frame
  const hasDatabaseBlockForFrame = /data-type=["']databaseBlock["']/i.test(promptContent)
  // Page frames whose content is still regular TipTap blocks (legacy title) need the menu too
  const showFrameBoardOpenMenu =
    !!linkedBoardId &&
    !isBoardBody &&
    !pagePreviewOpen &&
    !hasBoardLinkForFrame &&
    !hasDatabaseBlockForFrame &&
    (isFrameHovering || selected)

  // One-shot: legacy sole-databaseBlock map frames → boardLink (Notion **pages** only).
  // Notion databases keep the live table — remount after row→card must not wipe databaseBlock.
  // Nested board body / imported map boardLinks already have the right shape.
  const migratedDbFrameRef = useRef(false)
  useEffect(() => {
    if (migratedDbFrameRef.current || isProjectBoard || isBoardBody) return
    if (!promptMessage?.id || !conversationId) return
    if (hasBoardLinkForFrame) return
    const meta = (promptMessage.metadata as Record<string, unknown>) || {}
    if (meta.notionObject === 'database') return // Live table stays on this frame / board body
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

        // Fast path: linkedBoardId already known → rewrite HTML locally + persist
        if (linkedBoardId) {
          const iconMeta = promptMessage.metadata?.notionIcon as { type?: string; emoji?: string } | null
          const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
          const next = migrateSoleDatabaseBlockToBoardLink(sourceHtml, {
            boardId: linkedBoardId,
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
              metadata: { ...existingMeta, isBoard: true, blockType: 'board' },
            })
            .eq('id', promptMessage.id)
          setPromptHasChanges(false)
          await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
          return
        }

        // Slow path: no linkedBoardId yet — resolve/create nested page then rewrite
        const result = await ensureNotionMapFrameIsBoardLink(client, {
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
        console.error('Failed to migrate Notion DB frame to boardLink:', err)
        migratedDbFrameRef.current = false
      }
    })()
  }, [
    isProjectBoard,
    isBoardBody,
    linkedBoardId,
    promptMessage?.id,
    promptMessage?.content,
    promptMessage?.metadata,
    hasBoardLinkForFrame,
    promptContent,
    blockTitleLabel,
    conversationId,
    queryClient,
  ])

  // One-shot: board/boardIn frames must be sole boardLink — repair sibling leak from prepend-only sync.
  // Never peel a live Notion databaseBlock or Card-view frames (boardLink + property cells).
  const repairedBoardFrameRef = useRef(false)
  useEffect(() => {
    if (repairedBoardFrameRef.current || isProjectBoard || isBoardBody) return
    if (!promptMessage?.id || !linkedBoardId) return
    const meta = (promptMessage.metadata as Record<string, unknown>) || {}
    if (meta.notionObject === 'database') return
    if (meta.dbLayout === 'card') return // Row→card frames keep title + property cells
    const bt = typeof meta.blockType === 'string' ? meta.blockType : ''
    if (bt !== 'board' && bt !== 'boardIn' && bt !== 'page' && bt !== 'pageIn') return
    const serverContent = promptMessage.content || ''
    const source = !isSoleBoardLinkContent(serverContent)
      ? serverContent
      : !isSoleBoardLinkContent(promptContent)
        ? promptContent
        : null
    if (!source) return
    if (isSoleDatabaseBlockContent(source)) return // Keep live table; do not rewrite to boardLink
    // Property cells on a board frame are intentional (Card view) — not sibling leak
    if (/data-type=["']propertyBlock["']/i.test(source)) return

    repairedBoardFrameRef.current = true
    void (async () => {
      try {
        const client = createClient()
        const { data: auth } = await client.auth.getUser()
        const userId = auth.user?.id
        if (!userId) {
          repairedBoardFrameRef.current = false
          return
        }
        const result = await repairBoardFrameToSoleLink(client, {
          messageId: promptMessage.id,
          userId,
          content: source,
          metadata: meta,
        })
        if (!result) {
          repairedBoardFrameRef.current = false
          return
        }
        setPromptContent(result.content)
        setAiForceSyncKey((k) => k + 1) // Swap TipTap even if focused
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', linkedBoardId] })
      } catch (err) {
        console.error('Failed to repair board frame to sole boardLink:', err)
        repairedBoardFrameRef.current = false
      }
    })()
  }, [
    isProjectBoard,
    isBoardBody,
    linkedBoardId,
    promptMessage?.id,
    promptMessage?.content,
    promptMessage?.metadata,
    promptContent,
    conversationId,
    queryClient,
  ])

  // One-shot: board-body must not duplicate the board name as its only/first block
  const cleanedTitleBodyRef = useRef(false)
  useEffect(() => {
    if (cleanedTitleBodyRef.current || !isBoardBody || isProjectBoard) return
    if (!promptMessage?.id || !conversationId) return
    const title =
      (blockTitleLabel || '').trim() ||
      (typeof promptMessage.metadata?.blockTitle === 'string'
        ? promptMessage.metadata.blockTitle.trim()
        : '')
    if (!title) return
    const source = promptMessage.content || promptContent || ''
    // Never strip a live Notion database atom as if it were a title line
    if (isSoleDatabaseBlockContent(source) || /data-type=["']databaseBlock["']/i.test(source)) {
      return
    }
    const cleaned = bodyHtmlWithoutBoardTitle(source, title)
    if (cleaned === source.trim()) return // Already free of a title-line duplicate

    cleanedTitleBodyRef.current = true
    void (async () => {
      try {
        const client = createClient()
        if (isBlockContentEmpty(cleaned)) {
          // Title-only body → remove the frame; name stays on conversations.title
          await client.from('messages').delete().eq('id', promptMessage.id)
          const { data: page } = await client
            .from('conversations')
            .select('metadata')
            .eq('id', conversationId)
            .maybeSingle()
          if (page) {
            const meta = (page.metadata as Record<string, unknown>) || {}
            await client
              .from('conversations')
              .update({ metadata: { ...meta, hasContent: false } })
              .eq('id', conversationId)
          }
        } else {
          await client.from('messages').update({ content: cleaned }).eq('id', promptMessage.id)
          setPromptContent(cleaned)
          setAiForceSyncKey((k) => k + 1)
        }
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      } catch (err) {
        console.error('Failed to strip board title from board-body:', err)
        cleanedTitleBodyRef.current = false
      }
    })()
  }, [
    isBoardBody,
    isProjectBoard,
    promptMessage?.id,
    promptMessage?.content,
    promptMessage?.metadata,
    promptContent,
    blockTitleLabel,
    conversationId,
    queryClient,
  ])

  // One-shot: restore Notion DB table if migrate/repair wiped databaseBlock (empty / sole boardLink)
  const restoredDbBlockRef = useRef(false)
  useEffect(() => {
    if (restoredDbBlockRef.current || isProjectBoard) return
    if (!promptMessage?.id || !conversationId) return
    const meta = (promptMessage.metadata as Record<string, unknown>) || {}
    const serverContent = promptMessage.content || ''
    const healed = restoreWipedDatabaseBlockHtml(serverContent, meta)
    if (!healed) return

    restoredDbBlockRef.current = true
    void (async () => {
      try {
        const client = createClient()
        await client.from('messages').update({ content: healed }).eq('id', promptMessage.id)
        setPromptContent(healed)
        setAiForceSyncKey((k) => k + 1)
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      } catch (err) {
        console.error('Failed to restore wiped Notion databaseBlock:', err)
        restoredDbBlockRef.current = false
      }
    })()
  }, [
    isProjectBoard,
    promptMessage?.id,
    promptMessage?.content,
    promptMessage?.metadata,
    conversationId,
    queryClient,
  ])

  // Warm lean embed document (and mount hidden iframe) so first nav isn’t a cold boot
  const prefetchPagePreview = () => {
    if (!linkedBoardId) return
    prefetchBoardEmbed(linkedBoardId)
    router.prefetch(`/embed/${linkedBoardId}`)
    setPagePreviewMounted(true)
  }

  // Actions handed to boardLink NodeViews (open/close preview, open page, prefetch, rename, Notion)
  const boardLinkActions = useMemo<BoardLinkActions>(
    () => ({
      previewBoardId: pagePreviewOpen ? activePreviewBoardId : null,
      openPreview: (pid: string) => {
        setPreviewTargetBoardId(pid) // Point the shared shell at this child page
        setPagePreviewMounted(true)
        setPagePreviewOpen(true)
      },
      closePreview: () => setPagePreviewOpen(false),
      openBoard: (pid: string) => router.push(`/board/${pid}`),
      prefetch: (pid: string) => {
        prefetchBoardEmbed(pid)
        router.prefetch(`/embed/${pid}`)
        setPagePreviewMounted(true)
      },
      renameTitle: async (pid: string, title: string) => {
        try {
          const supabase = createClient()
          await supabase.from('conversations').update({ title: boardTitleOrDefault(title) }).eq('id', pid)
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
      // DB / legacy titled frames (no boardLink NodeView) reuse this for BoardOpenMenu
      hostLinkedBoardId: hasBoardLinkForFrame ? null : linkedBoardId || null,
      hostMessageId: promptMessage?.id || null, // Convert layout from DB table / row ⋮⋮
      conversationId: conversationId || null,
    }),
    [
      pagePreviewOpen,
      activePreviewBoardId,
      router,
      queryClient,
      notionUrl,
      hasBoardLinkForFrame,
      linkedBoardId,
      promptMessage?.id,
      conversationId,
    ]
  )

  // Update title-chip perimeter when the note/item box changes size
  useEffect(() => {
    if (!isBlock || !panelRef.current) return
    const updateFromSize = () => {
      if (!panelRef.current) return
      const width = panelRef.current.offsetWidth || BLOCK_LOCKED_MIN_W
      const height = panelRef.current.offsetHeight || BLOCK_MIN_FRAME_H
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

  const hugFreezeUntilRef = useRef(0) // Skip hug that would shrink atom frames right after drag
  const frameDragSuspendRef = useRef(false) // Sync — onUpdate must see this before React re-renders

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
        if (isResizingRef.current) return // Corner-drag owns size — hug RO would hitch the gesture (esp. phone)
        if (Date.now() < hugFreezeUntilRef.current) return // Post-drag: wait for property NodeViews
        if (isBoardNavigating()) return // Pinch freeze silhouette — don’t hug to stub size
        // databaseBlock: wait until the Notion table NodeView is mounted. Measuring the title
        // stub (~52×40) after a remount would hug-shrink the frame and clip the table away.
        const dbHost = el.querySelector('.tt-database-block') as HTMLElement | null
        if (dbHost && !dbHost.querySelector('.tt-notion-db')) return
        // Row card: wait until property cells remount after drag-end setContent (first-drag hug
        // otherwise collapses to grip+I-bar; a second drag remeasured and “brought it back”).
        const expectProps = countPropertyBlocks(promptContent)
        if (expectProps > 0) {
          const liveProps = el.querySelectorAll('.tt-property-block').length
          if (liveProps < expectProps) return
        }
        if (hasFrameAtomHtml(promptContent) && !el.querySelector('.tt-board-link, .tt-database-block, .tt-property-block')) {
          return
        }
        const width = Math.max(1, Math.round(measureNaturalContentWidth(el)))
        const height = Math.max(1, Math.round(measureNaturalContentHeight(el)))
        if (
          (dbHost || hasDatabaseBlockHtml(promptContent)) &&
          isCollapsedDatabaseFrameSize(width, height)
        ) {
          return // Reject collapsed stub measures
        }
        // Row cards: reject post-drag stub hugs (grip + empty line)
        if (
          expectProps > 0 &&
          (width < 120 || height < Math.min(80, 24 * expectProps))
        ) {
          return
        }
        // Never shrink a row card to ≤ half its last good size (Empty-stub race).
        // Do NOT apply this to databaseBlock tables — offsetWidth feedback used to lock a huge box.
        const prev = intrinsicSizeRef.current
        if (
          isRowCardAtomHtml(promptContent) &&
          prev.width > 80 &&
          prev.height > 40 &&
          (width < prev.width * 0.5 || height < prev.height * 0.5)
        ) {
          return
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

  // After frame drag: restore atom HTML only if the editor actually lost atoms.
  // Always force-setContent remounted property NodeViews → hug measured Empty stubs → first-drag collapse.
  const wasDraggingRef = useRef(false)
  const preDragContentRef = useRef<string | null>(null)
  const draggingRef = useRef(!!dragging)
  draggingRef.current = !!dragging
  // promptContentRef already declared above (live HTML for min-width during drag)
  const [dragAtomGuard, setDragAtomGuard] = useState(false)
  // Outer panel px snapshot — atom frames use fit-content and collapse when NodeViews remount on first drag
  const [layoutBoxFreeze, setLayoutBoxFreeze] = useState<{ width: number; height: number } | null>(
    null
  )
  useEffect(() => {
    // Layout freeze is for row cards only — DB tables hug via max-content (zIndex fix covers vanish)
    if (!isBlock || !isRowCardAtomHtml(promptContent)) return
    const panel = panelRef.current
    if (!panel) return
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      // Arm for selected + unselected — selected cards drag via chrome; state alone is too late
      frameDragSuspendRef.current = true
      setDragAtomGuard(true)
      const w = Math.round(panel.offsetWidth)
      const h = Math.round(panel.offsetHeight)
      // Freeze CSS box before select+drag remounts property NodeViews (fit-content → 0)
      if (w > 40 && h > 20) setLayoutBoxFreeze({ width: w, height: h })
    }
    const onUp = () => {
      // RF still owns the gesture — clear only after drag-end restore (below)
      if (draggingRef.current || wasDraggingRef.current) return
      frameDragSuspendRef.current = false
      setDragAtomGuard(false)
      setLayoutBoxFreeze(null)
    }
    panel.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      panel.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [isBlock, promptContent])

  // Drop a leftover layout freeze if this isn’t a row card (DB must not keep a bloated box)
  useEffect(() => {
    if (!isRowCardAtomHtml(promptContent) && layoutBoxFreeze) setLayoutBoxFreeze(null)
  }, [promptContent, layoutBoxFreeze])

  useEffect(() => {
    if (dragging) {
      if (!wasDraggingRef.current) {
        const msg =
          typeof promptMessage?.content === 'string' ? promptMessage.content : ''
        const live = promptContentRef.current || ''
        const score = (html: string) =>
          (hasFrameAtomHtml(html) ? 100 : 0) + countPropertyBlocks(html)
        // Prefer the richer atom HTML (message can lag behind a fresh convert)
        preDragContentRef.current =
          score(msg) >= score(live) && msg ? msg : live || msg || null
        frameDragSuspendRef.current = true
        setDragAtomGuard(true)
        // Row-card layout freeze only — DB tables must keep hugging the table columns
        if (isRowCardAtomHtml(live) || isRowCardAtomHtml(msg)) {
          const panel = panelRef.current
          if (panel) {
            const w = Math.round(panel.offsetWidth)
            const h = Math.round(panel.offsetHeight)
            if (w > 40 && h > 20) setLayoutBoxFreeze({ width: w, height: h })
          }
        }
      }
      wasDraggingRef.current = true
      return
    }
    if (!wasDraggingRef.current) return
    wasDraggingRef.current = false
    const frozen = preDragContentRef.current
    preDragContentRef.current = null
    hugFreezeUntilRef.current = Date.now() + 450

    const clearFreezeSoon = () => {
      window.setTimeout(() => setLayoutBoxFreeze(null), 450)
    }

    // If TipTap still has the card atoms, do NOT setContent (remount → Empty stubs → hug collapse)
    let editorHtml = ''
    try {
      const ed = promptEditorRef.current
      if (ed && !ed.isDestroyed) editorHtml = ed.getHTML()
    } catch {
      editorHtml = ''
    }
    const expectProps = frozen ? countPropertyBlocks(frozen) : 0
    const editorOk =
      hasFrameAtomHtml(editorHtml) &&
      !isBlockContentEmpty(editorHtml) &&
      (expectProps === 0 || countPropertyBlocks(editorHtml) >= expectProps)
    if (editorOk) {
      if (editorHtml && editorHtml !== promptContentRef.current) {
        setPromptContent(editorHtml)
      }
      frameDragSuspendRef.current = false
      setDragAtomGuard(false)
      clearFreezeSoon()
      return
    }

    const restore =
      (frozen && hasFrameAtomHtml(frozen) ? frozen : null) ||
      (hasFrameAtomHtml(promptContent) ? promptContent : null) ||
      (typeof promptMessage?.content === 'string' && hasFrameAtomHtml(promptMessage.content)
        ? promptMessage.content
        : null)
    if (!restore) {
      frameDragSuspendRef.current = false
      setDragAtomGuard(false)
      clearFreezeSoon()
      return
    }
    if (restore !== promptContent) setPromptContent(restore)
    // Keep suspend until force-sync applies, then clear
    const t = window.setTimeout(() => {
      setAiForceSyncKey((k) => k + 1)
      frameDragSuspendRef.current = false
      setDragAtomGuard(false)
      clearFreezeSoon()
    }, 0)
    return () => window.clearTimeout(t)
  }, [dragging, promptContent, promptMessage?.content])

  // Regular chat panels are those that are not flashcards and not notes
  const isRegularChatPanel = !isFlashcard && !isBlock

  // Explicit box → RF node style. NEVER drive this from ResizeObserver: RF also writes measured
  // node.width/height, so RO→setNodes fights those numbers and allocates a new nodes[] every tick
  // (LOOP-DIAG: nodes(ref) len N→N). Push when resizeDimensions or rotation (AABB) change.
  // Rotated: RF size = upright AABB so blue adjust chrome tracks live; left edge stays locked.
  // Snap mates repark against that AABB so side-stacks ride rotation (not only the blue box).
  const lastPushedBoxRef = useRef<{ w: number; h: number; rot: number } | null>(null)
  const resizeDimensionsRef = useRef(resizeDimensions)
  resizeDimensionsRef.current = resizeDimensions
  const frameShapeRef = useRef(frameShape)
  frameShapeRef.current = frameShape

  /** Push host AABB + repark snap/stack mates for `rot` (live rotate + effect). */
  const pushAabbAndSnapMates = useCallback(
    (rot: number, opts?: { forceMates?: boolean }) => {
      const dims = resizeDimensionsRef.current
      if (!isBlock || !dims) return
      const aabb =
        Math.abs(rot) > 0.5
          ? rotatedFrameAabbSize(dims.width, dims.height, rot, frameShapeRef.current)
          : { width: dims.width, height: dims.height }
      const boxW = Math.ceil(aabb.width)
      const boxH = Math.ceil(aabb.height)
      const prev = lastPushedBoxRef.current
      const sizeSame =
        !!prev && Math.abs(prev.w - boxW) <= 1 && Math.abs(prev.h - boxH) <= 1
      const rotSame = !!prev && Math.abs(prev.rot - rot) < 0.05
      // Skip only when AABB + angle unchanged (mates already parked for this box)
      if (sizeSame && rotSame && !opts?.forceMates) return
      lastPushedBoxRef.current = { w: boxW, h: boxH, rot }
      // Keep the panel DOM in sync (defeats stale inline widths from line-grow helpers)
      if (panelRef.current && Math.abs(rot) > 0.5) {
        panelRef.current.style.width = `${boxW}px`
        panelRef.current.style.height = `${boxH}px`
        panelRef.current.style.maxWidth = `${boxW}px`
        panelRef.current.style.maxHeight = `${boxH}px`
      }
      const setNodesFunc = getSetNodes()
      if (!setNodesFunc) return
      setNodesFunc((nodes: any[]) => {
        let changed = false
        let next = nodes.map((node: any) => {
          if (node.id !== id) return node
          const styleW =
            typeof node.style?.width === 'number' ? node.style.width : parseFloat(node.style?.width)
          const styleH =
            typeof node.style?.height === 'number'
              ? node.style.height
              : parseFloat(node.style?.height)
          // Compare intended style only — ignore RF measured node.width (drifts vs border-box)
          const styleOk =
            Number.isFinite(styleW) &&
            Number.isFinite(styleH) &&
            Math.abs(styleW - boxW) <= 1 &&
            Math.abs(styleH - boxH) <= 1
          if (styleOk) return node
          changed = true
          // Left-locked: do not shift position.x when AABB width grows/shrinks with rotation
          return {
            ...node,
            width: boxW,
            height: boxH,
            style: { ...node.style, width: boxW, height: boxH },
          }
        })
        // Keep snap/stack mates flush to the new upright AABB (live while rotating)
        const withMates = applySnapMateRelayout(next, id, { width: boxW, height: boxH })
        if (withMates !== next) {
          changed = true
          next = withMates
        }
        return changed ? next : nodes
      })
      updateNodeInternals(id) // Remeasure resize chrome to the new AABB
    },
    [isBlock, id, getSetNodes, updateNodeInternals]
  )

  useEffect(() => {
    if (!isBlock || !isUserResized || !resizeDimensions) {
      if (!isUserResized) lastPushedBoxRef.current = null // Next resize must push fresh
      return
    }
    // Skip effect while pointer-rotating — move handler pushes AABB+mates every tick
    if (isRotatingRef.current) return
    pushAabbAndSnapMates(rotation)
  }, [
    isBlock,
    isUserResized,
    resizeDimensions?.width,
    resizeDimensions?.height,
    rotation,
    frameShape,
    pushAabbAndSnapMates,
  ])

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
  const persistFrameMetaRef = useRef(persistFrameMeta) // Stable resize-end persist — don't rebind d3-drag
  persistFrameMetaRef.current = persistFrameMeta // Always the latest saver

  // Paint the latest corner-drag sample (one React update per frame, not per touchmove)
  const flushPendingResize = useCallback(() => {
    resizeRafRef.current = null // This rAF has run
    const pending = pendingResizeRef.current // Last sample from d3-drag
    if (!pending) return // Nothing queued (end already applied)
    pendingResizeRef.current = null // Don't flush twice
    if (pending.scale != null) setFrameScale(pending.scale) // Locked proportional content scale
    setResizeDimensions({ width: pending.width, height: pending.height }) // Drive panel box
  }, [])

  // Heal: post-drag hug can persist ~52×40 on a databaseBlock frame (NodeView remount stub).
  // Clear the clip box + relock so the table can hug open again. Re-runs if it collapses again.
  useEffect(() => {
    if (!isBlock) return
    const fromLoadFlag = needsCollapsedDbFrameHealRef.current
    const fromLiveDims =
      !!resizeDimensions &&
      hasDatabaseBlockHtml(promptContent) &&
      isCollapsedDatabaseFrameSize(resizeDimensions.width, resizeDimensions.height)
    if (!fromLoadFlag && !fromLiveDims) return
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

  // Identity MUST stay stable: NodeResizeControl's d3-drag effect rebinds when onResize*
  // changes, and teardown drops element touchmove (phone) while window mouse listeners survive.
  const handleResizeStart = useCallback(() => {
    isResizingRef.current = true // Block hug observer from fighting live resize
    if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current) // Drop a stale paint
    resizeRafRef.current = null
    pendingResizeRef.current = null // Fresh gesture — don't flush a previous drag
    setIsUserResized(true) // Switch from line-grow to explicit frame box
    const dims = resizeDimensionsRef.current // Live box without putting it in callback deps
    const startW = dims?.width ?? panelRef.current?.offsetWidth ?? 200
    const startH = dims?.height ?? panelRef.current?.offsetHeight ?? 40
    lockedResizeStartRef.current = { width: startW, height: startH, scale: frameScaleRef.current } // Locked proportional baseline
  }, [])

  // Handle resize end - clear resizing flag and persist explicit box size from final params
  const handleResizeEnd = useCallback(async (_event: any, params?: { width: number; height: number }) => {
    if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current) // Apply final size now, not next frame
    resizeRafRef.current = null
    pendingResizeRef.current = null // Don't let a queued sample overwrite the commit
    isResizingRef.current = false // Allow size-sync observer again
    isFirstResizeCallRef.current = true // Reset first-call bookkeeping
    setIsUserResized(true) // Persist mode: explicit frame box
    lockedResizeStartRef.current = null // Drop drag baseline

    const minW = blockMinFrameWidth(promptContentRef.current)
    const dims = resizeDimensionsRef.current
    const rot = rotationRef.current
    const unlocked = frameUnlockedRef.current
    const wrapping = frameTextWrapRef.current
    const colW = wrapColWidthRef.current
    const intrinsic = intrinsicSizeRef.current
    let width = Math.max(params?.width ?? dims?.width ?? 0, minW)
    let height = Math.max(params?.height ?? dims?.height ?? 0, BLOCK_MIN_FRAME_H)
    // RF end params are AABB when rotated — store unrotated content size
    if (Math.abs(rot) > 0.5 && params?.width && params?.height) {
      const fallback = dims || { width, height }
      const content = contentSizeFromAabb(params.width, params.height, rot, fallback)
      width = Math.max(content.width, minW)
      height = Math.max(content.height, BLOCK_MIN_FRAME_H)
    }
    const finalScale = frameScaleRef.current // Latest scale from the drag (avoid stale closure)
    let colToPersist: number | undefined // New wrap column width to store (unlocked-wrap resize sets the point)
    if (!unlocked && wrapping) {
      // Locked wrap: hug WIDTH to the scaled FIXED columns (no reflow) + HEIGHT to wrapped content.
      // No +2 border — selected adjust chrome uses borderWidth 0 (same as scaledFrameSize).
      if (colW != null) width = Math.round(colW * Math.max(0.15, finalScale))
      height = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(intrinsic.height * Math.max(0.15, finalScale)))
    } else if (!unlocked) {
      const hugged = scaledFrameSize(intrinsic, finalScale, minW) // Nowrap: snap to scaled text
      width = hugged.width
      height = hugged.height
    } else if (wrapping) {
      // Unlocked wrap: the dragged width IS the new wrap point — remember it (unscaled columns).
      colToPersist = Math.max(1, Math.floor(width / Math.max(0.15, finalScale)))
      setWrapColWidth(colToPersist)
    }
    // Unlocked (wrap or nowrap): keep the user's dragged box — a frame shorter than its
    // content clips the overflow (chevron expands), same for wrapped and non-wrapped text.
    if (width > 0 && height > 0) {
      setResizeDimensions({ width, height }) // Lock final box size into local state
    }
    // Unlocked drag refreshes the last free-resize shape (bookkeeping only — unlock keeps current size).
    if (unlocked) {
      setUnlockedFrameSize({ width, height })
      setUnlockedFrameScale(finalScale)
    }

    await persistFrameMetaRef.current({
      resizeDimensions: { width, height },
      frameUnlocked: unlocked,
      frameTextWrap: wrapping, // Wrap persists in either lock state now
      frameScale: finalScale,
      fontScale: fontScaleRef.current,
      ...(unlocked ? { unlockedFrameSize: { width, height }, unlockedFrameScale: finalScale } : {}),
      ...(colToPersist != null ? { wrapColWidth: colToPersist } : {}), // Save the new unlocked wrap point
    })
  }, [])

  // Corner-drag: locked → proportional content scale; unlocked → free frame (content stays)
  // When rotated, RF reports AABB size — convert back to unrotated content size.
  const handleResize = useCallback((_event: any, params: { width: number; height: number }) => {
    if (!isResizingRef.current) return // Ignore mount/select noise — only after handleResizeStart
    const minW = blockMinFrameWidth(promptContentRef.current)
    const fallback = resizeDimensionsRef.current || lockedResizeStartRef.current || {
      width: minW,
      height: BLOCK_MIN_FRAME_H,
    }
    let width = Math.max(params.width, minW)
    let height = Math.max(params.height, BLOCK_MIN_FRAME_H)
    const rot = rotationRef.current
    if (Math.abs(rot) > 0.5) {
      const content = contentSizeFromAabb(width, height, rot, fallback)
      width = Math.max(content.width, minW)
      height = Math.max(content.height, BLOCK_MIN_FRAME_H)
    }
    let nextScale: number | undefined
    if (!frameUnlockedRef.current && lockedResizeStartRef.current) {
      // Locked (wrap OR nowrap): proportional content scale — width/text scale together.
      const start = lockedResizeStartRef.current
      const ratio = width / Math.max(1, start.width) // keepAspectRatio → width tracks height
      nextScale = Math.max(0.15, start.scale * ratio)
      const colW = wrapColWidthRef.current
      if (frameTextWrapRef.current && colW != null) {
        // Locked WRAP: derive the box from the FIXED column width × scale so NO character reflows —
        // the wrapped text just scales up/down (columns stay constant; no phantom border).
        width = Math.round(colW * nextScale)
        height = Math.max(BLOCK_MIN_FRAME_H, Math.round(intrinsicSizeRef.current.height * nextScale))
      } else {
        // Locked nowrap: hug the blue box to scaled content during the gesture (same as resize-end).
        // Using RF's raw drag size left a larger empty frame with the block stuck top-left so
        // connection/resize chrome no longer lined up with the ⋮⋮.
        const hugged = scaledFrameSize(intrinsicSizeRef.current, nextScale, minW)
        width = hugged.width
        height = hugged.height
      }
    }
    pendingResizeRef.current = { width, height, scale: nextScale } // Latest sample wins
    if (resizeRafRef.current == null) {
      resizeRafRef.current = requestAnimationFrame(flushPendingResize) // One React paint per frame
    }
  }, [flushPendingResize])

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
    // Freeze pivot — live AABB width grows left-locked, so rect center would drift mid-gesture
    rotationDragRef.current = {
      startAngle,
      startRotation: rotation,
      pivotX: cx,
      pivotY: cy,
    }
    e.currentTarget.setPointerCapture(e.pointerId) // Keep events on this handle while dragging
  }, [rotation, resizeDimensions, promptContent])

  // Live-update rotation from pointer deltas relative to frozen pivot
  const handleRotatePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current || !rotationDragRef.current) return // Ignore stray moves
    const { startAngle, startRotation, pivotX, pivotY } = rotationDragRef.current
    const angle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX) // Angle about start pivot
    const deltaDeg = ((angle - startAngle) * 180) / Math.PI // Radians → degrees
    let next = startRotation + deltaDeg // Apply delta to start rotation
    if (e.shiftKey) next = Math.round(next / 15) * 15 // Hold Shift to snap to 15° increments
    setRotation(next) // Paint live rotation on the inner shell
    // Same tick: grow upright AABB + repark snap mates (don’t wait for useEffect)
    pushAabbAndSnapMates(next)
  }, [pushAabbAndSnapMates])

  // End rotate: release capture, persist angle, and persist snap-mate parks against final AABB
  const handleRotatePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current) return // Only finish an active gesture
    isRotatingRef.current = false // Clear rotating flag
    rotationDragRef.current = null // Drop drag baseline
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    setRotation((current) => { // Read latest angle then persist
      void saveRotation(current) // Fire-and-forget metadata save
      // Final AABB+mates push (in case last move was skipped) then persist mate parks
      pushAabbAndSnapMates(current, { forceMates: true })
      const cw = resizeDimensionsRef.current?.width
      const ch = resizeDimensionsRef.current?.height
      if (cw && ch) {
        const aabb =
          Math.abs(current) > 0.5
            ? rotatedFrameAabbSize(cw, ch, current, frameShapeRef.current)
            : { width: cw, height: ch }
        // Defer read so setNodes from pushAabbAndSnapMates has flushed
        queueMicrotask(() => {
          const live = getNodes()
          void persistSnapMateRelayout(live, id, {
            width: Math.ceil(aabb.width),
            height: Math.ceil(aabb.height),
          })
        })
      }
      return current // No state change needed
    })
  }, [saveRotation, pushAabbAndSnapMates, getNodes, id])

  // Toggle frame lock: lock hugs scaled text; unlock keeps the CURRENT visual box + scale
  // (blocks stay the size they were adjusted to while locked — no snap-back to a pre-lock shape).
  const toggleFrameLock = useCallback((forceUnlocked?: boolean) => {
    const nextUnlocked = typeof forceUnlocked === 'boolean' ? forceUnlocked : !frameUnlocked
    if (nextUnlocked === frameUnlocked) return // Already in desired state
    setFrameUnlocked(nextUnlocked)
    // Keep RF node metadata in sync so top-bar frame lock reads correctly
    const setNodes = getSetNodes()
    if (setNodes) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n
          const pm = n.data?.promptMessage
          if (!pm) return n
          return {
            ...n,
            data: {
              ...n.data,
              promptMessage: {
                ...pm,
                metadata: { ...(pm.metadata || {}), frameUnlocked: nextUnlocked },
              },
            },
          }
        })
      )
    }
    window.dispatchEvent(new Event('tt-frame-lock-changed')) // Refresh top-bar frame lock icon
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
      const wrapH = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(naturalH * Math.max(0.15, frameScale)))
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
  }, [frameUnlocked, frameScale, resizeDimensions, intrinsicSize, frameTextWrap, persistFrameMeta, promptContent, getSetNodes, id])

  const handleToggleFrameLock = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    toggleFrameLock() // Flip from under-frame chrome
  }, [toggleFrameLock])

  // Top-bar frame lock → same fit/free toggle as under-frame chrome
  useEffect(() => {
    const onTopBar = (ev: Event) => {
      const detail = (ev as CustomEvent<{ nodeIds?: string[]; unlocked?: boolean }>).detail
      if (!detail?.nodeIds?.includes(id)) return // Not this frame
      toggleFrameLock(detail.unlocked) // Apply requested unlocked state
    }
    window.addEventListener('tt-toggle-frame-lock', onTopBar)
    return () => window.removeEventListener('tt-toggle-frame-lock', onTopBar)
  }, [id, toggleFrameLock])

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
      col = Math.max(1, Math.floor(box.width / s))
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
        const height = Math.max(BLOCK_MIN_FRAME_H, Math.ceil(measureNaturalContentHeight(cf) * s))
        setResizeDimensions((prev) => {
          const base = prev ?? box
          const width = next // Wrap-on: restore stored columns × scale; Wrap-off: hug to nowrap content
            ? (col != null ? Math.round(col * s) : base.width)
            : Math.max(blockMinFrameWidth(promptContent), Math.ceil(measureNaturalContentWidth(cf) * s))
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
    const minW = blockMinFrameWidth(promptContent, false) // Fill hug — no ⋮⋮ column inside the frame
    const natural = scaledFrameSize(intrinsicSize, frameScale, minW)
    // Never hug a databaseBlock frame down to the remount stub — that persists as a permanent clip.
    if (
      hasDatabaseBlockHtml(promptContent) &&
      isCollapsedDatabaseFrameSize(natural.width, natural.height)
    ) {
      return
    }
    // Row cards: same — don't persist grip+I-bar size after drag-end remount
    const expectProps = countPropertyBlocks(promptContent)
    if (
      expectProps > 0 &&
      (natural.width < 120 || natural.height < Math.min(80, 24 * expectProps))
    ) {
      return
    }
    let next = natural
    let changed = true
    setResizeDimensions((prev) => {
      // Wrap keeps fixed columns × scale (not a stale prev.width that still had +2 border).
      // Nowrap hugs width to content.
      const width =
        frameTextWrap && wrapColWidth != null
          ? Math.round(wrapColWidth * Math.max(0.15, frameScale))
          : frameTextWrap && prev
            ? prev.width
            : natural.width
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
    wrapColWidth,
    persistFrameMeta,
    promptContent,
  ])

  // Unlocked WRAP no longer auto-hugs height: like non-wrap clip, the frame keeps the user's box
  // and a frame shorter than the wrapped content clips the overflow + shows the expand chevron.

  // Auto-select panel when editor is focused or has a text range (not boardLink NodeSelection)
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
  // auto-select effect cannot immediately re-select (boardLink title is contentEditable inside PM).
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
    // near() lands a caret beside atoms (TextSelection.create at a boardLink pos throws)
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
    if (isBoardBody) return
    const meta = (promptMessage?.metadata || {}) as Record<string, unknown>
    if (meta.linkedBoardId) return
    if (typeof meta.blockTitle === 'string' && meta.blockTitle.trim()) return

    // Must be exactly one empty textblock after prune (not a boardLink-only frame)
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
    isBoardBody,
    promptContent,
    promptMessage?.metadata,
    id,
  ])

  // Get current zoom level and update panel width when zoom is 100% or less
  const [currentZoom, setCurrentZoom] = useState(reactFlowInstance?.getViewport().zoom ?? 1)
  // Frames hug the longest TipTap line until corner-resized (match `isBlock`, not isBlockMeta alone)
  const usesFitContent = isBlock // Empty user-only bodies without isBlock still hug
  const frameMinW = blockMinFrameWidth(promptContent, false) // Frame fill only — ⋮⋮ lives in select chrome, not inside the fill
  const growsWithLine = usesFitContent && !isUserResized && !pagePreviewOpen // Line runs until Enter / corner resize
  // Empty unresized: explicit px (not max-content) — CSS % children used to inflate ~120×160 boxes
  const emptyLineHug = growsWithLine && isBlockContentEmpty(promptContent)
  const hasBlockContent = isBlock && !isBlockContentEmpty(promptContent) // Lock only when a content block exists
  // Shared screen-relative scale for selection chrome: resize handles, blue lines, connection
  // indicators, rotate/free/wrap. Boosted frameScreenChromeScale — not bare thread comfort.
  const frameUiScale = screenChromeScale
  const frameChromeScale = frameUiScale // Rotate · lock · wrap icons stay screen-sized
  const frameIndicatorSize = 8 * frameUiScale // Connection simulator dots (slightly under resize corners)
  // Sit outside the blue edge — scales with zoom comfort so gap tracks the indicator
  const frameIndicatorOut = INDICATOR_OUTSET * frameUiScale
  // Clear bottom simulator, then the same air as blue→block on the ⋮⋮ side (handle gutter)
  const frameChromeGapY =
    frameIndicatorOut + frameIndicatorSize / 2 + adjustChromeX
  const frameHandleSize = 7 * frameUiScale // Corner resize dots — screen-relative
  const frameLineW = Math.max(1, frameUiScale) // Blue selection stroke
  const frameLineHit = Math.max(4, 5 * frameUiScale) // Line hit target thickness
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
  const huggedSize = scaledFrameSize(intrinsicSize, frameScale, frameMinW) // Scaled content (no phantom border)
  const applyFrameScale = isBlock && isUserResized && frameScale !== 1 // Layout spacer + CSS scale
  const scaledLayoutW = Math.ceil(intrinsicSize.width * Math.max(0.15, frameScale)) // Visual content width (no border)
  const scaledLayoutH = Math.ceil(intrinsicSize.height * Math.max(0.15, frameScale)) // Visual content height (no border)
  const unlockedResized = wrapUnlocked || clipUnlocked // Free-resized frame (wrap or nowrap-clip)
  // Selected/adjust chrome forces borderWidth 0 — do not subtract a phantom 2px or content clips
  // and the blue box looks larger than the block (⋮⋮ / text sit above the left connection mid).
  const panelBorderBox =
    showAdjustFrame ||
    showDragBorderOnly ||
    frameShape ||
    Math.abs(rotation) > 0.5 ||
    (isBorderNone && !showEmptyFrameBorder)
      ? 0
      : 2 * (parseFloat(String(data.borderWeight)) || 1) // borderWeight is typed as a string ('2px')
  const unlockedInnerW = resizeDimensions
    ? Math.max(1, resizeDimensions.width - panelBorderBox)
    : null
  const unlockedInnerH = resizeDimensions
    ? Math.max(1, resizeDimensions.height - panelBorderBox)
    : null
  // Unlocked frame smaller than its visual content → blocks are clipped (nowrap: both axes; wrap: height only)
  const overflowRight =
    clipUnlocked && unlockedInnerW! < huggedSize.width // Nowrap may hide trailing glyphs
  const overflowBottom =
    (clipUnlocked && unlockedInnerH! < huggedSize.height) ||
    (wrapUnlocked && unlockedInnerH! < huggedSize.height) // Short frame cuts lower blocks
  const contentOverflows = overflowRight || overflowBottom
  // Hover dwell can arm a preview — hide immediately while dragging / page preview / connecting
  const clipPreviewEligible =
    contentOverflows && isFrameHovering && !dragging && !pagePreviewOpen && !isThreadConnecting
  // After ~500ms hover: temporarily unclip so the full blocks read (saved size unchanged)
  const showClipPreview = clipPreviewEligible && clipPreviewReady
  // Free-frame clip: keep the connections group on the visible box (not inside overflow)
  const pinConnectionsToFrame =
    notionConnected && isBlock && !isFlashcard && overflowBottom && !showClipPreview
  const clipBoxH =
    unlockedInnerH != null
      ? pinConnectionsToFrame
        ? Math.max(1, unlockedInnerH - adjustChromeYBottom) // Leave a strip for the scaled pinned group
        : unlockedInnerH
      : undefined
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
  // Frames start at plain-text hug; chat/flashcards use their fixed starting widths
  const initialWidth = isFlashcard ? 600 : (usesFitContent ? BLOCK_LOCKED_MIN_W : 768)
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
      // Unresized: empty → one-line hug px; typed → max-content (clear stale inline sizes)
      const panel = panelRef.current
      if (panel) {
        if (isBlockContentEmpty(promptContent)) {
          const w = `${frameMinW}px`
          const h = `${BLOCK_MIN_FRAME_H}px`
          if (panel.style.width !== w) panel.style.width = w
          if (panel.style.height !== h) panel.style.height = h
        } else {
          if (panel.style.width !== 'max-content') panel.style.width = 'max-content'
          if (panel.style.height !== 'fit-content') panel.style.height = 'fit-content'
        }
      }
      return
    }
    if (isUserResized && resizeDimensions) return // Explicit box owns width
    if (panelRef.current && panelWidthRef.current) {
      const next = `${panelWidthRef.current}px`
      if (panelRef.current.style.width !== next) panelRef.current.style.width = next
    }
  })

  // Horizontal chrome around TipTap text: L/R content pads (+ border buffer); ⋮⋮ is outside the fill
  const blockWidthChrome = useCallback(() => {
    // Blocks: BLOCK_FRAME_PAD_X×2 + border (2) + buffer (10)
    // Non-blocks: px-3 (24) + border (2) + buffer (10) + p-1 (8)
    return usesFitContent ? BLOCK_FRAME_PAD_X * 2 + 2 + 10 : 24 + 2 + 10 + 8
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
    // Unresized blocks: empty → one-line hug px; typed → max-content (don’t force chat widths)
    if (growsWithLine) {
      if (panelRef.current) {
        const html = newContent !== undefined ? newContent : promptContent
        if (isBlockContentEmpty(html)) {
          panelRef.current.style.width = `${frameMinW}px`
          panelRef.current.style.height = `${BLOCK_MIN_FRAME_H}px`
        } else {
          panelRef.current.style.width = 'max-content'
          panelRef.current.style.height = 'fit-content'
        }
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
    frameMinW,
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
      // Legacy: sole databaseBlock → boardLink for pages only (DB frames keep the table NodeView)
      const meta = (promptMessage?.metadata || {}) as Record<string, unknown>
      const linkedId = getLinkedBoardId(meta)
      if (linkedId && meta.notionObject !== 'database' && isSoleDatabaseBlockContent(merged)) {
        const iconMeta = meta.notionIcon as { type?: string; emoji?: string } | null
        const emoji = iconMeta?.type === 'emoji' && iconMeta.emoji ? iconMeta.emoji : null
        merged =
          migrateSoleDatabaseBlockToBoardLink(merged, {
            boardId: linkedId,
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
    promptMessage?.metadata?.linkedBoardId,
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
    // Blocks hug via max-content — the 300ms opacity:0 made load shells and frames miss each other
    if (isBlock) {
      hasInitialShrunkRef.current = promptMessage?.id || id
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
    // Never persist an empty / atom-stripped editor over real frame content (drag remount races)
    const prev = promptMessage?.content || promptContent || ''
    const nextEmpty =
      isBlockContentEmpty(newContent) ||
      !newContent ||
      newContent.trim() === '' ||
      newContent.trim() === '<p></p>'
    const prevHasAtoms = hasFrameAtomHtml(prev) || !isBlockContentEmpty(prev)
    const lostPropertyCells =
      countPropertyBlocks(prev) > 0 && countPropertyBlocks(newContent) < countPropertyBlocks(prev)
    const lostAtoms = hasFrameAtomHtml(prev) && !hasFrameAtomHtml(newContent)
    if ((nextEmpty && prevHasAtoms) || lostPropertyCells || lostAtoms) {
      console.warn('Ignored save that would wipe frame atoms', {
        nextEmpty,
        lostPropertyCells,
        lostAtoms,
      })
      setPromptContent(prev)
      setAiForceSyncKey((k) => k + 1)
      return
    }

    // Expand panel width FIRST (before content update) to prevent wrapping
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
          await deleteLinkedBoardForBlock(supabase, promptMessage.metadata as Record<string, unknown>)
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

    // TipTap iOS focus() omits preventScroll; pin page + overflow ancestors so edge creates don’t jump
    const focusFrameEditor = (ed: NonNullable<typeof promptEditorRef.current>) => {
      const sx = window.scrollX // Document scroll (rare on board, but cheap to pin)
      const sy = window.scrollY
      // Board shell uses overflow-auto main — Safari pans that when the caret is near the edge
      const scrollParents: { el: HTMLElement; left: number; top: number }[] = []
      let node: HTMLElement | null = ed.view.dom as HTMLElement
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node)
        const canScroll =
          /(auto|scroll|overlay)/.test(style.overflowY) ||
          /(auto|scroll|overlay)/.test(style.overflowX)
        if (canScroll && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
          scrollParents.push({ el: node, left: node.scrollLeft, top: node.scrollTop })
        }
        node = node.parentElement
      }
      // Force ≥16px before focus — Safari zooms any focused editor under 16px (inline beats CSS)
      const pm = ed.view.dom as HTMLElement
      const prevFont = pm.style.fontSize
      if (typeof window !== 'undefined' && (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches)) {
        pm.style.fontSize = '16px'
      }
      ed.commands.focus('end', { scrollIntoView: false }) // Don’t scroll caret into view (edge frames)
      const pin = () => {
        window.scrollTo(sx, sy)
        for (const p of scrollParents) {
          p.el.scrollLeft = p.left
          p.el.scrollTop = p.top
        }
      }
      pin()
      requestAnimationFrame(pin)
      window.setTimeout(pin, 50) // Keyboard / visualViewport settle
      window.setTimeout(pin, 150)
      // Restore prior inline fontScale after focus if we overrode it (blocks use CSS frameScale)
      if (prevFont && prevFont !== '16px') {
        window.setTimeout(() => {
          if (!ed.isDestroyed) pm.style.fontSize = prevFont
        }, 200)
      }
    }

    // Phone I-bar: keep keyboard on the centered 16px capture field — don’t steal focus into an edge TipTap
    const captureOwnsKeyboard = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el?.classList?.contains('tt-ibar-capture')
    }

    // iOS Safari zooms if we autofocus a sub-16px editor near the edge. Desktop must take the caret
    // after spawn or the I-bar never appears (capture stays focused and ProseMirror hides its caret).
    const keepCaptureForPhone = () => {
      if (!captureOwnsKeyboard()) return false
      if (typeof window === 'undefined') return false
      return (
        window.matchMedia('(hover: none)').matches ||
        window.matchMedia('(pointer: coarse)').matches
      )
    }

    const applySeed = (html: string, text: string) => {
      const ed = promptEditorRef.current
      if (!ed || ed.isDestroyed) return false
      const current = ed.getText()
      const captureOwns = captureOwnsKeyboard() // Capture field still has the I-bar keyboard
      // Capture is source of truth until TipTap focuses — apply Backspace (shorter) as well as new chars.
      // After handoff, only accept equal-or-longer seeds so a stale buffer cannot rewind typed text.
      const seedChanged = text !== current
      const seedAhead = text.length >= current.length
      if (seedChanged && (captureOwns || seedAhead)) {
        ed.commands.setContent(html || '<p></p>') // Paint the capture buffer, including deletions
        if (!keepCaptureForPhone()) focusFrameEditor(ed) // Desktop: show I-bar even while capture still focused
        setPromptContent(html || '<p></p>')
        setPromptHasChanges(true) // Persist the buffered typing; block remote wipe
        hasAutoFocusedRef.current = true
        return true
      }
      if (!ed.isFocused && !keepCaptureForPhone()) focusFrameEditor(ed)
      hasAutoFocusedRef.current = true
      setPromptHasChanges(true)
      return true
    }

    const onSeed = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string; text?: string; html?: string }>).detail
      if (!detail?.messageId || detail.messageId !== promptMessage?.id) return
      const ok = applySeed(detail.html || '<p></p>', detail.text || '')
      const ed = promptEditorRef.current
      // Phone: capture still owns the keyboard — don’t release it (would drop the soft keyboard)
      if (keepCaptureForPhone()) return
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
          // Phone: I-bar capture already focused — sync only; TipTap focus would Safari-zoom near edges
          if (!keepCaptureForPhone()) {
            focusFrameEditor(promptEditorRef.current)
          }
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

  // Corner resize dots — size tracks screen chrome (zoom comfort), not frame width
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
  // Upright blue adjust frame = tight AABB of the *visible* silhouette (ellipse/polygon), not just the content rect
  const displayBox = isContentRotated
    ? rotatedFrameAabbSize(contentBoxW, contentBoxH, rotation, frameShape)
    : { width: contentBoxW, height: contentBoxH }
  // Row cards only: never rely on fit-content — NodeView remount on first select+drag collapses
  // the box. Sole databaseBlock tables must NOT use this (width:100% + offsetWidth → runaway size).
  const atomExplicitBox =
    isBlock &&
    isRowCardAtomHtml(promptContent) &&
    intrinsicMeasured &&
    !pagePreviewOpen &&
    !(isUserResized && resizeDimensions)
      ? {
          width: huggedSize.width + adjustChromeX * 2,
          height: huggedSize.height + adjustChromeYTop + adjustChromeYBottom,
        }
      : null
  const layoutBox = layoutBoxFreeze || atomExplicitBox
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
          'group nopan border relative cursor-grab active:cursor-grabbing overflow-visible transition-[opacity,box-shadow,background-color,border-color] duration-300', // overflow-visible: ⋮⋮ in left chrome; nopan: right-click opens frame menu
          // When rotated, fill lives on the inner shell only (avoids upright+rotated double shape)
          !frameShape && !isContentRotated && !isBlock && 'rounded-2xl',
          !isFillTransparent && !frameShape && !isContentRotated && !isBlock && 'backdrop-blur-sm',
          // Selection uses the connected resize rectangle — panel border must be 0 so handles
          // sit on the outer edge (a 1px empty/custom border inset the padding box and floated chrome).
          selected && isBlock
            ? 'border-transparent'
            : selected
              ? 'border-blue-500 dark:border-blue-400'
              : (data.borderColor || frameShape || showEmptyFrameBorder ? '' : 'border-transparent'), // Empty → grey via style; styled/shape → style; else transparent
          isBookmarked
            ? 'shadow-[0_0_8px_rgba(250,204,21,0.6)] dark:shadow-[0_0_8px_rgba(250,204,21,0.4)]'
            : isBorderNone || frameShape || isContentRotated || showEmptyFrameBorder
              ? 'shadow-none' // Transparent / empty chrome / silhouette / rotated — no card shadow on outer
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
        // Selected: even L/R gutters. T/B bands always host property / connections outside the fill.
        width: layoutBox
          ? `${layoutBox.width}px`
          : pagePreviewOpen
          ? '520px'
          : isContentRotated
            ? `${displayBox.width + adjustChromeX * 2}px`
            : isUserResized && resizeDimensions
              ? `${resizeDimensions.width + adjustChromeX * 2}px`
              : emptyLineHug
                ? `${frameMinW + adjustChromeX * 2}px`
                : growsWithLine
                  ? 'max-content'
                  : `${panelWidthToUse + adjustChromeX * 2}px`,
        height: layoutBox
          ? `${layoutBox.height}px`
          : pagePreviewOpen
          ? '420px'
          : isContentRotated
            ? `${displayBox.height + adjustChromeYTop + adjustChromeYBottom}px`
            : isUserResized && resizeDimensions
              ? `${resizeDimensions.height + adjustChromeYTop + adjustChromeYBottom}px`
              : emptyLineHug
                ? `${BLOCK_MIN_FRAME_H + adjustChromeYTop + adjustChromeYBottom}px`
                : growsWithLine
                  ? 'fit-content'
                  : undefined,
        minWidth: layoutBox
          ? `${layoutBox.width}px`
          : pagePreviewOpen
          ? '520px'
          : isContentRotated
            ? `${displayBox.width + adjustChromeX * 2}px`
            : usesFitContent
              ? `${frameMinW + adjustChromeX * 2}px`
              : isFlashcard
                ? '300px'
                : '200px',
        minHeight: layoutBox
          ? `${layoutBox.height}px`
          : pagePreviewOpen
            ? '420px'
            : '0px',
        maxWidth: layoutBox
          ? `${layoutBox.width}px`
          : isContentRotated
          ? `${displayBox.width + adjustChromeX * 2}px`
          : undefined,
        maxHeight: layoutBox
          ? `${layoutBox.height}px`
          : isContentRotated
          ? `${displayBox.height + adjustChromeYTop + adjustChromeYBottom}px`
          : undefined,
        // Bands outside the fill: property (top) / connections (bottom); L/R gutters when selected
        paddingTop: adjustChromeYTop || undefined,
        paddingRight: adjustChromeX || undefined,
        paddingBottom: adjustChromeYBottom || undefined,
        paddingLeft: adjustChromeX || undefined,
        boxSizing: 'border-box',
        opacity: isInitialShrinkComplete ? 1 : 0,
        willChange: dragging && isBlock ? 'transform' : undefined,
        // Fill always paints on the inner frame shell (shape-capable surface) — not here
        backgroundColor:
          frameShape || isContentRotated || isBlock ? 'transparent' : panelBackgroundColor,
        borderColor:
          // Blue adjust / drag rect owns the outline — keep panel border off so chrome isn't inset
          showAdjustFrame || showDragBorderOnly || frameShape || isContentRotated
            ? 'transparent'
            : data.borderColor
              ? data.borderColor // Custom border when idle
              : showEmptyFrameBorder
                ? emptyFrameBorderColor // Thin grey outline for blank frames
                : 'transparent',
        borderStyle:
          showAdjustFrame ||
          showDragBorderOnly ||
          frameShape ||
          isContentRotated ||
          (isBorderNone && !showEmptyFrameBorder)
            ? 'none'
            : ((data.borderStyle as React.CSSProperties['borderStyle']) || 'solid'), // Color / empty chrome → solid
        borderWidth:
          showAdjustFrame ||
          showDragBorderOnly ||
          frameShape ||
          isContentRotated ||
          (isBorderNone && !showEmptyFrameBorder)
            ? 0
            : (data.borderWeight || 1), // 1px for empty chrome or when a border color is set
        ['--tt-frame-ui-scale' as string]: frameUiScale,
        ['--tt-frame-line-w' as string]: `${frameLineW}px`,
        ['--tt-frame-line-hit' as string]: `${frameLineHit}px`,
        ['--tt-frame-handle' as string]: `${frameHandleSize}px`,
        ['--tt-frame-handle-border' as string]: `${Math.max(1, 1.5 * frameUiScale)}px`,
        ['--tt-frame-radius' as string]: `${frameCornerRadius}px`, // Fill radius only — adjust ring is square
      }}
      onPointerDownCapture={(e) => {
        const t = e.target as HTMLElement | null
        // Text / ⋮⋮ / resize / rotate / connection simulators / property·connection marks —
        // those own the gesture. Body press only hides connection indicators (`pressing`).
        const onFrameChrome = !!t?.closest?.(
          '.react-flow__resize-control, [data-frame-chrome], [data-tt-block-handle], [data-tt-insert-line], .block-actions-menu, [data-tt-connection-indicator], [data-tt-property-header] span, [data-tt-connections-header] button, .ProseMirror'
        )
        if (!onFrameChrome) {
          // Body mid-press: hide connection simulators until release (adjust chrome stays)
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
          className="pointer-events-none absolute inset-0 z-[20]"
          style={{
            borderRadius: 0, // Square adjust chrome — fill keeps rounded corners
            boxShadow: `inset 0 0 0 ${frameLineW}px #3b82f6`, // Same blue as selection chrome, no hit target
            // Upright AABB outline — don't clip to rotated silhouette
            clipPath: !isContentRotated ? shapeClip : undefined,
          }}
        />
      )}

      {/* Selected frames: square blue ring (RF line controls stay for hit/resize but paint is off) */}
      {showAdjustFrame && !frameShape && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[19]"
          style={{
            borderRadius: 0, // Square resize outline — fill / property cell keep rounded corners
            boxShadow: `inset 0 0 0 ${frameLineW}px #3b82f6`,
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
              variant="line" // Hit target only — stroke painted by the square ring above
              className={cn(
                'nodrag nopan tt-frame-resize-line', // nodrag: resize must not start frame drag
                !frameShape && 'tt-frame-resize-line-hit' // Hit only — square ring paints the stroke
              )}
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
              minWidth={frameMinW} // boardLink vs plain-text floor
              minHeight={BLOCK_MIN_FRAME_H} // Keep a usable box; pairs with handleResize clamp
              keepAspectRatio={!frameUnlocked && hasBlockContent} // Locked + content: proportional only
              onResizeStart={handleResizeStart} // Arm user-resize mode (line-grow off)
              onResize={handleResize} // Apply explicit width/height while dragging
              onResizeEnd={handleResizeEnd} // Persist resizeDimensions
            />
          ))}
        </>
      )}

      {/* Stacked mates: line on each adjust-box side gap (independent trees per side) */}
      {!dragging &&
        stackGapSides.map(({ side, groupId }) => (
          <FrameStackRevealLine
            key={`stack-line-${side}-${groupId}`}
            nodeId={id}
            stackGroupId={groupId}
            stackSide={side}
            frameUiScale={frameUiScale}
          />
        ))}

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
                ...connectionIndicatorStyle(side, frameIndicatorOut), // Outside blue edge (scaled outset)
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
                marginLeft: `${-8 * frameChromeScale}px`, // Nudge under left edge as chrome counter-scales
                marginTop: `${frameChromeGapY}px`, // Flow gap only — scale() sizes icons, not this offset
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

      {/* Page titles/links now render inline as boardLink blocks inside the editor (no edge chip). */}
      
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

      {/* Property icons — above the fill, inset to match fill content (not flush to fill’s left edge) */}
      {hasPropBand && (
        <div
          ref={propBandRef}
          data-tt-frame-chrome-top
          data-tt-property-band
          // Band body may drag the frame; individual property marks are nodrag
          className="absolute z-[2] flex min-w-0 items-end overflow-hidden" // Clip scaled icons to the frame width
          style={{
            top: 0,
            left: adjustChromeX + chromePadX,
            right: adjustChromeX + chromePadX,
            height: adjustChromeYTop,
          }}
        >
          {/* Screen-comfort icons — do not grow with locked frameScale */}
          <div
            className="min-w-0 w-full overflow-hidden"
            style={{
              transform: screenChromeScale !== 1 ? `scale(${screenChromeScale})` : undefined,
              transformOrigin: 'left bottom',
            }}
          >
            <FramePropertyGroup
              items={chromePropertyHeaders}
              bandWidth={propBandWidth}
              layoutScale={screenChromeScale}
              editorRef={promptEditorRef}
            />
          </div>
        </div>
      )}
      {/* Connections — below the fill, same horizontal inset as properties / cell */}
      {hasConnBand && (
        <div
          data-tt-frame-chrome-bottom
          // Band body may drag the frame; Notion mark button is nodrag
          className="absolute z-[2] flex items-start" // Sit on the fill (extra band air is below)
          style={{
            bottom: 0,
            left: adjustChromeX + chromePadX,
            right: adjustChromeX + chromePadX,
            height: adjustChromeYBottom,
          }}
        >
          <div
            style={{
              transform: screenChromeScale !== 1 ? `scale(${screenChromeScale})` : undefined,
              transformOrigin: 'left top',
            }}
          >
            <FrameConnectionsGroup
              notionSync={notionSync}
              onNotionConnection={handleNotionConnection}
            />
          </div>
        </div>
      )}

      {/* Single text body — when rotated, one centered shell holds fill + shape + blocks (no double card).
          This shell IS the shape-capable frame surface: same fill + radius selected or not. */}
      <div
        className={cn(
          'relative z-[1] w-full h-full', // Above shape backdrop; fills the padded content box
          !isFillTransparent && !frameShape && 'backdrop-blur-sm',
          !isBlock && 'p-1',
          pagePreviewOpen && 'flex flex-col h-full min-h-0',
          // Clip content inside the fill; ⋮⋮ paints in the panel’s left chrome (overflow visible on panel)
          unlockedResized && !showClipPreview && !isContentRotated
            ? cn('overflow-hidden', pinConnectionsToFrame && 'flex flex-col')
            : 'overflow-visible',
          promptMessage?.metadata?.fadeIn === true &&
            isBlockContentEmpty(promptContent) &&
            'animate-note-fade-in',
          isContentRotated && 'absolute'
        )}
        style={{
          // Always paint fill here — never swap to a text-only pill when selected
          backgroundColor: frameShape ? 'transparent' : responseAreaBackgroundColor || panelBackgroundColor,
          // Live radius: property cells sit inside CSS scale (6px grows); fill must match
          borderRadius: frameCornerRadius || undefined,
          // Empty-frame outline on the fill shell (panel border is off while adjust chrome is on)
          boxShadow:
            showEmptyFrameBorder && !frameShape
              ? `inset 0 0 0 1px ${emptyFrameBorderColor}`
              : undefined,
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
            className="pointer-events-none absolute left-0 top-0 -z-[1]"
            style={{
              borderRadius: frameCornerRadius || undefined, // Same as fill so hover-unclip corners don’t snap square
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
        {/* Page frame with regular blocks (no boardLink) — pin open menu to the visible frame edge
            (inside the overflow clip), not to the wider content box. */}
        {showFrameBoardOpenMenu && linkedBoardId && (
          <BoardLinkProvider value={boardLinkActions}>
            <BoardOpenMenu
              boardId={linkedBoardId}
              notionUrl={notionUrl}
              forceVisible
              className="!right-1 !top-2 !translate-y-0"
            />
          </BoardLinkProvider>
        )}
        {/* Hide body while previewing — keeps page title (edge chip / preview chrome) from sitting under the map */}
        {!pagePreviewOpen && (
          <>
          <div
            className={pinConnectionsToFrame ? 'min-h-0 flex-1' : undefined} // Shrink so the connections group keeps the bottom strip
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
                        : unlockedResized && clipBoxH != null
                          ? clipBoxH
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
                        : clipBoxH,
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
                  : isUserResized || !growsWithLine || emptyLineHug
                    ? 'w-full' // Fill explicit empty hug / resized box for full-row clicks
                    : 'w-max',
              // Blocks: padX > padY slightly so L/R of the property cell breathe vs the fill edge
              isBlock ? undefined : 'px-3 py-3'
            )}
            style={{
              ...(isBlock
                ? {
                    paddingTop: BLOCK_FRAME_PAD_Y,
                    paddingBottom: BLOCK_FRAME_PAD_Y,
                    paddingLeft: BLOCK_FRAME_PAD_X,
                    paddingRight: BLOCK_FRAME_PAD_X,
                  }
                : {}),
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
              if (t.closest?.('.ProseMirror, [data-tt-block-handle], [data-tt-insert-line], .block-actions-menu, [data-tt-connections-header], [data-tt-property-header]')) {
                return // Editor / grip / nest / property chrome already handle these
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
            <BoardLinkProvider value={boardLinkActions}>
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
              isPanelSelected={!!selected} // Keep editable on tap — !dragging was flipping off mid-gesture (I-bar needed 2 taps)
              suspendContentSync={!!dragging || dragAtomGuard} // Freeze TipTap before RF sets dragging (first-drag race)
              frameDragging={!!dragging || dragAtomGuard}
              dragSuspendRef={frameDragSuspendRef} // Sync arm on pointerdown — state lags one frame
              forceContentSyncKey={aiForceSyncKey} // AI eye / remove / save swaps content even while focused
              isLoading={false}
              onBlur={handleEditorBlur}
              onEditorActiveChange={handleEditorActiveChange}
              enableBlockHandles={isBlock && !isFlashcard} // TipTap blocks; ⋮⋮ gutter only while selected
              showBlockHandles={!!selected && !isFlashcard} // Keep grips mounted while selected — dragging used to unmount them mid-gesture
              singleLineUntilEnter={isBlock && !isFlashcard && !wrapActive} // nowrap until Enter; wrap mode (locked/unlocked) soft-wraps
              hostNodeId={id}
              conversationId={conversationId}
              hostMessageId={promptMessage?.id}
              notionConnected={notionConnected}
              notionSync={notionSync}
              onNotionConnection={handleNotionConnection}
              propertyType={framePropertyType}
              onPropertyTurnInto={handlePropertyTurnInto}
              pinConnectionsToFrame={pinConnectionsToFrame}
              loadCrossfade={promptMessage?.metadata?.fadeIn !== true} // Load: dissolve the shell; new frames use note-fade-in
              chromeBandsOutside // Suppress in-fill strips — host paints only while selected
              contentPadLeft={isBlock ? BLOCK_FRAME_PAD_X : 0}
              frameScale={frameScale}
              handleGutterFlow={handleGutterFlow}
              onPropertyHeadersChange={setChromePropertyHeaders}
              boardInTargets={(() => {
                const convs =
                  (queryClient.getQueryData(['conversations']) as
                    | Array<{ id: string; title?: string | null }>
                    | undefined) || []
                return [
                  { id: conversationId || '', title: 'Current board' },
                  ...convs
                    .filter((c) => c.id !== conversationId)
                    .slice(0, 40)
                    .map((c) => ({ id: c.id, title: boardTitleOrDefault(c.title) })),
                ]
              })()}
              onPageTurnInto={async (blockType, boardInParentId) => {
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
                    boardInParentId: boardInParentId || null,
                  })
                  await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
                  await queryClient.invalidateQueries({ queryKey: ['conversations'] })
                } catch (err) {
                  console.error('Failed Page turn into from content block:', err)
                }
              }}
            />
            </BoardLinkProvider>
          </div>
          </div>
          {showFrameChrome && pinConnectionsToFrame && !hasConnBand && (
            <div
              className="flex-shrink-0"
              style={{
                paddingLeft: chromePadX, // Match scaled fill content inset when pinned in-flow
                height: chromeBandH,
                display: 'flex',
                alignItems: 'center',
                backgroundColor: frameShape ? 'transparent' : responseAreaBackgroundColor,
              }}
            >
              <div
                style={{
                  transform: screenChromeScale !== 1 ? `scale(${screenChromeScale})` : undefined,
                  transformOrigin: 'left center',
                }}
              >
                <FrameConnectionsGroup
                  notionSync={notionSync}
                  onNotionConnection={handleNotionConnection}
                />
              </div>
            </div>
          )}
          </>
        )}

        {/* Keep iframe mounted after warm/open; fills card while visible. Targets the active page
            (a boardLink's child page) — falls back to the frame's own linked page. */}
        {pagePreviewMounted && activePreviewBoardId && (
          <div
            className={cn(
              pagePreviewOpen ? 'flex-1 min-h-0 min-w-0 flex flex-col p-2 pt-2' : 'hidden'
            )}
          >
            <NestedBoardPreview
              key={activePreviewBoardId} // Remount when switching between different child pages
              conversationId={activePreviewBoardId}
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

