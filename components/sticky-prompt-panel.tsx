'use client'

// Edit panel - always visible at top of map area (menu + board title + toolbar)
import { cn } from '@/lib/utils'
import { EditorToolbar } from './editor-toolbar'
import { useEditorContext } from './editor-context'
import { BOARD_LOAD_FADE_MS } from '@/components/frame-content-shimmer' // Same 300ms as board frame shells
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
const PATH_MENU_OPEN_MS = 320 // Dwell on a path name before the sibling menu fades in
const PATH_MENU_CLOSE_MS = 120 // Leave grace — snappier hide, still covers name → list
const PATH_MENU_MOTION = 'data-[state=open]:duration-300' // Slow fade-in; hide uses the default fade-out

// Slash between path crumbs (same weight as the top-bar undo/Share seam)
function PathSlash() {
  return (
    <span
      className="flex h-7 items-center text-2xl font-thin text-gray-300 dark:text-gray-500 mx-1 flex-shrink-0 select-none leading-none"
      aria-hidden
    >
      /
    </span>
  )
}

// Visible path: highest / … (hidden middles) / parent / current
type PathSlot =
  | { type: 'crumb'; segment: BoardPathSegment; role: 'root' | 'parent' | 'current' } // Named board in the bar
  | { type: 'ellipsis'; hidden: BoardPathSegment[] } // Collapsed ancestors between root and parent

function slotsForPath(path: BoardPathSegment[]): PathSlot[] {
  if (path.length === 0) return [] // Empty while loading
  if (path.length === 1) return [{ type: 'crumb', segment: path[0], role: 'current' }] // Root board only
  if (path.length === 2) {
    return [
      { type: 'crumb', segment: path[0], role: 'root' }, // Highest is also the parent
      { type: 'crumb', segment: path[1], role: 'current' },
    ]
  }
  if (path.length === 3) {
    return [
      { type: 'crumb', segment: path[0], role: 'root' }, // Highest
      { type: 'crumb', segment: path[1], role: 'parent' }, // No middles → no …
      { type: 'crumb', segment: path[2], role: 'current' },
    ]
  }
  return [
    { type: 'crumb', segment: path[0], role: 'root' }, // Highest always stays
    { type: 'ellipsis', hidden: path.slice(1, -2) }, // Any boards between highest and parent
    { type: 'crumb', segment: path[path.length - 2], role: 'parent' },
    { type: 'crumb', segment: path[path.length - 1], role: 'current' },
  ]
}

// One crumb bar while the board path query is pending (holds left-chrome width)
function BoardPathShimmer() {
  return (
    <span className="truncate select-none flex items-center min-w-0" aria-busy="true" aria-label="Loading board path">
      <span className="tt-topbar-path-shimmer w-32" /> {/* ~one title; not a fake ancestor / current pair */}
    </span>
  )
}

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

