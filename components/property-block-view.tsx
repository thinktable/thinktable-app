'use client'

// React NodeView for propertyBlock: cell box with the type icon inside + Empty placeholder.
// Header-only (empty + !inline) renders nothing in the body — icon lives on the frame top strip.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '@/lib/utils'
import {
  isPropertyTypeId,
  propertyTypeLabel,
  type PropertyTypeId,
} from '@/lib/blocks/property'
import { PropertyIconWithTooltip } from '@/components/property-icon-with-tooltip' // Type glyph + name popup
import { PropertyValuePopup, type PropertyEditorAnchor } from '@/components/property-value-popup' // Calendar / checkbox / text
import {
  bindPropertyIconDrag,
  type PropertyDropLine,
} from '@/lib/tiptap/property-block-drag' // Reorder among property cells
import { PropertyDropLinePortal } from '@/components/property-drop-line-portal' // Blue dashed insert line
import {
  isPropertyBlockHeaderOnly,
  isPropertyBlockInline,
} from '@/lib/tiptap/property-block'

// Caret room past the last glyph — the frame hug reads the width we set here, so any slack
// has to live in this one number or the cell ends up wider than the frame and clips.
const VALUE_CARET_PAD = 2

/**
 * Glyph run of `text` in the cell's own font. Probe lives on `document.body` (outside the RF
 * transform), so the result is already local px — and it never reads the cell's own layout,
 * which would make the width depend on the width we are about to set.
 */
function measureValueWidth(el: HTMLElement, text: string): number {
  const probe = document.createElement('span')
  const cs = getComputedStyle(el)
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.whiteSpace = 'pre'
  probe.style.font = cs.font
  probe.style.letterSpacing = cs.letterSpacing
  probe.textContent = text
  document.body.appendChild(probe)
  const w = probe.getBoundingClientRect().width
  probe.remove()
  return Math.ceil(w) + VALUE_CARET_PAD
}

function propertyTypeNeedsPopup(type: PropertyTypeId): boolean {
  return (
    type === 'date' ||
    type === 'createdTime' ||
    type === 'lastEditedTime' ||
    type === 'checkbox' ||
    type === 'select' ||
    type === 'status' ||
    type === 'multiSelect'
  )
}

