'use client'

// React NodeView for propertyBlock: cell box with the type icon inside + Empty placeholder.
// Header-only (empty + !inline) renders nothing in the body — icon lives on the frame top strip.

import { useCallback, useEffect, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '@/lib/utils'
import {
  isPropertyTypeId,
  propertyTypeLabel,
  type PropertyTypeId,
} from '@/lib/blocks/property'
import { PropertyIconWithTooltip } from '@/components/property-icon-with-tooltip' // Type glyph + name popup
import {
  isPropertyBlockHeaderOnly,
  isPropertyBlockInline,
} from '@/lib/tiptap/property-block'

export function PropertyBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const rawType = node.attrs.propertyType as string // Attr from Turn into / HTML
  const propertyType: PropertyTypeId = isPropertyTypeId(rawType) ? rawType : 'text' // Safe glyph
  const stored = typeof node.attrs.value === 'string' ? node.attrs.value : '' // Persisted cell text
  const inline = isPropertyBlockInline(node.attrs as Record<string, unknown>) // Stay in body when empty
  const headerOnly = isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>) // Top strip only
  const propertyName = typeof node.attrs.propertyName === 'string' ? node.attrs.propertyName : ''
  const [draft, setDraft] = useState(stored) // Local while typing so each keystroke isn't a TipTap attr write
  const label = propertyTypeLabel(propertyType) // Input aria when no Notion name
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

  // Empty DB-card cells stay in the doc for the top strip + table round-trip, but take no body space
  if (headerOnly) {
    return (
      <NodeViewWrapper
        as="div"
        className="tt-property-block tt-property-block-header-only nokey"
        data-type="propertyBlock"
        data-header-only="true"
        style={{ display: 'none' }} // No inline row — icon is on the frame top band
      />
    )
  }

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-property-block nokey', // nokey: typing stays in the cell when selected
        canEditCell && 'nodrag', // Only while the frame is selected — else RF must drag/select the frame
        selected && canEditCell && 'tt-property-block-selected'
      )}
      data-type="propertyBlock"
      data-inline={inline ? 'true' : undefined}
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
          <PropertyIconWithTooltip
            type={propertyType}
            name={propertyName}
            className="tt-property-block-icon"
          />
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
            aria-label={`${propertyName.trim() || label} value`}
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
            onChange={(e) => {
              const v = e.target.value
              setDraft(v) // Local while typing
              // Flip top-strip ↔ body as soon as emptiness changes (don't wait for blur)
              const wasEmpty = !stored.trim()
              const nowEmpty = !v.trim()
              if (wasEmpty !== nowEmpty) {
                // Clearing a non-inline cell moves it to the top strip; keep inline as-is
                updateAttributes({ value: nowEmpty ? '' : v.trim() })
              }
            }}
            onBlur={commit} // Persist full text on leave
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
