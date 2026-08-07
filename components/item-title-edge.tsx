'use client'

// Edge-anchored title chip for map items — untitled items show "Add a title" when selected;
// committing a title promotes the item to a linked page (own map). Title + page stay in sync.

import { useCallback, useEffect, useRef, useState } from 'react' // Local edit / drag state
import { useRouter } from 'next/navigation' // Open linked page map
import { AppWindow, Expand } from 'lucide-react' // Preview (in-place) + open full page
import { createClient } from '@/lib/supabase/client' // Persist title + create page
import { useQueryClient } from '@tanstack/react-query' // Refresh Pages menu + panels
import { cn } from '@/lib/utils' // Class merge for chip chrome
import { migrateLegacyItemFlags, syncItemAndPageTitle } from '@/lib/items' // Dual-write + drop legacy isNote
import { useBoardEmbed } from '@/lib/board-embed-context' // Hide preview when already inside a nested board

/** Map perimeter parameter t ∈ [0,1) → pixel offset from panel top-left (clockwise from top-left). */
export function perimeterPoint(width: number, height: number, t: number): { x: number; y: number } {
  const w = Math.max(width, 1) // Avoid divide-by-zero on unmeasured panels
  const h = Math.max(height, 1)
  const peri = 2 * (w + h) // Full rectangle perimeter
  let d = (((t % 1) + 1) % 1) * peri // Distance along perimeter from top-left
  if (d <= w) return { x: d, y: 0 } // Top edge, left → right
  d -= w
  if (d <= h) return { x: w, y: d } // Right edge, top → bottom
  d -= h
  if (d <= w) return { x: w - d, y: h } // Bottom edge, right → left
  d -= w
  return { x: 0, y: h - d } // Left edge, bottom → top
}

/** Inverse: pointer offset inside panel → nearest perimeter t (for drag). */
export function pointToPerimeterT(width: number, height: number, x: number, y: number): number {
  const w = Math.max(width, 1)
  const h = Math.max(height, 1)
  const peri = 2 * (w + h)
  const distTop = Math.abs(y)
  const distRight = Math.abs(x - w)
  const distBottom = Math.abs(y - h)
  const distLeft = Math.abs(x)
  const min = Math.min(distTop, distRight, distBottom, distLeft)
  let dist = 0
  if (min === distTop) {
    dist = Math.min(Math.max(x, 0), w) // Project onto top
  } else if (min === distRight) {
    dist = w + Math.min(Math.max(y, 0), h)
  } else if (min === distBottom) {
    dist = w + h + (w - Math.min(Math.max(x, 0), w))
  } else {
    dist = w + h + w + (h - Math.min(Math.max(y, 0), h))
  }
  return dist / peri
}

/** Default: halfway along the top edge (midpoint of the item’s top side). */
export function defaultTitleEdgeT(width: number, height: number): number {
  const w = Math.max(width, 1)
  const h = Math.max(height, 1)
  return w / 2 / (2 * (w + h))
}

type ItemTitleEdgeProps = {
  selected: boolean // Only show "Add a title" when selected
  width: number // Panel width in px (for perimeter math)
  height: number // Panel height in px
  messageId: string // Item message to update
  conversationId: string // Parent page / map that owns this item
  itemTitle?: string | null // Existing title on the item
  linkedPageId?: string | null // Child conversation id for this page’s map
  titleEdgeT?: number | null // Saved perimeter position
  previewOpen?: boolean // Whether the in-place nested board is expanded
  onTogglePreview?: () => void // Expand / collapse page-within-page preview
}

