'use client'

// Actions-bar Turn into dropdown — same Format / Property picks as the ⋮⋮ block menu.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlignLeft,
  Check,
  ChevronRight,
  CircleChevronDown,
  Columns2,
  Columns3,
  Columns4,
  FileText,
  FolderInput,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  HelpCircle,
  Image as ImageIcon,
  Languages,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  RefreshCw,
  Search,
  Sigma,
  SquareCode,
  TextCursorInput,
  Triangle,
  Type,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BlockTypeId, AiAutofillId, BoardInTarget } from '@/components/block-actions-menu'
import {
  PROPERTY_GROUP_H,
  propertyTypeIcon,
  propertyTypeLabel,
  readFramePropertyType,
  type PropertyTypeId,
} from '@/lib/blocks/property'
import {
  editorBlockToTypeId,
  findEditorBlockAtPos,
  refineListBlockType,
  turnEditorBlockInto,
  turnEditorBlockIntoProperty,
  htmlForEditorRange,
} from '@/lib/tiptap/block-selection'
import {
  createChildBoardForBlock,
  replaceBlockWithBoardLink,
  titleForBlock,
} from '@/lib/tiptap/board-blocks'
import { bodyHtmlWithoutBoardTitle } from '@/lib/blocks/turn-into'
import { isBlockContentEmpty } from '@/lib/blocks'
import { createClient } from '@/lib/supabase/client'

type TurnIntoDef = {
  id: BlockTypeId
  label: string
  icon: React.ReactNode
}

type AiAutofillDef = {
  id: AiAutofillId
  label: string
  icon: React.ReactNode
  badge: 'Basic' | 'Custom Agent'
  chevron?: boolean
}

/** Format rows — matches ⋮⋮ Turn into Format pane. */
const TURN_INTO_OPTIONS: TurnIntoDef[] = [
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'heading1', label: 'Heading 1', icon: <Heading1 className="h-4 w-4" /> },
  { id: 'heading2', label: 'Heading 2', icon: <Heading2 className="h-4 w-4" /> },
  { id: 'heading3', label: 'Heading 3', icon: <Heading3 className="h-4 w-4" /> },
  { id: 'heading4', label: 'Heading 4', icon: <Heading4 className="h-4 w-4" /> },
  { id: 'board', label: 'Board', icon: <FileText className="h-4 w-4" /> },
  { id: 'boardIn', label: 'Board in', icon: <FolderInput className="h-4 w-4" /> },
  { id: 'bulletedList', label: 'Bulleted list', icon: <List className="h-4 w-4" /> },
  { id: 'numberedList', label: 'Numbered list', icon: <ListOrdered className="h-4 w-4" /> },
  { id: 'todoList', label: 'To-do list', icon: <ListChecks className="h-4 w-4" /> },
  { id: 'toggleList', label: 'Toggle list', icon: <Triangle className="h-3.5 w-3.5 rotate-90" /> },
  { id: 'code', label: 'Code', icon: <SquareCode className="h-4 w-4" /> },
  { id: 'quote', label: 'Quote', icon: <Quote className="h-4 w-4" /> },
  { id: 'callout', label: 'Callout', icon: <TextCursorInput className="h-4 w-4" /> },
  { id: 'image', label: 'Image', icon: <ImageIcon className="h-4 w-4" /> },
  { id: 'blockEquation', label: 'Block equation', icon: <Sigma className="h-4 w-4" /> },
  { id: 'syncedBlock', label: 'Synced block', icon: <RefreshCw className="h-4 w-4" /> },
  { id: 'toggleHeading1', label: 'Toggle heading 1', icon: <Heading1 className="h-4 w-4" /> },
  { id: 'toggleHeading2', label: 'Toggle heading 2', icon: <Heading2 className="h-4 w-4" /> },
  { id: 'toggleHeading3', label: 'Toggle heading 3', icon: <Heading3 className="h-4 w-4" /> },
  { id: 'toggleHeading4', label: 'Toggle heading 4', icon: <Heading4 className="h-4 w-4" /> },
  { id: 'columns2', label: '2 columns', icon: <Columns2 className="h-4 w-4" /> },
  { id: 'columns3', label: '3 columns', icon: <Columns3 className="h-4 w-4" /> },
  { id: 'columns4', label: '4 columns', icon: <Columns4 className="h-4 w-4" /> },
  { id: 'columns5', label: '5 columns', icon: <Columns4 className="h-4 w-4" /> },
]

