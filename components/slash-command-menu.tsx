'use client'

// Notion-style slash command popup — all sections, previews, badges.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { applySlashMenuPlacement, watchMenuSafeRect } from '@/lib/menu-placement'
import type { SuggestionProps } from '@tiptap/suggestion'
import {
  Bookmark,
  Calendar,
  ChevronRight,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  File,
  FileText,
  FolderInput,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Hash,
  Image as ImageIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Music,
  Paperclip,
  PersonStanding,
  Quote,
  RefreshCw,
  Sigma,
  Smile,
  Sparkles,
  SquareCode,
  Table2,
  TextCursorInput,
  Triangle,
  Type,
  Video,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SLASH_CODE_LANGUAGES,
  slashCommandSections,
  type SlashCommandItem,
} from '@/lib/tiptap/slash-command-items'

const ICONS: Record<string, React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  turnText: <Type className="h-4 w-4" />,
  heading1: <Heading1 className="h-4 w-4" />,
  turnHeading1: <Heading1 className="h-4 w-4" />,
  heading2: <Heading2 className="h-4 w-4" />,
  turnHeading2: <Heading2 className="h-4 w-4" />,
  heading3: <Heading3 className="h-4 w-4" />,
  turnHeading3: <Heading3 className="h-4 w-4" />,
  heading4: <Heading4 className="h-4 w-4" />,
  turnHeading4: <Heading4 className="h-4 w-4" />,
  bulletedList: <List className="h-4 w-4" />,
  turnBulletedList: <List className="h-4 w-4" />,
  numberedList: <ListOrdered className="h-4 w-4" />,
  turnNumberedList: <ListOrdered className="h-4 w-4" />,
  todoList: <ListChecks className="h-4 w-4" />,
  turnTodoList: <ListChecks className="h-4 w-4" />,
  toggleList: <Triangle className="h-3.5 w-3.5 rotate-90" />,
  turnToggleList: <Triangle className="h-3.5 w-3.5 rotate-90" />,
  board: <FileText className="h-4 w-4" />,
  turnBoard: <FileText className="h-4 w-4" />,
  boardIn: <FolderInput className="h-4 w-4" />,
  turnBoardIn: <FolderInput className="h-4 w-4" />,
  callout: <TextCursorInput className="h-4 w-4" />,
  turnCallout: <TextCursorInput className="h-4 w-4" />,
  quote: <Quote className="h-4 w-4" />,
  turnQuote: <Quote className="h-4 w-4" />,
  table: <Table2 className="h-4 w-4" />,
  divider: <Minus className="h-4 w-4" />,
  linkToPage: <FileText className="h-4 w-4" />,
  tableOfContents: <ListTree className="h-4 w-4" />,
  blockEquation: <Sigma className="h-4 w-4" />,
  turnBlockEquation: <Sigma className="h-4 w-4" />,
  button: <ChevronRight className="h-4 w-4" />,
  breadcrumb: <Hash className="h-4 w-4" />,
  tabs: <Columns2 className="h-4 w-4" />,
  syncedBlock: <RefreshCw className="h-4 w-4" />,
  turnSyncedBlock: <RefreshCw className="h-4 w-4" />,
  toggleHeading1: <Heading1 className="h-4 w-4" />,
  turnToggleHeading1: <Heading1 className="h-4 w-4" />,
  toggleHeading2: <Heading2 className="h-4 w-4" />,
  turnToggleHeading2: <Heading2 className="h-4 w-4" />,
  toggleHeading3: <Heading3 className="h-4 w-4" />,
  turnToggleHeading3: <Heading3 className="h-4 w-4" />,
  toggleHeading4: <Heading4 className="h-4 w-4" />,
  turnToggleHeading4: <Heading4 className="h-4 w-4" />,
  columns2: <Columns2 className="h-4 w-4" />,
  turnColumns2: <Columns2 className="h-4 w-4" />,
  columns3: <Columns3 className="h-4 w-4" />,
  turnColumns3: <Columns3 className="h-4 w-4" />,
  columns4: <Columns4 className="h-4 w-4" />,
  turnColumns4: <Columns4 className="h-4 w-4" />,
  columns5: <Columns4 className="h-4 w-4" />,
  turnColumns5: <Columns4 className="h-4 w-4" />,
  aiMeetingNotes: <MessageSquare className="h-4 w-4" />,
  codeMermaid: <GitBranch className="h-4 w-4" />,
  aiBlock: <Sparkles className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  audio: <Music className="h-4 w-4" />,
  code: <SquareCode className="h-4 w-4" />,
  turnCode: <SquareCode className="h-4 w-4" />,
  file: <Paperclip className="h-4 w-4" />,
  webBookmark: <Bookmark className="h-4 w-4" />,
  mentionPerson: <PersonStanding className="h-4 w-4" />,
  mentionPage: <FileText className="h-4 w-4" />,
  dateReminder: <Calendar className="h-4 w-4" />,
  emoji: <Smile className="h-4 w-4" />,
  inlineEquation: <Sigma className="h-4 w-4" />,
  actionCopyLink: <Link2 className="h-4 w-4" />,
  actionDuplicate: <File className="h-4 w-4" />,
  actionMoveTo: <FolderInput className="h-4 w-4" />,
  actionDelete: <Minus className="h-4 w-4 text-red-500" />,
  actionPresent: <Video className="h-4 w-4" />,
  actionAskAi: <Wand2 className="h-4 w-4" />,
}