export function PropertyBlockView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const rawType = node.attrs.propertyType as string
  const propertyType: PropertyTypeId = isPropertyTypeId(rawType) ? rawType : 'text'
  const stored = typeof node.attrs.value === 'string' ? node.attrs.value : ''
  const propertyName = typeof node.attrs.propertyName === 'string' ? node.attrs.propertyName : ''
  const inline = isPropertyBlockInline(node.attrs as Record<string, unknown>)
  const headerOnly = isPropertyBlockHeaderOnly(node.attrs as Record<string, unknown>)
  const [draft, setDraft] = useState(stored)
  const label = propertyTypeLabel(propertyType)
  const iconRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [editorOpen, setEditorOpen] = useState<PropertyEditorAnchor | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; type: PropertyTypeId } | null>(null)
  const [dropLine, setDropLine] = useState<PropertyDropLine | null>(null)
  const [canEditCell, setCanEditCell] = useState(() => !!editor?.isEditable)
  // Frame is in "fit to text" (nowrap) mode — same flag the text blocks key off. The host
  // toggles both attributes via setOptions/DOM (no transaction), so watch, never read once.
  const [nowrap, setNowrap] = useState(false)

  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined
    if (!dom) return
    const sync = () => {
      setCanEditCell(!!editor?.isEditable)
      setNowrap(dom.getAttribute('data-single-line') === 'true')
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(dom, { attributes: true, attributeFilter: ['contenteditable', 'data-single-line'] })
    return () => mo.disconnect()
  }, [editor])

  useEffect(() => {
    setDraft(stored)
  }, [stored])

  const commit = useCallback(() => {
    const next = draft.trim()
    if (next === stored) return
    updateAttributes({ value: next })
  }, [draft, stored, updateAttributes])

  const openValuePopup = useCallback(() => {
    const el = iconRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setEditorOpen({ left: r.left, top: r.top, width: r.width, height: r.height })
  }, [])

  const focusInput = useCallback(() => {
    const input = inputRef.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  }, [])

  // A textarea has no intrinsic size: `cols` (not the value) drives width and `rows` drives
  // height. Nowrap frames get an explicit glyph width so the cell stays on ONE line and the
  // frame hug (which reads this same width) fits it; wrap frames stretch and grow taller.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const fitHeight = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    if (nowrap) {
      el.style.width = `${measureValueWidth(el, draft || 'Empty')}px`
      fitHeight()
      return
    }
    el.style.width = ''
    fitHeight()
    let lastW = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastW) return // Height-only change — must not re-enter
      lastW = el.clientWidth
      fitHeight()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draft, nowrap, canEditCell])

  const onIconPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!canEditCell || !editor || editor.isDestroyed) return
      const from = getPos?.()
      if (from == null || from < 0) return
      bindPropertyIconDrag(e, {
        getEditor: () => editor,
        from,
        el: e.currentTarget,
        iconType: propertyType,
        onClick: () => {
          if (propertyTypeNeedsPopup(propertyType)) openValuePopup()
          else focusInput()
        },
        callbacks: { setGhost, setDropLine },
      })
    },
    [canEditCell, editor, getPos, propertyType, openValuePopup, focusInput]
  )

  if (headerOnly) {
    return (
      <NodeViewWrapper
        as="div"
        className="tt-property-block tt-property-block-header-only nokey"
        data-type="propertyBlock"
        data-header-only="true"
        style={{ display: 'none' }}
      />
    )
  }

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-property-block nokey',
        canEditCell && 'nodrag',
        selected && canEditCell && 'tt-property-block-selected'
      )}
      data-type="propertyBlock"
      data-inline={inline ? 'true' : undefined}
    >
      <div className="tt-property-block-row">
        <div
          className="tt-property-block-cell"
          onPointerDown={(e) => {
            if (!canEditCell) return
            if ((e.target as HTMLElement).closest('.tt-property-block-input')) return
            if ((e.target as HTMLElement).closest('[data-tt-property-icon]')) return
            e.stopPropagation()
            e.preventDefault()
            focusInput()
          }}
        >
          <span ref={iconRef} className="inline-flex">
            <PropertyIconWithTooltip
              type={propertyType}
              name={propertyName}
              className={cn('tt-property-block-icon', canEditCell && 'cursor-grab active:cursor-grabbing')}
              onPointerDown={onIconPointerDown}
            />
          </span>
          {/* Textarea, not input: a long value **wraps** inside the fixed column instead of
              ellipsizing, so the frame grows in height and never cuts text off. Enter still
              blurs (below), so the value stays single-line data. */}
          <span className="tt-property-block-value">
            <textarea
              ref={inputRef}
              rows={1}
              className={cn('tt-property-block-input', !canEditCell && 'pointer-events-none')}
              value={draft}
              placeholder="Empty"
              aria-label={`${propertyName.trim() || label} value`}
              readOnly={!canEditCell}
              tabIndex={canEditCell ? 0 : -1}
              onPointerDown={(e) => {
                if (!canEditCell) return
                e.stopPropagation()
              }}
              onMouseDown={(e) => {
                if (!canEditCell) {
                  e.preventDefault()
                  return
                }
              }}
              onClick={(e) => {
                if (!canEditCell) return
                e.stopPropagation()
              }}
              onChange={(e) => {
                const v = e.target.value
                setDraft(v)
                const wasEmpty = !stored.trim()
                const nowEmpty = !v.trim()
                if (wasEmpty !== nowEmpty) {
                  updateAttributes({ value: nowEmpty ? '' : v.trim() })
                }
              }}
              onBlur={commit}
              onKeyDown={(e) => {
                if (!canEditCell) return
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
            />
          </span>
        </div>
      </div>
      <PropertyValuePopup
        open={!!editorOpen}
        anchor={editorOpen}
        type={propertyType}
        name={propertyName}
        value={stored}
        onCommit={(next) => {
          setDraft(next)
          updateAttributes({ value: next })
        }}
        onClose={() => setEditorOpen(null)}
      />
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
    </NodeViewWrapper>
  )
}
