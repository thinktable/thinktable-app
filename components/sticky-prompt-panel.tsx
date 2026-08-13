'use client'

// Edit panel - always visible at top of map area (menu + board title + toolbar)
import { cn } from '@/lib/utils'
import { EditorToolbar } from './editor-toolbar'
import { useEditorContext } from './editor-context'
import { useRef, useState } from 'react'
import { useSidebarContext } from './sidebar-context'
import { ChevronRight, File, FileText, Menu } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface EditPanelProps {
  conversationId?: string
  projectId?: string
}

// Page icon from conversations.metadata.icon (emoji / image / default)
type PageIconMeta =
  | { type: 'emoji'; emoji: string }
  | { type: 'external'; url: string }
  | { type: 'file'; url: string }
  | null
  | undefined

// Ancestor + current titles for nested boards (Notion-style path)
type BoardPathSegment = {
  id: string
  title: string
  parent_id: string | null
  icon?: PageIconMeta
  hasContent?: boolean
}

// Lightweight board row for sibling / child path menus
type PathBoard = {
  id: string
  title: string
  parent_id: string | null
  archived: boolean
  inProject: boolean
  position?: number
  updated_at: string
  icon?: PageIconMeta
  hasContent?: boolean
}

const PATH_MENU_LIMIT = 8 // Cap visible siblings; show “N more” like Notion

function getParentId(metadata: Record<string, unknown> | null | undefined): string | null {
  const parentRaw = metadata?.parent_id
  return typeof parentRaw === 'string' && parentRaw.trim() !== '' ? parentRaw : null
}

function parseIcon(metadata: Record<string, unknown> | null | undefined): PageIconMeta {
  const raw = metadata?.icon as PageIconMeta
  if (!raw || typeof raw !== 'object') return null
  if (raw.type === 'emoji' && raw.emoji) return raw
  if ((raw.type === 'external' || raw.type === 'file') && 'url' in raw && raw.url) return raw
  return null
}

// Render blank / filled / emoji / image icon for path crumbs and menus
function PathPageIcon({
  icon,
  hasContent,
  className,
}: {
  icon?: PageIconMeta
  hasContent?: boolean
  className?: string
}) {
  if (icon?.type === 'emoji' && icon.emoji) {
    return <span className={cn('text-sm leading-none flex-shrink-0', className)}>{icon.emoji}</span>
  }
  if ((icon?.type === 'external' || icon?.type === 'file') && icon.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon.url} alt="" className={cn('h-3.5 w-3.5 rounded-sm object-cover flex-shrink-0', className)} />
  }
  if (hasContent) {
    return <FileText className={cn('h-3.5 w-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0', className)} />
  }
  return <File className={cn('h-3.5 w-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0', className)} />
}

function sortPathBoards(a: PathBoard, b: PathBoard) {
  if (a.position !== undefined && b.position !== undefined) return a.position - b.position
  if (a.position !== undefined) return -1
  if (b.position !== undefined) return 1
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
}