function slashIcon(item: SlashCommandItem): React.ReactNode {
  if (item.colorSwatch) {
    const isText = item.section === 'Text color'
    const dark = item.colorSwatch === '#000000' || item.colorSwatch === '#6b7280'
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gray-200 text-[10px] font-semibold dark:border-[#3a3a3a]"
        style={{
          backgroundColor: item.colorSwatch || '#ffffff',
          color: isText && dark ? '#ffffff' : isText ? item.colorSwatch : undefined,
        }}
      >
        {isText ? 'A' : null}
      </span>
    )
  }
  if (item.id.startsWith('embed_')) return <Link2 className="h-4 w-4" />
  if (item.id.startsWith('import_')) return <FileText className="h-4 w-4" />
  return ICONS[item.id] ?? <FileText className="h-4 w-4" />
}

export type SlashCommandMenuRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

type SlashCommandMenuProps = SuggestionProps<SlashCommandItem, SlashCommandItem> & {
  menuRef?: (ref: SlashCommandMenuRef | null) => void
}

export function SlashCommandMenu(props: SlashCommandMenuProps) {
  const { items, command, query, editor, range, menuRef } = props
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [codeFlyout, setCodeFlyout] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const sections = useMemo(() => slashCommandSections(items), [items])
  const selectedItem = items[selectedIndex]

  useEffect(() => {
    setSelectedIndex(0)
    setCodeFlyout(false)
  }, [items, query])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-slash-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const selectCodeLanguage = useCallback(
    (language?: string) => {
      const codeItem = items.find((i) => i.id === 'code')
      if (!codeItem) return
      command({ ...codeItem, language } as SlashCommandItem & { language?: string })
      setCodeFlyout(false)
    },
    [items, command]
  )

  const onKeyDown = useCallback(
    ({ event }: { event: KeyboardEvent }) => {
      if (codeFlyout) {
        if (event.key === 'Escape') {
          setCodeFlyout(false)
          return true
        }
        return false
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (!item || item.disabled) return false
        if (item.id === 'code') {
          setCodeFlyout(true)
          return true
        }
        command(item)
        return true
      }
      return false
    },
    [codeFlyout, items, selectedIndex, command]
  )

  useEffect(() => {
    menuRef?.({ onKeyDown })
    return () => menuRef?.(null)
  }, [menuRef, onKeyDown])

  // Re-clamp when the keyboard / safe rect moves (TipTap mount also places on every float tick)
  useLayoutEffect(() => {
    const shell = rootRef.current?.parentElement
    if (!shell?.classList.contains('tt-menu-surface')) return
    const place = () => applySlashMenuPlacement(shell) // Uses caret stashed by slash-command mount
    place()
    const raf = requestAnimationFrame(place)
    const stop = watchMenuSafeRect(place)
    return () => {
      cancelAnimationFrame(raf)
      stop()
    }
  }, [items, query, codeFlyout])

  if (!items.length) {
    return <div className="w-[300px] p-3 text-sm text-gray-500">No results</div>
  }

  let runningIndex = 0

  return (
    <div
      ref={rootRef}
      className="relative z-0 flex min-h-0 w-[300px] flex-1 flex-col overflow-visible"
      onMouseDown={(e) => {
        if ((e.target as Element).closest('[data-tt-menu-body]')) return // Let touch scroll the list
        e.preventDefault() // Keep TipTap caret while picking from footer / chrome
      }}
    >
      <div
        ref={listRef}
        data-tt-menu-body
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 touch-pan-y"
      >
        {sections.map((section) => {
          const sectionItems = items.filter((i) => i.section === section)
          return (
            <div key={section} className="mb-1">
              <div className="px-2 py-1 text-[11px] text-gray-400">{section}</div>
              {sectionItems.map((item) => {
                const index = runningIndex++
                const selected = index === selectedIndex
                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    size="sm"
                    disabled={item.disabled}
                    data-slash-selected={selected ? 'true' : undefined}
                    onMouseEnter={() => {
                      setSelectedIndex(index)
                      setCodeFlyout(item.id === 'code')
                    }}
                    onClick={(e) => {
                      e.preventDefault()
                      if (item.disabled) return
                      if (item.id === 'code') {
                        setCodeFlyout(true)
                        return
                      }
                      command(item)
                    }}
                    className={cn(
                      'justify-start gap-2 text-sm h-7 px-2 font-normal w-full',
                      selected && 'bg-gray-100 dark:bg-[#2a2a2a]',
                      item.disabled && 'opacity-50',
                      item.id === 'actionDelete' && 'text-red-600 dark:text-red-400'
                    )}
                  >
                    <span className="text-gray-500 dark:text-gray-400">{slashIcon(item)}</span>
                    <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none',
                          item.badge === 'Beta'
                            ? 'bg-gray-100 text-gray-500 dark:bg-[#2a2a2a] dark:text-gray-400'
                            : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{item.shortcut}</span>
                    ) : item.hasSubmenu ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                    ) : null}
                  </Button>
                )
              })}
            </div>
          )
        })}
      </div>

      <div
        data-tt-slash-footer
        className="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:border-[#2f2f2f]"
      >
        <span>Close menu</span>
        <span className="text-[10px] text-gray-400">esc</span>
      </div>

      {codeFlyout && (
        <div
          className="absolute left-full top-0 z-[1] ml-1 min-w-[180px] overflow-y-auto tt-menu-surface relative rounded-lg border border-gray-200 p-1 shadow-lg dark:border-[#2f2f2f] max-h-[min(70vh,320px)]"
          onMouseEnter={() => setCodeFlyout(true)}
        >
          <div className="px-2 py-1.5 text-[11px] text-gray-400">Language</div>
          {SLASH_CODE_LANGUAGES.map((lang) => (
            <Button
              key={lang.id}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                selectCodeLanguage(lang.id)
              }}
              className="justify-start text-sm h-8 px-2 font-normal w-full"
            >
              {lang.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              selectCodeLanguage()
            }}
            className="justify-start text-sm h-8 px-2 font-normal w-full text-gray-500"
          >
            Plain text
          </Button>
        </div>
      )}

      {selectedItem?.preview && !codeFlyout && (
        <div
          className="absolute left-full top-0 z-[1] ml-2 w-[220px] rounded-lg border border-gray-700 bg-gray-900 p-3 text-center text-xs text-gray-200 shadow-lg"
        >
          {selectedItem.id === 'image' && (
            <div className="mb-2 flex h-16 items-center justify-center rounded-md bg-gray-800">
              <ImageIcon className="h-8 w-8 text-gray-500" />
            </div>
          )}
          {selectedItem.id === 'tabs' && (
            <div className="mb-2 flex h-16 items-center justify-center rounded-md bg-white p-2 text-[10px] text-gray-600">
              <div className="flex gap-1">
                <span className="rounded bg-gray-100 px-2 py-0.5">Do this</span>
                <span className="px-2 py-0.5">Don&apos;t</span>
              </div>
            </div>
          )}
          {selectedItem.id.startsWith('columns') || selectedItem.id.startsWith('turnColumns') ? (
            <div className="mb-2 flex h-16 items-center justify-center rounded-md bg-white p-2 text-[10px] text-gray-500">
              <Columns2 className="h-8 w-8" />
            </div>
          ) : null}
          {selectedItem.preview}
        </div>
      )}
    </div>
  )
}