const AI_AUTOFILL_OPTIONS: AiAutofillDef[] = [
  { id: 'summarize', label: 'Summarize', icon: <AlignLeft className="h-4 w-4" />, badge: 'Basic', chevron: true },
  { id: 'translate', label: 'Translate', icon: <Languages className="h-4 w-4" />, badge: 'Basic', chevron: true },
  { id: 'riskTier', label: 'Risk Tier', icon: <CircleChevronDown className="h-4 w-4" />, badge: 'Custom Agent' },
  { id: 'customerSentiment', label: 'Customer Sentiment', icon: <CircleChevronDown className="h-4 w-4" />, badge: 'Custom Agent' },
]

/** Property type bands (ids only — icons/labels from lib/blocks/property). */
const PROPERTY_SECTIONS: { id: string; items: PropertyTypeId[] }[] = [
  {
    id: 'basic',
    items: [
      'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'files',
      'checkbox', 'url', 'phone', 'email',
    ],
  },
  {
    id: 'advanced',
    items: ['relation', 'rollup', 'formula', 'button', 'uniqueId', 'place'],
  },
  {
    id: 'system',
    items: ['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy'],
  },
  {
    id: 'connector',
    items: ['googleDriveFile', 'figmaFile', 'zendeskTicket'],
  },
]

const FORMULA_HINT = new Set<PropertyTypeId>(['formula']) // Trailing help mark

/** Resolve the TipTap block under the caret (or selection start). */
export function resolveToolbarTurnIntoBlock(editor: Editor | null) {
  if (!editor || editor.isDestroyed) return null
  const pos = editor.state.selection.from
  return findEditorBlockAtPos(editor, pos)
}

/** Current Format checkmark for the caret block. */
export function readToolbarBlockType(editor: Editor | null): BlockTypeId {
  const block = resolveToolbarTurnIntoBlock(editor)
  if (!block || !editor) return 'text'
  if (block.typeName === 'listItem') return refineListBlockType(editor, block)
  return editorBlockToTypeId(block)
}

type TurnIntoPick =
  | { kind: 'format'; blockType: BlockTypeId; boardInParentId?: string | null }
  | { kind: 'property'; propertyType: PropertyTypeId }
  | { kind: 'aiAutofill'; aiAutofill: AiAutofillId }

/**
 * Apply a Turn into pick to the active editor’s caret block.
 * Board / Board in seed a child board; Property also stamps frame metadata.
 */