export function ItemTitleEdge({
  selected,
  width,
  height,
  messageId,
  conversationId,
  itemTitle,
  linkedPageId,
  titleEdgeT,
  previewOpen = false,
  onTogglePreview,
}: ItemTitleEdgeProps) {
  const router = useRouter() // Navigate into the page’s own map
  const queryClient = useQueryClient() // Invalidate nav + messages after promote/rename
  const { embedded } = useBoardEmbed() // Nested boards don’t offer another preview level
  const [editing, setEditing] = useState(false) // Inline title input open
  const [displayTitle, setDisplayTitle] = useState(itemTitle || '') // Local title so chip stays after promote before refetch
  const [draft, setDraft] = useState(itemTitle || '') // Controlled input value
  const [edgeT, setEdgeT] = useState(() =>
    typeof titleEdgeT === 'number' ? titleEdgeT : defaultTitleEdgeT(width, height)
  )
  const [dragging, setDragging] = useState(false) // Pointer drag along edges
  const [localLinkedPageId, setLocalLinkedPageId] = useState(linkedPageId || null) // Page id before parent message refetch
  const inputRef = useRef<HTMLInputElement>(null) // Focus when opening editor
  const chipRef = useRef<HTMLDivElement>(null) // Measure for drag origin
  const dragMovedRef = useRef(false) // Distinguish click vs drag
  const savingRef = useRef(false) // Prevent double promote

  // Sync from props; if linked, prefer page title as source of truth and heal drift
  useEffect(() => {
    let cancelled = false
    const reconcile = async () => {
      if (linkedPageId) {
        const supabase = createClient()
        const { data: page } = await supabase
          .from('conversations')
          .select('title')
          .eq('id', linkedPageId)
          .maybeSingle()
        const pageTitle = page?.title?.trim() || ''
        if (cancelled) return
        if (pageTitle) {
          setDisplayTitle(pageTitle)
          setDraft(pageTitle)
          // Heal item metadata if it drifted from the page title
          if (pageTitle !== (itemTitle || '').trim()) {
            try {
              await syncItemAndPageTitle(supabase, {
                messageId,
                linkedPageId,
                title: pageTitle,
              })
              await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
            } catch (err) {
              console.error('Failed to heal item/page title sync:', err)
            }
          }
          return
        }
      }
      setDisplayTitle(itemTitle || '')
      setDraft(itemTitle || '')
    }
    void reconcile()
    return () => {
      cancelled = true
    }
  }, [itemTitle, linkedPageId, messageId, conversationId, queryClient])

  useEffect(() => {
    setLocalLinkedPageId(linkedPageId || null)
  }, [linkedPageId])

  useEffect(() => {
    if (typeof titleEdgeT === 'number') setEdgeT(titleEdgeT)
    else setEdgeT(defaultTitleEdgeT(width, height))
  }, [titleEdgeT, width, height])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const persistMetadata = useCallback(
    async (patch: Record<string, unknown>) => {
      const supabase = createClient()
      const { data: row } = await supabase.from('messages').select('metadata').eq('id', messageId).single()
      const existing = (row?.metadata as Record<string, unknown>) || {}
      const { meta: migrated } = migrateLegacyItemFlags(existing) // Ensure isItem-only flags
      const { error } = await supabase
        .from('messages')
        .update({ metadata: { ...migrated, ...patch, isItem: true } })
        .eq('id', messageId)
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
    },
    [messageId, conversationId, queryClient]
  )

  const openLinkedPage = useCallback(() => {
    if (!localLinkedPageId) return
    router.push(`/board/${localLinkedPageId}`) // Expand into the page’s own map
  }, [localLinkedPageId, router])

  // First title commit: create child page + link; later edits dual-write title
  const commitTitle = useCallback(
    async (raw: string) => {
      const title = raw.trim()
      if (!title || savingRef.current) {
        setEditing(false)
        setDraft(displayTitle || '')
        return
      }
      savingRef.current = true
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        if (localLinkedPageId) {
          // Rename keeps item card + page menu entry identical
          await syncItemAndPageTitle(supabase, {
            messageId,
            linkedPageId: localLinkedPageId,
            title,
            titleEdgeT: edgeT,
          })
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        } else {
          // Promote item → page: child conversation nested under current map
          const { data: child, error: childError } = await supabase
            .from('conversations')
            .insert({
              user_id: user.id,
              title,
              metadata: {
                parent_id: conversationId, // Nest under this map in the Pages menu
                sourceItemMessageId: messageId, // Reverse link for menu rename/delete sync
                hasContent: false,
              },
            })
            .select('id')
            .single()

          if (childError || !child) {
            console.error('Failed to create page from item title:', childError)
            return
          }

          setLocalLinkedPageId(child.id)
          await syncItemAndPageTitle(supabase, {
            messageId,
            linkedPageId: child.id,
            title,
            titleEdgeT: edgeT,
          })
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await queryClient.refetchQueries({ queryKey: ['conversations'] })
          await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
        }
        setDisplayTitle(title)
        setDraft(title)
        setEditing(false)
      } catch (err) {
        console.error('Error committing item title:', err)
      } finally {
        savingRef.current = false
      }
    },
    [localLinkedPageId, conversationId, messageId, edgeT, displayTitle, queryClient]
  )

  const saveEdgePosition = useCallback(
    async (t: number) => {
      try {
        await persistMetadata({ titleEdgeT: t })
      } catch (err) {
        console.error('Error saving title edge position:', err)
      }
    },
    [persistMetadata]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return
      const target = e.target as HTMLElement
      // Action buttons handle their own clicks (don’t start edge drag)
      if (target.closest('[data-item-title-expand], [data-item-title-preview]')) return
      e.stopPropagation()
      e.preventDefault()
      dragMovedRef.current = false
      setDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [editing]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !chipRef.current) return
      e.stopPropagation()
      const parent = chipRef.current.offsetParent as HTMLElement | null
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nextT = pointToPerimeterT(width, height, x, y)
      if (Math.abs(nextT - edgeT) > 0.0005) dragMovedRef.current = true
      setEdgeT(nextT)
    },
    [dragging, width, height, edgeT]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      e.stopPropagation()
      setDragging(false)
      if (dragMovedRef.current) {
        void saveEdgePosition(edgeT)
      } else {
        setEditing(true) // Click title text → edit
      }
    },
    [dragging, edgeT, saveEdgePosition]
  )

  const hasTitle = Boolean(displayTitle && displayTitle.trim())
  if (!hasTitle && !selected && !editing) return null

  const pt = perimeterPoint(width, height, edgeT)

  return (
    <div
      ref={chipRef}
      className={cn(
        'item-title-edge nodrag nopan absolute z-[60] pointer-events-auto select-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{
        left: `${pt.x}px`,
        top: `${pt.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'flex items-center gap-0.5 h-7 rounded-md border shadow-sm',
          'bg-white dark:bg-[#1f1f1f] border-gray-200 dark:border-[#2f2f2f]',
          editing && 'border-blue-400'
        )}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitTitle(draft)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitTitle(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(displayTitle || '')
                setEditing(false)
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="Add a title"
            className="min-w-[96px] max-w-[200px] h-full px-2 text-xs bg-transparent text-gray-900 dark:text-gray-100 outline-none"
            title={localLinkedPageId ? 'Edit page title' : 'Add a title to make this a page'}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'h-full px-2 text-xs whitespace-nowrap',
              'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#2a2a2a] rounded-l-md',
              !hasTitle && 'text-gray-400 dark:text-gray-500 italic'
            )}
            title={
              hasTitle
                ? 'Drag along edge · click to edit'
                : 'Add a title — titled items become pages with their own maps'
            }
          >
            {hasTitle ? displayTitle : 'Add a title'}
          </button>
        )}

        {/* Preview = board-within-board; Expand = navigate to the page’s own map */}
        {localLinkedPageId && hasTitle && !editing && (
          <>
            {!embedded && onTogglePreview && (
              <button
                type="button"
                data-item-title-preview
                className={cn(
                  'h-full px-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#2a2a2a]',
                  previewOpen && 'text-blue-600 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-950/40'
                )}
                title={previewOpen ? 'Close page preview' : 'Preview page in place'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onTogglePreview()
                }}
              >
                <AppWindow className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              data-item-title-expand
              className="h-full px-1.5 rounded-r-md text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-[#2a2a2a]"
              title="Open page map"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                openLinkedPage()
              }}
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
