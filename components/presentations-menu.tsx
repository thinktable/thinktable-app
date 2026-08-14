'use client'

// View-bar Presentation popover — pick a presentation, then order its captures

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react' // Picker + list
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core' // Capture reorder
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable' // Vertical list + transitions
import { CSS } from '@dnd-kit/utilities' // Translate while dragging
import { ChevronDown, GripVertical, Plus, Presentation, Scan } from 'lucide-react' // Header + gap chrome
import { Button } from '@/components/ui/button' // Ghost icon trigger
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Anchored panel under the screen icon
import {
  formatCaptureTimestamp,
  getCaptures,
  getPresentations,
  insertCaptureIntoPresentation,
  setPresentationCaptureOrder,
  subscribeCaptures,
  type BoardCapture,
} from '@/lib/captures' // Local store
import { cn } from '@/lib/utils' // Class merge
import { ToolbarTitle } from './toolbar-title' // Animated icon-adjacent title

type PresentationsMenuProps = {
  open: boolean // Controlled by editor-toolbar openDropdown
  onOpenChange: (open: boolean) => void // Keep only one toolbar dropdown open
  triggerVisible?: boolean // false when overflowed into More (still mount for controlled open)
  showLabel?: boolean // false when the top bar has condensed titles to icons
}

/** Hairline between captures: + inserts at this index. */
function InsertGap({
  onAdd,
}: {
  onAdd: () => void // Open the capture picker at this index
}) {
  return (
    <div className="relative flex h-5 items-center justify-center">
      <div className="absolute inset-x-6 h-px bg-gray-200" /> {/* Gap line */}
      <button
        type="button"
        className="relative z-[1] flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
        aria-label="Add capture here"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onAdd}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  )
}