export async function applyToolbarTurnInto(opts: {
  editor: Editor | null
  conversationId?: string
  pick: TurnIntoPick
  getSetNodes?: () => ((nodes: any) => void) | undefined
  reactFlowInstance?: { getNodes: () => any[] } | null
  onDone?: () => void
}): Promise<void> {
  const { editor, conversationId, pick, getSetNodes, reactFlowInstance, onDone } = opts
  const block = resolveToolbarTurnIntoBlock(editor)
  if (!editor || !block) {
    onDone?.()
    return
  }

  if (pick.kind === 'aiAutofill') {
    onDone?.() // Stub until AI Autofill is wired
    return
  }

  if (pick.kind === 'property') {
    turnEditorBlockIntoProperty(editor, block, pick.propertyType)
    // Stamp propertyType on the host frame (top chrome) — same as ⋮⋮ path
    const nodes = reactFlowInstance?.getNodes?.() || []
    const host = nodes.find((n: any) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id)
    const promptMessage = host?.data?.promptMessage
    if (host && promptMessage?.id) {
      const existing = { ...((promptMessage.metadata as Record<string, unknown>) || {}) }
      const firstProperty = readFramePropertyType(existing) == null
      existing.propertyType = pick.propertyType
      const setNodes = getSetNodes?.()
      if (setNodes) {
        setNodes((nds: any[]) =>
          nds.map((n) => {
            if (n.id !== host.id) return n
            const nextPos = firstProperty
              ? { x: n.position.x, y: n.position.y - PROPERTY_GROUP_H }
              : n.position
            if (firstProperty) existing.position = nextPos
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
      }
      try {
        const supabase = createClient()
        await supabase.from('messages').update({ metadata: existing }).eq('id', promptMessage.id)
      } catch (err) {
        console.error('Failed to save frame property type:', err)
      }
    }
    onDone?.()
    return
  }

  const { blockType, boardInParentId } = pick
  if (blockType === 'board' || blockType === 'boardIn') {
    if (!conversationId) {
      onDone?.()
      return
    }
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        onDone?.()
        return
      }
      const rawBody = htmlForEditorRange(editor, block.from, block.to)
      const title = titleForBlock(editor, block)
      const bodyHtml = bodyHtmlWithoutBoardTitle(rawBody, title)
      const parentId = blockType === 'boardIn' && boardInParentId ? boardInParentId : conversationId
      const hostNode = (reactFlowInstance?.getNodes?.() || []).find(
        (n: any) => n.selected && n.type === 'chatPanel' && n.data?.promptMessage?.id
      )
      const sourceMessageId =
        (hostNode?.data?.promptMessage?.id as string | undefined) ||
        String(hostNode?.id || '').replace(/^panel-/, '').replace(/-panel-.*$/, '')
      if (!sourceMessageId) {
        console.error('Turn into Board: missing host message id')
        onDone?.()
        return
      }
      const boardId = await createChildBoardForBlock(supabase, {
        userId: user.id,
        parentId,
        sourceMessageId,
        title,
        bodyHtml: isBlockContentEmpty(bodyHtml) ? undefined : bodyHtml,
      })
      if (!boardId) throw new Error('Failed to create child board')
      replaceBlockWithBoardLink(editor, block, { boardId, title, icon: null, variant: 'inline' })
    } catch (err) {
      console.error('Failed to turn block into board:', err)
    }
    onDone?.()
    return
  }

  turnEditorBlockInto(editor, block, blockType)
  onDone?.()
}

/** Format / Property pane for the Actions-bar Turn into dropdown. */
export function TurnIntoMenuItems({
  editor,
  currentBlockType,
  boardInTargets = [],
  onPick,
}: {
  editor: Editor | null
  currentBlockType: BlockTypeId
  boardInTargets?: BoardInTarget[]
  onPick: (pick: TurnIntoPick) => void
}) {
  const [pane, setPane] = useState<'format' | 'property'>('format')
  const [showBoardIn, setShowBoardIn] = useState(false)
  const [showPropertySearch, setShowPropertySearch] = useState(false)
  const [propertyQuery, setPropertyQuery] = useState('')
  const propertySearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showPropertySearch) propertySearchRef.current?.focus()
  }, [showPropertySearch])

  const propertyFilterQ = propertyQuery.trim().toLowerCase()

  const filteredAi = useMemo(() => {
    if (!propertyFilterQ) return AI_AUTOFILL_OPTIONS
    return AI_AUTOFILL_OPTIONS.filter((t) => t.label.toLowerCase().includes(propertyFilterQ))
  }, [propertyFilterQ])

  const filteredSections = useMemo(() => {
    if (!propertyFilterQ) return PROPERTY_SECTIONS
    return PROPERTY_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((id) => propertyTypeLabel(id).toLowerCase().includes(propertyFilterQ)),
    })).filter((s) => s.items.length > 0)
  }, [propertyFilterQ])

  void editor // Kept for API symmetry with other toolbar menus (caret target resolved by parent)

  return (
    <div
      className={cn(pane === 'property' ? 'w-[320px]' : 'w-max min-w-[180px]')}
      onMouseDown={(e) => e.preventDefault()} // Keep TipTap caret while picking
    >
      {/* Format / Property section headings */}
      <div className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5 dark:border-[#2f2f2f]">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            setPane('format')
            setShowPropertySearch(false)
            setShowBoardIn(false)
          }}
          className={cn(
            'text-[11px]',
            pane === 'format'
              ? 'text-gray-700 dark:text-gray-200'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          )}
        >
          Format
        </button>
        <span className="text-[11px] text-gray-300 dark:text-gray-600" aria-hidden>
          /
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            setPane('property')
            setShowBoardIn(false)
          }}
          className={cn(
            'flex-1 text-left text-[11px]',
            pane === 'property'
              ? 'text-gray-700 dark:text-gray-200'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          )}
        >
          Property
        </button>
        {pane === 'property' && (
          <button
            type="button"
            aria-label="Search properties"
            onClick={(e) => {
              e.preventDefault()
              setShowPropertySearch((v) => !v)
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#2a2a2a]"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {pane === 'format' ? (
        <div className="relative flex w-max min-w-max flex-col gap-1 overflow-y-auto p-1 max-h-[min(70vh,420px)]">
          {TURN_INTO_OPTIONS.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              onMouseEnter={() => {
                if (t.id === 'boardIn') setShowBoardIn(true)
                else setShowBoardIn(false)
              }}
              onClick={(e) => {
                e.preventDefault()
                if (t.id === 'boardIn') {
                  setShowBoardIn(true)
                  return
                }
                onPick({ kind: 'format', blockType: t.id })
              }}
              className={cn(
                'justify-start gap-2 text-sm h-8 px-2 font-normal w-auto min-w-full whitespace-nowrap',
                currentBlockType === t.id && 'bg-blue-50 dark:bg-blue-950/40',
                t.id === 'boardIn' && showBoardIn && 'bg-gray-100 dark:bg-[#2a2a2a]'
              )}
            >
              <span className="text-gray-500 dark:text-gray-400">{t.icon}</span>
              <span className="flex-1 text-left">{t.label}</span>
              {t.id === 'boardIn' && <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
              {currentBlockType === t.id && t.id !== 'boardIn' && (
                <Check className="h-3.5 w-3.5 text-gray-500" />
              )}
            </Button>
          ))}

          {showBoardIn && (
            <div
              className="absolute left-full top-0 z-[1] ml-1 min-w-[200px] overflow-y-auto bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 max-h-[min(70vh,420px)]"
              onMouseEnter={() => setShowBoardIn(true)}
              onMouseLeave={() => setShowBoardIn(false)}
            >
              <div className="px-2 py-1.5 text-[11px] text-gray-400">Nest board under…</div>
              {(boardInTargets.length > 0 ? boardInTargets : [{ id: '', title: 'Current board' }]).map(
                (target) => (
                  <Button
                    key={target.id || 'current'}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      onPick({
                        kind: 'format',
                        blockType: 'boardIn',
                        boardInParentId: target.id || null,
                      })
                    }}
                    className="justify-start text-sm h-8 px-2 font-normal w-full"
                  >
                    <FileText className="h-4 w-4 mr-2 text-gray-500" />
                    <span className="truncate">{target.title || 'Untitled'}</span>
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
          {showPropertySearch && (
            <input
              ref={propertySearchRef}
              value={propertyQuery}
              onChange={(e) => setPropertyQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Type property name..."
              className="mb-1.5 h-7 w-full rounded-md border border-gray-200 bg-gray-50 px-2 text-xs outline-none dark:border-[#3a3a3a] dark:bg-[#2a2a2a] dark:text-gray-100"
            />
          )}

          {filteredAi.length > 0 && (
            <>
              <div className="px-1.5 pb-1 pt-0.5 text-[11px] text-gray-400">AI Autofill</div>
              <div className="flex flex-col gap-0.5">
                {filteredAi.map((t) => (
                  <Button
                    key={t.id}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      onPick({ kind: 'aiAutofill', aiAutofill: t.id })
                    }}
                    className="justify-start text-sm h-8 px-1.5 font-normal w-full"
                  >
                    <span className="mr-1.5 shrink-0 text-gray-500 dark:text-gray-400">{t.icon}</span>
                    <span className="min-w-0 truncate text-left">{t.label}</span>
                    <span
                      className={cn(
                        'ml-1.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none',
                        t.badge === 'Custom Agent'
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-[#2a2a2a] dark:text-gray-400'
                      )}
                    >
                      {t.badge}
                    </span>
                    {t.chevron && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-400" />}
                  </Button>
                ))}
              </div>
              <div className="my-1.5 h-px bg-gray-100 dark:bg-[#2f2f2f]" />
            </>
          )}

          {filteredSections.map((section, i) => (
            <div key={section.id}>
              {i > 0 && <div className="my-1.5 h-px bg-gray-100 dark:bg-[#2f2f2f]" />}
              <div className="grid grid-cols-2 gap-0.5">
                {section.items.map((id) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      onPick({ kind: 'property', propertyType: id })
                    }}
                    className="justify-start text-sm h-8 px-1.5 font-normal w-full"
                  >
                    <span className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-gray-500 dark:text-gray-400">
                      {propertyTypeIcon(id, 'h-4 w-4')}
                    </span>
                    <span className="min-w-0 truncate text-left">{propertyTypeLabel(id)}</span>
                    {FORMULA_HINT.has(id) && (
                      <HelpCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300" />
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