// Board row in a path menu — leaf item, or nested tree flyout with delayed hover
function PathBoardMenuItem({
  board,
  childrenOf,
  currentBoardId,
  goTo,
  isCurrent,
  alignChevron = false, // Hidden chevron so nested leaves line up with tree rows
}: {
  board: PathBoard
  childrenOf: (id: string) => PathBoard[]
  currentBoardId?: string
  goTo: (id: string) => void
  isCurrent: boolean
  alignChevron?: boolean
}) {
  const kids = childrenOf(board.id) // Nested boards under this name
  const [subOpen, setSubOpen] = useState(false) // Controlled so hover dwell can be slower than Radix’s 100ms
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Pending tree-open dwell

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current) // Don’t open after unmount
    }
  }, [])

  const cancelTreeOpen = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current) // Left the name before the flyout appeared
      openTimerRef.current = null
    }
  }

  const openTree = (immediate = false) => {
    if (immediate) {
      cancelTreeOpen()
      setSubOpen(true) // Already in the flyout — keep it
      return
    }
    if (subOpen || openTimerRef.current) return // Visible or dwell already running
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      setSubOpen(true) // Fade the tree in after hovering the name
    }, PATH_MENU_OPEN_MS)
  }

  if (kids.length === 0) {
    return (
      <DropdownMenuItem
        className={cn('cursor-pointer', isCurrent && 'bg-gray-100 dark:bg-[#2a2a3a]')}
        onClick={() => goTo(board.id)}
      >
        <PathPageIcon icon={board.icon} hasContent={board.hasContent} className="mr-1.5" />
        <span className={cn('truncate', alignChevron && 'flex-1')}>{board.title}</span>
        {alignChevron && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-0" aria-hidden />}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuSub
      open={subOpen}
      onOpenChange={(next) => {
        if (next) {
          if (openTimerRef.current) return // Pointer dwell already owns hover-open
          setSubOpen(true) // Keyboard / click: show immediately
          return
        }
        cancelTreeOpen()
        setSubOpen(false) // Hide with Radix’s original leave grace
      }}
    >
      <DropdownMenuSubTrigger
        className={cn('cursor-pointer', isCurrent && 'bg-gray-100 dark:bg-[#2a2a3a]')}
        onPointerEnter={() => openTree()}
        onPointerLeave={cancelTreeOpen}
        onClick={(e) => {
          e.preventDefault()
          goTo(board.id) // Click the name still opens that board
        }}
      >
        <PathPageIcon icon={board.icon} hasContent={board.hasContent} className="mr-1.5" />
        <span className="truncate flex-1">{board.title}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn('w-52', PATH_MENU_MOTION)}
        onPointerEnter={() => openTree(true)}
      >
        {kids.map((child) => (
          <PathBoardMenuItem
            key={child.id}
            board={child}
            childrenOf={childrenOf}
            currentBoardId={currentBoardId}
            goTo={goTo}
            isCurrent={child.id === currentBoardId}
            alignChevron
          />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

// One breadcrumb segment: click opens page; hover lists same-level pages
function PathSegmentMenu({
  segment,
  isLast,
  iconOnly,
  siblings,
  childrenOf,
  currentBoardId,
}: {
  segment: BoardPathSegment
  isLast: boolean
  iconOnly?: boolean // Ancestors drop their title when the path cap is tight (icon minimum)
  siblings: PathBoard[]
  childrenOf: (id: string) => PathBoard[]
  currentBoardId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false) // Hover-controlled sibling menu
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Pending fade-in dwell
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Pending fade-out

  const clearMenuTimers = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    openTimerRef.current = null
    closeTimerRef.current = null
  }

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, []) // Drop timers if the crumb unmounts

  const openMenu = (immediate = false) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current) // Crossing trigger → menu must not dismiss
      closeTimerRef.current = null
    }
    if (immediate) {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
      setOpen(true) // Already bridging into the open menu
      return
    }
    if (open || openTimerRef.current) return // Visible or dwell already running
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      setOpen(true) // Fade in after hovering the path name
    }, PATH_MENU_OPEN_MS)
  }

  const scheduleCloseMenu = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current) // Left before the menu appeared
      openTimerRef.current = null
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false) // Hide after leave grace
    }, PATH_MENU_CLOSE_MS)
  }

  const goTo = (id: string) => {
    clearMenuTimers()
    setOpen(false)
    router.push(`/board/${id}`)
  }

  const visible = siblings.slice(0, PATH_MENU_LIMIT)
  const moreCount = Math.max(0, siblings.length - PATH_MENU_LIMIT)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true) // Click / keyboard still open immediately
        else scheduleCloseMenu() // Don’t snap shut — same grace as pointer leave
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => openMenu()}
          onMouseLeave={(e) => {
            const to = e.relatedTarget as HTMLElement | null
            if (to?.closest?.('[data-radix-popper-content-wrapper], [role="menu"]')) return // Moving into the board list / tree
            scheduleCloseMenu()
          }}
          onClick={(e) => {
            e.preventDefault()
            goTo(segment.id) // Click path name → open that page
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800',
            isLast
              ? 'min-w-0 max-w-full text-gray-900 dark:text-gray-100' // Current board; title ellipsizes — icon stays flex-shrink-0
              : 'flex-shrink-0 text-gray-400 dark:text-gray-500 font-normal' // Ancestors: full name or icon-only
          )}
          title={segment.title}
          aria-label={segment.title}
        >
          <PathPageIcon icon={segment.icon} hasContent={segment.hasContent} />
          {!iconOnly && <span className={isLast ? 'min-w-0 truncate' : undefined}>{segment.title}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn('w-56 max-h-72 overflow-y-auto', PATH_MENU_MOTION)}
        onMouseEnter={() => openMenu(true)}
        onMouseLeave={(e) => {
          const to = e.relatedTarget as HTMLElement | null
          if (to?.closest?.('[data-radix-popper-content-wrapper], [role="menu"]')) return // Moving into a nested tree flyout
          scheduleCloseMenu()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {visible.map((board) => (
          <PathBoardMenuItem
            key={board.id}
            board={board}
            childrenOf={childrenOf}
            currentBoardId={currentBoardId}
            goTo={goTo}
            isCurrent={board.id === currentBoardId || board.id === segment.id}
          />
        ))}
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

// … crumb between highest and parent — lists the boards the path hid
function PathEllipsisMenu({
  hidden,
  currentBoardId,
}: {
  hidden: BoardPathSegment[]
  currentBoardId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false) // Hover-controlled hidden-path menu
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Pending fade-in dwell
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Pending fade-out

  const clearMenuTimers = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    openTimerRef.current = null
    closeTimerRef.current = null
  }

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const openMenu = (immediate = false) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (immediate) {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
      setOpen(true)
      return
    }
    if (open || openTimerRef.current) return
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      setOpen(true)
    }, PATH_MENU_OPEN_MS)
  }

  const scheduleCloseMenu = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, PATH_MENU_CLOSE_MS)
  }

  const goTo = (id: string) => {
    clearMenuTimers()
    setOpen(false)
    router.push(`/board/${id}`)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else scheduleCloseMenu()
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => openMenu()}
          onMouseLeave={(e) => {
            const to = e.relatedTarget as HTMLElement | null
            if (to?.closest?.('[data-radix-popper-content-wrapper], [role="menu"]')) return
            scheduleCloseMenu()
          }}
          className="inline-flex flex-shrink-0 items-center rounded px-0.5 -mx-0.5 text-gray-400 dark:text-gray-500 font-normal hover:bg-gray-100 dark:hover:bg-gray-800"
          title="More boards in path"
          aria-label="More boards in path"
        >
          ...
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn('w-56 max-h-72 overflow-y-auto', PATH_MENU_MOTION)}
        onMouseEnter={() => openMenu(true)}
        onMouseLeave={(e) => {
          const to = e.relatedTarget as HTMLElement | null
          if (to?.closest?.('[data-radix-popper-content-wrapper], [role="menu"]')) return
          scheduleCloseMenu()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {hidden.map((segment) => (
          <DropdownMenuItem
            key={segment.id}
            className={cn('cursor-pointer', segment.id === currentBoardId && 'bg-gray-100 dark:bg-[#2a2a3a]')}
            onClick={() => goTo(segment.id)}
          >
            <PathPageIcon icon={segment.icon} hasContent={segment.hasContent} className="mr-1.5" />
            <span className="truncate">{segment.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EditPanel({ conversationId, projectId }: EditPanelProps) {
  const { activeEditor } = useEditorContext()
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
    placeholderData: (previousData, previousQuery) => {
      // Same board — pathBoards dump changing the key must not flash shimmer / collapse tools
      if (previousQuery?.queryKey[1] === conversationId && previousQuery?.queryKey[2] === projectId) {
        return previousData
      }
      return undefined
    },
  })

  const path = titleData?.path
  const displayTitle = titleData?.label || (conversationId || projectId ? '' : 'Thinktable') // Empty while shimmering
  const showBoardPath = Boolean(conversationId && path && path.length > 0) // Interactive path on board pages
  const pathKey = conversationId || projectId || '' // Board/project we’re loading a title for
  const pathReady = Boolean(path?.length) // Titles have landed for this pathKey
  const [revealedPathKey, setRevealedPathKey] = useState<string | null>(null) // Last key that finished the load fade
  const pathRevealed = revealedPathKey === pathKey // True once this board’s crumb → title fade is done
  const showPathShimmer = Boolean(pathKey) && (!pathReady || !pathRevealed) // Shell until the fade unmounts it
  const pathEntering = Boolean(pathKey) && pathReady && !pathRevealed // Overlap: path fading in under the crumb

  useEffect(() => {
    if (!pathKey) {
      setRevealedPathKey('') // Home label — nothing to crossfade
      return
    }
    if (!pathReady || revealedPathKey === pathKey) return // Still waiting, or already faded this board
    const t = window.setTimeout(() => setRevealedPathKey(pathKey), BOARD_LOAD_FADE_MS) // Drop the crumb after the CSS fade
    return () => window.clearTimeout(t)
  }, [pathKey, pathReady, revealedPathKey])

  const pathSlots = path ? slotsForPath(path) : [] // Highest / … / parent / current
  const [iconOnlyAncestors, setIconOnlyAncestors] = useState(false) // Drop ancestor titles when the cap is tight
  const pathBoxRef = useRef<HTMLDivElement>(null) // Capped path box (--tt-path-max)
  const pathFullRef = useRef<HTMLSpanElement>(null) // Hidden full-label row for compact measure
  const pathMinRef = useRef<HTMLSpanElement>(null) // Hidden icon-minimum row — current icon stays whole

  useLayoutEffect(() => {
    const box = pathBoxRef.current
    const full = pathFullRef.current
    if (!box || !full) return // Path not mounted
    const sync = () => {
      const cap = box.clientWidth // Room after --tt-path-max
      if (cap <= 0) return
      const need = full.scrollWidth // Highest + … + parent + current with titles
      setIconOnlyAncestors((prev) => {
        if (!prev) return need > cap + 1 // Collapse names to icons
        return need > cap - 8 // Hysteresis so labels don’t flicker
      })
    }
    sync()
    const ro = new ResizeObserver(sync) // Cap / title / icon changes
    ro.observe(box)
    return () => ro.disconnect()
  }, [path, pathReady, pathSlots.length])

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
        {/* Top bar — always shown (no hide-pill) */}
        <div
          data-edit-top-bar // Full map-column bar; toolbar tools center against this, not leftover flex space
          className={cn(
            // Match React Flow board/main area background — no border, no shadow
            'relative bg-gray-50 dark:bg-[#0f0f0f] flex items-center gap-1 w-full overflow-visible'
          )}
          style={{
            // No rounded corners - fills map column width (chat sidebar is a sibling column)
            borderRadius: '0px',
            border: 'none', // Explicitly no bottom (or any) border
            boxShadow: 'none',
            height: `${panelHeight}px`, // Same height as input box (52px)
            paddingLeft: '0.5rem', // 8px left padding
            paddingRight: '0.5rem', // 8px right padding
            boxSizing: 'border-box', // Ensure padding is included in height
          }}
        >
          {/* Left chrome — menu + board path; shrink-0 so the title isn’t crushed by the flex bar */}
          <div data-top-bar-left data-path-ready={pathReady || !pathKey ? 'true' : undefined} className="relative z-20 flex items-center flex-shrink-0">
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

          {/* Board path — highest / … / parent / current; ancestor names → icons; current title ellipsizes */}
          <div
            ref={pathBoxRef}
            data-board-path
            className="relative min-w-0 flex-shrink-0 overflow-hidden text-sm font-medium text-gray-900 dark:text-gray-100"
            style={{ maxWidth: 'var(--tt-path-max, none)', minWidth: 'var(--tt-path-min, 0px)' }} // Cap against tools; never narrower than the current icon
          >
            {pathReady && showBoardPath && path ? (
              <>
                <span
                  ref={pathFullRef}
                  data-path-full
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0 -z-10 flex w-max items-center whitespace-nowrap opacity-0" // Full titles; compact measure only
                >
                  {pathSlots.map((slot, index) => (
                    <span key={slot.type === 'ellipsis' ? 'ellipsis' : slot.segment.id} className="inline-flex items-center flex-shrink-0">
                      {index > 0 && <PathSlash />}
                      {slot.type === 'ellipsis' ? (
                        <span className="px-0.5">...</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-0.5">
                          <PathPageIcon icon={slot.segment.icon} hasContent={slot.segment.hasContent} />
                          <span>{slot.segment.title}</span>
                        </span>
                      )}
                    </span>
                  ))}
                </span>
                <span
                  ref={pathMinRef}
                  data-path-min
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0 -z-10 flex w-max items-center whitespace-nowrap opacity-0" // Ancestor icons + current icon; toolbar overflow uses this width
                >
                  {pathSlots.map((slot, index) => (
                    <span key={slot.type === 'ellipsis' ? 'ellipsis' : slot.segment.id} className="inline-flex items-center flex-shrink-0">
                      {index > 0 && <PathSlash />}
                      {slot.type === 'ellipsis' ? (
                        <span className="px-0.5">...</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-0.5">
                          <PathPageIcon icon={slot.segment.icon} hasContent={slot.segment.hasContent} />
                        </span>
                      )}
                    </span>
                  ))}
                </span>
                <span
                  className={cn(
                    'select-none flex w-max min-w-0 max-w-full items-center whitespace-nowrap', // Hug until the cap; current truncates
                    pathEntering && 'tt-board-load-fade-in' // Fade in under the dissolving crumb
                  )}
                  title={displayTitle}
                >
                  {pathSlots.map((slot, index) => {
                    const isCurrent = slot.type === 'crumb' && slot.role === 'current'
                    return (
                      <span
                        key={slot.type === 'ellipsis' ? 'ellipsis' : slot.segment.id}
                        className={cn('inline-flex items-center', isCurrent ? 'min-w-0' : 'flex-shrink-0')}
                      >
                        {index > 0 && <PathSlash />}
                        {slot.type === 'ellipsis' ? (
                          <PathEllipsisMenu hidden={slot.hidden} currentBoardId={conversationId} />
                        ) : (
                          <PathSegmentMenu
                            segment={slot.segment}
                            isLast={isCurrent}
                            iconOnly={iconOnlyAncestors && !isCurrent} // Icons minimum on highest / parent
                            siblings={siblingsFor(slot.segment)}
                            childrenOf={childrenOf}
                            currentBoardId={conversationId}
                          />
                        )}
                      </span>
                    )
                  })}
                </span>
              </>
            ) : pathReady || !pathKey ? (
              <span
                className={cn(
                  'text-sm font-medium text-gray-900 dark:text-gray-100 select-none px-0.5 whitespace-nowrap truncate inline-block max-w-full',
                  pathEntering && 'tt-board-load-fade-in' // Project title uses the same load fade
                )}
                title={displayTitle}
              >
                {displayTitle}
              </span>
            ) : null}
            {showPathShimmer ? (
              <span
                className={cn(
                  pathReady && 'absolute inset-0 z-[1] flex items-center', // Overlay once the real path is in-flow
                  pathEntering && 'tt-board-load-fade-out' // Dissolve as the path appears
                )}
              >
                <BoardPathShimmer />
              </span>
            ) : null}
          </div>
          </div>

          {/* Editor Toolbar - tools center on the board; Share / copy / favorite / more stay right */}
          <EditorToolbar editor={activeEditor} conversationId={conversationId} />
        </div>
      </div>
    </>
  )
}