/** One ordered capture: plus in the gap above, grip on the left of the mini preview row. */
function SortableCaptureRow({
  capture,
  index,
  onAddAt,
  onPreview,
}: {
  capture: BoardCapture
  index: number
  onAddAt: (index: number) => void
  onPreview: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: capture.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), // Follow pointer
    transition: transition || 'transform 200ms ease', // Slide neighbors into place
    zIndex: isDragging ? 2 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col">
      <InsertGap onAdd={() => onAddAt(index)} />
      <div className="flex items-center gap-1.5 rounded-lg py-1.5 pr-1 hover:bg-gray-50">
        <button
          type="button"
          className="flex h-11 w-5 flex-shrink-0 cursor-grab items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
          aria-label="Reorder capture"
          title="Reorder capture"
          {...attributes}
          {...listeners}
          onPointerDown={(e) => {
            e.stopPropagation() // Keep the presentation menu open
            const fn = listeners?.onPointerDown
            if (typeof fn === 'function') fn(e) // Still arm dnd-kit
          }}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="h-11 w-[4.5rem] flex-shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50"
          title="Preview capture"
          aria-label="Preview capture"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (capture.imageDataUrl) onPreview(capture.id)
          }}
        >
          {capture.imageDataUrl ? (
            <img src={capture.imageDataUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-gray-300">
              <Scan className="h-4 w-4" />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[13px] font-medium text-gray-900">
            {formatCaptureTimestamp(capture.createdAt)}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-gray-500">{capture.boardPath}</div>
        </div>
      </div>
    </div>
  )
}

export function PresentationsMenu({
  open,
  onOpenChange,
  triggerVisible = true,
  showLabel = true, // Icon+title until the top bar condenses
}: PresentationsMenuProps) {
  const presentations = useSyncExternalStore(subscribeCaptures, getPresentations, getPresentations)
  const captures = useSyncExternalStore(subscribeCaptures, getCaptures, getCaptures)
  const [selectedId, setSelectedId] = useState<string | null>(null) // Active presentation
  const [pickerOpen, setPickerOpen] = useState(false) // Header presentation list
  const [insertAt, setInsertAt] = useState<number | null>(null) // + picker index
  const [previewId, setPreviewId] = useState<string | null>(null) // Expanded JPEG

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }) // Don't steal + clicks
  )

  useEffect(() => {
    if (!presentations.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !presentations.some((p) => p.id === selectedId)) {
      setSelectedId(presentations[0].id) // Default to first
    }
  }, [presentations, selectedId])

  const selected = presentations.find((p) => p.id === selectedId) || null
  const orderedCaptures = useMemo(() => {
    if (!selected) return []
    const byId = new Map(captures.map((c) => [c.id, c]))
    return selected.captureIds.map((id) => byId.get(id)).filter((c): c is BoardCapture => Boolean(c))
  }, [selected, captures])

  const addableCaptures = useMemo(() => {
    const used = new Set(selected?.captureIds || [])
    return captures.filter((c) => !used.has(c.id))
  }, [captures, selected])

  const previewItem = previewId ? orderedCaptures.find((c) => c.id === previewId) : undefined

  const onDragEnd = (event: DragEndEvent) => {
    if (!selected) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = selected.captureIds.filter((id) => orderedCaptures.some((c) => c.id === id))
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    setPresentationCaptureOrder(selected.id, arrayMove(ids, oldIndex, newIndex))
  }

  const insertCapture = (captureId: string) => {
    if (!selected || insertAt === null) return
    insertCaptureIntoPresentation(selected.id, captureId, insertAt)
    setInsertAt(null)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPickerOpen(false)
          setInsertAt(null)
          setPreviewId(null)
        }
        onOpenChange(next)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
            'transition-[padding,gap] duration-200 ease-out', // Pad/gap tween with the title width
            showLabel ? 'px-2 gap-1.5' : 'px-1.5 gap-0', // Title condenses to icon on shrink
            !triggerVisible && 'hidden'
          )}
          title="Present"
          aria-label="Present"
        >
          <Presentation className="h-4 w-4 flex-shrink-0" />
          <ToolbarTitle show={showLabel}>Present</ToolbarTitle>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="relative w-[340px] rounded-xl border-gray-200 p-0 shadow-md overflow-hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Presentation picker (was filter/search) · Present on the right */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-left text-sm text-gray-900 hover:bg-gray-50"
              disabled={presentations.length === 0}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!presentations.length) return
                setPickerOpen((v) => !v)
                setInsertAt(null)
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {selected?.name || 'No presentations'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            </button>
            {pickerOpen && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-md">
                {presentations.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'flex w-full px-2.5 py-1.5 text-left text-sm hover:bg-gray-50',
                      p.id === selectedId && 'font-medium text-gray-900'
                    )}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedId(p.id)
                      setPickerOpen(false)
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={cn(
              'flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium',
              selected
                ? 'text-gray-700 hover:bg-gray-100'
                : 'pointer-events-none opacity-40'
            )}
            title="Present"
            aria-label="Present"
            disabled={!selected}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!selected) return
              // Play this presentation — wired later
            }}
          >
            <Presentation className="h-3.5 w-3.5" />
            Present
          </button>
        </div>

        <div className="relative max-h-80 overflow-y-auto px-2 pb-2">
          {!selected ? (
            <div className="px-1 py-8 text-center text-xs text-gray-400">
              Add a presentation from Capture
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={orderedCaptures.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedCaptures.map((capture, index) => (
                  <SortableCaptureRow
                    key={capture.id}
                    capture={capture}
                    index={index}
                    onAddAt={(i) => {
                      setInsertAt(i)
                      setPickerOpen(false)
                    }}
                    onPreview={setPreviewId}
                  />
                ))}
              </SortableContext>
              <InsertGap
                onAdd={() => {
                  setInsertAt(orderedCaptures.length)
                  setPickerOpen(false)
                }}
              />
              {orderedCaptures.length === 0 && (
                <div className="px-1 pb-3 text-center text-xs text-gray-400">No captures yet</div>
              )}
            </DndContext>
          )}

          {insertAt !== null && selected && (
            <div className="absolute inset-x-2 top-1 z-10 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-md">
              {addableCaptures.length === 0 ? (
                <div className="px-2.5 py-3 text-xs text-gray-400">No more captures to add</div>
              ) : (
                addableCaptures.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-50"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => insertCapture(c.id)}
                  >
                    <span className="h-8 w-12 flex-shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50">
                      {c.imageDataUrl ? (
                        <img src={c.imageDataUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-gray-300">
                          <Scan className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-gray-900">
                        {formatCaptureTimestamp(c.createdAt)}
                      </span>
                      <span className="block truncate text-[11px] text-gray-500">{c.boardPath}</span>
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                className="w-full px-2.5 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setInsertAt(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {previewItem?.imageDataUrl && (
          <button
            type="button"
            className="absolute inset-0 z-20 flex flex-col bg-white p-2 text-left"
            aria-label="Close preview"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setPreviewId(null)}
          >
            <img
              src={previewItem.imageDataUrl}
              alt=""
              className="min-h-0 w-full flex-1 rounded-md bg-gray-50 object-contain"
            />
            <span className="mt-1.5 text-[12px] font-medium text-gray-900">
              {formatCaptureTimestamp(previewItem.createdAt)}
            </span>
            <span className="truncate text-[11px] text-gray-500">{previewItem.boardPath}</span>
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