// One breadcrumb segment: click opens page; hover lists same-level pages
function PathSegmentMenu({
  segment,
  isLast,
  siblings,
  childrenOf,
  currentBoardId,
}: {
  segment: BoardPathSegment
  isLast: boolean
  siblings: PathBoard[]
  childrenOf: (id: string) => PathBoard[]
  currentBoardId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false) // Hover-controlled sibling menu
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setOpen(true)
  }
  const scheduleCloseMenu = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setOpen(false), 160) // Bridge trigger ↔ menu
  }

  const goTo = (id: string) => {
    setOpen(false)
    router.push(`/board/${id}`)
  }

  const visible = siblings.slice(0, PATH_MENU_LIMIT)
  const moreCount = Math.max(0, siblings.length - PATH_MENU_LIMIT)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleCloseMenu}
          onClick={(e) => {
            e.preventDefault()
            goTo(segment.id) // Click path name → open that page
          }}
          className={cn(
            'inline-flex items-center gap-1 truncate max-w-[10rem] rounded px-0.5 -mx-0.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800',
            isLast
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-400 dark:text-gray-500 font-normal'
          )}
          title={segment.title}
        >
          <PathPageIcon icon={segment.icon} hasContent={segment.hasContent} />
          <span className="truncate">{segment.title}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-56 max-h-72 overflow-y-auto"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleCloseMenu}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {visible.map((board) => {
          const kids = childrenOf(board.id)
          const isCurrent = board.id === currentBoardId || board.id === segment.id
          if (kids.length > 0) {
            return (
              <DropdownMenuSub key={board.id}>
                <DropdownMenuSubTrigger
                  className={cn(
                    'cursor-pointer',
                    isCurrent && 'bg-gray-100 dark:bg-[#2a2a3a]'
                  )}
                  onClick={(e) => {
                    e.preventDefault()
                    goTo(board.id) // Click sibling with children still opens it
                  }}
                  >
                    <PathPageIcon icon={board.icon} hasContent={board.hasContent} className="mr-1.5" />
                    <span className="truncate flex-1">{board.title}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52">
                    {kids.map((child) => {
                      const grandkids = childrenOf(child.id)
                      if (grandkids.length > 0) {
                        return (
                          <DropdownMenuSub key={child.id}>
                            <DropdownMenuSubTrigger
                              className="cursor-pointer"
                              onClick={(e) => {
                                e.preventDefault()
                                goTo(child.id)
                              }}
                            >
                              <PathPageIcon icon={child.icon} hasContent={child.hasContent} className="mr-1.5" />
                              <span className="truncate flex-1">{child.title}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-52">
                              {grandkids.map((g) => (
                                <DropdownMenuItem
                                  key={g.id}
                                  className="cursor-pointer"
                                  onClick={() => goTo(g.id)}
                                >
                                  <PathPageIcon icon={g.icon} hasContent={g.hasContent} className="mr-1.5" />
                                  <span className="truncate">{g.title}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )
                      }
                      return (
                        <DropdownMenuItem
                          key={child.id}
                          className={cn(
                            'cursor-pointer',
                            child.id === currentBoardId && 'bg-gray-100 dark:bg-[#2a2a3a]'
                          )}
                          onClick={() => goTo(child.id)}
                        >
                          <PathPageIcon icon={child.icon} hasContent={child.hasContent} className="mr-1.5" />
                          <span className="truncate flex-1">{child.title}</span>
                          <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-0" aria-hidden />
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            }
            return (
              <DropdownMenuItem
                key={board.id}
                className={cn(
                  'cursor-pointer',
                  isCurrent && 'bg-gray-100 dark:bg-[#2a2a3a]'
                )}
                onClick={() => goTo(board.id)}
              >
                <PathPageIcon icon={board.icon} hasContent={board.hasContent} className="mr-1.5" />
                <span className="truncate">{board.title}</span>
              </DropdownMenuItem>
            )
          })}
        {moreCount > 0 && (
          <div className="px-2 py-1.5 text-xs text-gray-400 dark:text-gray-500">
            {moreCount} more
          </div>
        )}
        {siblings.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-gray-400">No boards at this level</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EditPanel({ conversationId, projectId }: EditPanelProps) {
  const { activeEditor } = useEditorContext()
  const [isHidden, setIsHidden] = useState(false) // Track if top bar is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over pill
  const { openSidebar, scheduleCloseSidebar, toggleSidebar, isSidebarPinned, isMobileMode } = useSidebarContext()
  const supabase = createClient() // Client for board/project title lookup

  // Boards for sibling menus (separate key so we don't clash with sidebar Conversation shape)
  const { data: pathBoards = [] } = useQuery({
    queryKey: ['path-board-menu'],
    queryFn: async (): Promise<PathBoard[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, created_at, updated_at, metadata')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(100)
      if (error) {
        console.error('Error fetching boards for path menu:', error)
        return []
      }
      return (data || []).map((conv: any) => {
        const metadata = (conv.metadata as Record<string, unknown>) || {}
        const projectIdMeta = metadata.project_id
        return {
          id: conv.id as string,
          title: ((conv.title as string | undefined)?.trim() || 'Untitled'),
          parent_id: getParentId(metadata),
          archived: metadata.archived === true,
          inProject: typeof projectIdMeta === 'string' && projectIdMeta.trim() !== '',
          position: typeof metadata.position === 'number' ? metadata.position : undefined,
          updated_at: conv.updated_at as string,
          icon: parseIcon(metadata),
          hasContent: metadata.hasContent === true,
        }
      })
    },
    staleTime: 30_000,
  })

  // Resolve current board title + ancestor path when nested under another page
  const { data: titleData } = useQuery({
    queryKey: ['edit-panel-title', conversationId, projectId, pathBoards.map((b) => `${b.id}:${b.title}:${b.icon?.type === 'emoji' ? b.icon.emoji : b.icon && 'url' in b.icon ? b.icon.url : ''}:${b.hasContent}`).join('|')],
    queryFn: async (): Promise<{ path: BoardPathSegment[]; label: string }> => {
      if (conversationId) {
        // Walk parent_id chain (root → … → current) for nested page path
        let currentId: string | null = conversationId
        const visited = new Set<string>() // Guard against corrupt cycles
        const chain: BoardPathSegment[] = []

        while (currentId && !visited.has(currentId) && chain.length < 20) {
          visited.add(currentId)
          const cached = pathBoards.find((b) => b.id === currentId)
          if (cached) {
            chain.push({
              id: cached.id,
              title: cached.title,
              parent_id: cached.parent_id,
              icon: cached.icon,
              hasContent: cached.hasContent,
            })
            currentId = cached.parent_id
            continue
          }
          const { data } = await supabase
            .from('conversations')
            .select('id, title, metadata')
            .eq('id', currentId)
            .maybeSingle()
          if (!data) break
          const meta = data.metadata as Record<string, unknown> | null
          const parent_id = getParentId(meta)
          chain.push({
            id: data.id as string,
            title: ((data.title as string | undefined)?.trim() || 'Untitled'),
            parent_id,
            icon: parseIcon(meta),
            hasContent: meta?.hasContent === true,
          })
          currentId = parent_id
        }

        const path = chain.reverse() // Root → current
        const label = path.map((p) => p.title).join(' / ') || 'Untitled'
        return { path, label }
      }
      if (projectId) {
        const { data } = await supabase
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .maybeSingle()
        const name = (data?.name as string | undefined)?.trim() || 'Untitled project'
        return { path: [{ id: projectId, title: name, parent_id: null }], label: name }
      }
      return { path: [{ id: 'home', title: 'Thinktable', parent_id: null }], label: 'Thinktable' }
    },
    enabled: Boolean(conversationId || projectId),
    staleTime: 30_000,
  })

  const path = titleData?.path
  const displayTitle = titleData?.label || (conversationId || projectId ? '…' : 'Thinktable') // Placeholder while loading
  const showBoardPath = Boolean(conversationId && path && path.length > 0) // Interactive path on board pages

  // Siblings at the same parent level as a path segment
  const siblingsFor = (segment: BoardPathSegment): PathBoard[] => {
    return pathBoards
      .filter((b) => {
        if (b.archived || b.inProject) return false
        if (segment.parent_id) return b.parent_id === segment.parent_id
        return b.parent_id === null // Root-level siblings
      })
      .sort(sortPathBoards)
  }

  const childrenOf = (id: string): PathBoard[] =>
    pathBoards.filter((b) => !b.archived && !b.inProject && b.parent_id === id).sort(sortPathBoards)

  const panelHeight = 52 // px - matches input box height

  return (
    <>
      <div
        className={cn(
          'absolute left-0 right-0 z-10 pointer-events-auto flex flex-col items-center'
        )}
        data-edit-panel-root
        style={{
          // Position at very top of map area - no gap
          top: '0px',
        }}
      >
        {/* Top bar content - hidden when isHidden is true */}
        <div
          data-edit-top-bar // Full map-column bar; toolbar tools center against this, not leftover flex space
          className={cn(
            // Match React Flow board/main area background — no border, no shadow
            'relative bg-gray-50 dark:bg-[#0f0f0f] flex items-center gap-1 w-full transition-all duration-200',
            isHidden ? 'opacity-0 h-0 overflow-hidden' : 'overflow-visible'
          )}
          style={{
            // No rounded corners - fills map column width (chat sidebar is a sibling column)
            borderRadius: '0px',
            border: 'none', // Explicitly no bottom (or any) border
            boxShadow: 'none',
            height: isHidden ? '0px' : `${panelHeight}px`, // Same height as input box (52px), 0 when hidden
            paddingLeft: isHidden ? '0' : '0.5rem', // 8px left padding
            paddingRight: isHidden ? '0' : '0.5rem', // 8px right padding
            boxSizing: 'border-box', // Ensure padding is included in height
          }}
        >
          {/* Left chrome — menu + board path; z-20 so title stays clickable if tools overlap */}
          <div data-top-bar-left className="relative z-20 flex items-center min-w-0 shrink-0">
          {/* Menu icon — hover opens; click pins open until clicked again (survives page switch) */}
          <div
            data-nav-logo-trigger
            className="flex items-center flex-shrink-0"
            onMouseEnter={() => {
              if (!isMobileMode) openSidebar() // Desktop: open on hover (not pinned)
            }}
            onMouseLeave={() => {
              if (!isMobileMode) scheduleCloseSidebar() // No-op when click-pinned
            }}
          >
            <button
              type="button"
              onClick={() => toggleSidebar()} // Pin open / unpin close — persists across pages
              className="w-8 h-8 flex-shrink-0 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center"
              title={isSidebarPinned ? 'Close menu' : 'Open menu'}
              aria-label={isSidebarPinned ? 'Close navigation menu' : 'Open navigation menu'}
              aria-pressed={isSidebarPinned}
            >
              <Menu className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>

          {/* Board path — click opens page; hover lists same-level pages */}
          <div className="flex items-center gap-0 min-w-0 shrink mr-2 max-w-[min(420px,48vw)] text-sm font-medium">
            {showBoardPath && path ? (
              <span className="truncate select-none flex items-center min-w-0" title={displayTitle}>
                {path.map((segment, index) => {
                  const isLast = index === path.length - 1
                  return (
                    <span key={segment.id} className="inline-flex items-center min-w-0">
                      {index > 0 && (
                        <span
                          className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none"
                          aria-hidden
                        >
                          /
                        </span>
                      )}
                      <PathSegmentMenu
                        segment={segment}
                        isLast={isLast}
                        siblings={siblingsFor(segment)}
                        childrenOf={childrenOf}
                        currentBoardId={conversationId}
                      />
                    </span>
                  )
                })}
              </span>
            ) : (
              <span
                className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate select-none px-0.5"
                title={displayTitle}
              >
                {displayTitle}
              </span>
            )}
          </div>
          </div>

          {/* Editor Toolbar - tools center on the board; Notion/Share stay right */}
          <EditorToolbar editor={activeEditor} conversationId={conversationId} />
        </div>

        {/* Thin pill toggle below top bar - only visible on hover or when hidden */}
        <div
          onClick={() => setIsHidden(!isHidden)}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          className={cn(
            'w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500',
            isHidden ? 'mt-2' : 'mt-1.5',
            // Show pill when hovering on it, or always show if bar is hidden (so user can restore it)
            (isHovering || isHidden) ? 'opacity-100' : 'opacity-0'
          )}
          title={isHidden ? 'Show toolbar' : 'Hide toolbar'}
        />
      </div>
    </>
  )
}
