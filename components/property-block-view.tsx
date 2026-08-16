'use client'

// React NodeView for propertyBlock: cell box with the type icon inside + Empty placeholder.
// Lives on the **block** line; the host **frame** still shows its own top property icon.

import { useCallback, useEffect, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '@/lib/utils'
import {
  isPropertyTypeId,
  propertyTypeIcon,
  propertyTypeLabel,
  type PropertyTypeId,
} from '@/lib/blocks/property'

export function PropertyBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const rawType = node.attrs.propertyType as string // Attr from Turn into / HTML
  const propertyType: PropertyTypeId = isPropertyTypeId(rawType) ? rawType : 'text' // Safe glyph
  const stored = typeof node.attrs.value === 'string' ? node.attrs.value : '' // Persisted cell text
  const [draft, setDraft] = useState(stored) // Local while typing so each keystroke isn't a TipTap attr write
  const label = propertyTypeLabel(propertyType) // aria / title for the type glyph
  // Frame deselected → TipTap editable=false; keep the native input from stealing clicks / re-focusing.
  // Host `setOptions({ editable })` fires no transaction, so a one-shot `editor.isEditable` read goes
  // stale until the next doc change — that left the cell inert (no hover border, first click lost).
  const [canEditCell, setCanEditCell] = useState(() => !!editor?.isEditable)

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined
    if (!dom) return
    const sync = () => setCanEditCell(!!editor?.isEditable)
    sync() // Catch a toggle that landed before this effect ran
    // PM mirrors `editable` onto the editor DOM's contenteditable — observe that instead of polling
    const mo = new MutationObserver(sync)
    mo.observe(dom, { attributes: true, attributeFilter: ['contenteditable'] })
    return () => mo.disconnect()
  }, [editor])

  useEffect(() => {
    setDraft(stored) // Remote / Turn-into attr updates win over a stale draft
  }, [stored])

  // Commit the cell into node attrs (survives reload via message HTML)
  const commit = useCallback(() => {
    const next = draft.trim() // Don't persist whitespace-only as a value
    if (next === stored) return // No-op when unchanged
    updateAttributes({ value: next })
  }, [draft, stored, updateAttributes])

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-property-block nokey', // nokey: typing stays in the cell when selected
        canEditCell && 'nodrag', // Only while the frame is selected — else RF must drag/select the frame
        selected && canEditCell && 'tt-property-block-selected'
      )}
      data-type="propertyBlock"
    >
      {/* First-line band the ⋮⋮ grip measures (same idea as imageBlock / databaseBlock) */}
      <div className="tt-property-block-row">
        <div
          className="tt-property-block-cell"
          onPointerDown={(e) => {
            if (!canEditCell) return // Unselected: let RF select the frame
            if ((e.target as HTMLElement).closest('.tt-property-block-input')) return // Input handles itself
            // Icon / cell padding is still the cell — claim it before PM turns this into a
            // NodeSelection, and put the caret in the value so one click lands the I-bar
            e.stopPropagation()
            e.preventDefault()
            const input = e.currentTarget.querySelector('input') as HTMLInputElement | null
            input?.focus()
            input?.setSelectionRange(input.value.length, input.value.length)
          }}
        >
          <span
            className="tt-property-block-icon"
            title={label}
            aria-hidden
          >
            {propertyTypeIcon(propertyType, 'h-4 w-4')}
          </span>
          <input
            type="text"
            className={cn(
              'tt-property-block-input',
              // Only the input ignores hits while unselected — the cell/row stay hoverable so the
              // border still paints, and the select click falls through to PM instead of focusing here
              !canEditCell && 'pointer-events-none'
            )}
            value={draft}
            placeholder="Empty"
            aria-label={`${label} value`}
            readOnly={!canEditCell} // Unselected frame: display only — click selects the frame
            tabIndex={canEditCell ? 0 : -1} // Don't park focus in a deselected frame
            onPointerDown={(e) => {
              if (!canEditCell) return // Let the event reach RF so the frame selects
              e.stopPropagation() // Selected: don't start frame drag from the cell
            }}
            onMouseDown={(e) => {
              // Belt-and-suspenders if pointer-events is overridden: never focus while unselected
              if (!canEditCell) {
                e.preventDefault()
                return
              }
            }}
            onClick={(e) => {
              if (!canEditCell) return
              e.stopPropagation() // Keep caret in the cell (second click while selected)
            }}
            onChange={(e) => setDraft(e.target.value)} // Type into the cell
            onBlur={commit} // Persist on leave
            onKeyDown={(e) => {
              if (!canEditCell) return
              e.stopPropagation() // Don't let TipTap / RF eat keys
              if (e.key === 'Enter') {
                e.preventDefault() // Property cell is single-line
                ;(e.currentTarget as HTMLInputElement).blur() // Commit via onBlur
              }
            }}
          />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
