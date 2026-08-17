'use client'

// Top-bar cluster right of Share: copy link, favorite, More (phone: copy + star live in More)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react' // Copy flash + favorite + More search
import {
  AppWindow,
  Bell,
  Check,
  Clipboard,
  Clock,
  Copy,
  Download,
  FolderInput,
  History,
  Languages,
  Link2,
  Lock,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Type,
  Upload,
} from 'lucide-react' // Share cluster + More-menu row icons
import { Button } from '@/components/ui/button' // Ghost icon buttons
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // More menu + flyouts
import { createClient } from '@/lib/supabase/client' // Persist favorite; word count / last edited
import { useQueryClient } from '@tanstack/react-query' // Keep Boards list in sync; reuse frame cache
import { cn } from '@/lib/utils' // Class merge
import { useReactFlowContext } from './react-flow-context' // Present switches to View mode
import { useSidebarContext } from './sidebar-context' // Phone hides copy/star into More
import { NotionConnectMenuItems } from './notion-connect-button' // Connections → Notion (provider wraps share cluster)

type BoardTopBarShareProps = {
  conversationId?: string // Board id; copy/favorite wait until the board is saved
}

type BoardFontId = 'default' | 'serif' | 'mono' // Font row in More (UI until applied to the board)

type CachedMessage = { content?: string } // Frame HTML from the messages-for-panels cache

const iconBtn =
  'h-7 w-7 p-0 text-gray-700 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0' // Same weight as Share lock

/** Strip TipTap HTML to plain text for copy / word count. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ') // Drop tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Footer time like “Today at 3:35 AM”. */
function formatEditedAt(iso: string): string {
  const d = new Date(iso) // Conversation updated_at
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`
}

/** Case-insensitive label match for Search actions… */
function matchesQuery(label: string, q: string): boolean {
  if (!q) return true
  return label.toLowerCase().includes(q)
}

/** Notion-style switch parked on the right of a toggle row. */
function MenuToggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'ml-auto relative h-4 w-7 rounded-full transition-colors',
        on ? 'bg-blue-500' : 'bg-gray-200'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-[left]',
          on ? 'left-3.5' : 'left-0.5'
        )}
      />
    </span>
  )
}

export function BoardTopBarShare({ conversationId }: BoardTopBarShareProps) {
  const queryClient = useQueryClient() // Patch conversations cache after favorite
  const { setEditMenuPillMode } = useReactFlowContext() // Present → View bar
  const { isMobileMode } = useSidebarContext() // Phone: copy + star collapse into More
  const [copied, setCopied] = useState(false) // Brief checkmark after copy
  const [favorited, setFavorited] = useState(false) // Star fill from metadata.favorite
  const [menuOpen, setMenuOpen] = useState(false) // Load footer stats when More opens
  const [query, setQuery] = useState('') // Search actions…
  const searchRef = useRef<HTMLInputElement>(null) // Focus search on open
  const [boardFont, setBoardFont] = useState<BoardFontId>('default') // Font picker (UI only)
  const [smallText, setSmallText] = useState(false) // Layout toggle (UI only)
  const [fullWidth, setFullWidth] = useState(false) // Layout toggle (UI only)
  const [lockBoard, setLockBoard] = useState(false) // Lock board toggle (UI only)
  const [wordCount, setWordCount] = useState<number | null>(null) // Footer word count
  const [editedBy, setEditedBy] = useState<string | null>(null) // Footer first name
  const [editedAt, setEditedAt] = useState<string | null>(null) // Footer relative time
  const [copiedContents, setCopiedContents] = useState(false) // Flash after Copy board contents

  const q = query.trim().toLowerCase() // Normalized search

  useEffect(() => {
    if (!conversationId) {
      setFavorited(false) // Unsaved board cannot be a favorite yet
      return
    }
    let cancelled = false // Ignore stale fetches on board switch
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      if (cancelled) return
      const meta = (data?.metadata as Record<string, unknown> | null) || {}
      setFavorited(meta.favorite === true) // Board-level favorite flag
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  useEffect(() => {
    if (!menuOpen) {
      setQuery('') // Clear search when More closes
      return
    }
    const id = window.setTimeout(() => searchRef.current?.focus(), 0) // Search is the first control
    return () => window.clearTimeout(id)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || !conversationId) return // Footer only when More is open on a saved board
    let cancelled = false
    const loadFooter = async () => {
      const cached =
        queryClient.getQueryData<CachedMessage[]>(['messages-for-panels', conversationId, 'full']) ||
        queryClient.getQueryData<CachedMessage[]>(['messages-for-panels', conversationId])
      let contents = cached?.map((m) => htmlToPlain(m.content || '')).filter(Boolean) ?? []
      const supabase = createClient()
      if (!cached) {
        const { data } = await supabase
          .from('messages')
          .select('content')
          .eq('conversation_id', conversationId)
        if (cancelled) return
        contents = (data ?? []).map((m) => htmlToPlain((m.content as string) || '')).filter(Boolean)
      }
      const words = contents.join(' ').split(/\s+/).filter(Boolean).length // Plain-text word count
      if (!cancelled) setWordCount(words)
      const { data: conv } = await supabase
        .from('conversations')
        .select('updated_at, user_id')
        .eq('id', conversationId)
        .single()
      if (cancelled || !conv) return
      setEditedAt(formatEditedAt(conv.updated_at as string))
      const userId = conv.user_id as string | undefined
      if (!userId) return
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
      if (cancelled) return
      const full = (profile?.full_name as string | undefined)?.trim()
      setEditedBy(full ? full.split(/\s+/)[0] : null) // First name, Notion-style
    }
    void loadFooter()
    return () => {
      cancelled = true
    }
  }, [menuOpen, conversationId, queryClient])

  const copyLink = useCallback(async () => {
    if (!conversationId || typeof window === 'undefined') return
    const url = `${window.location.origin}/board/${conversationId}` // Same URL as board right-click Copy link
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600) // Match Share-panel flash
    } catch {
      setCopied(false)
    }
  }, [conversationId])

  const copyBoardContents = useCallback(async () => {
    if (!conversationId) return
    const cached =
      queryClient.getQueryData<CachedMessage[]>(['messages-for-panels', conversationId, 'full']) ||
      queryClient.getQueryData<CachedMessage[]>(['messages-for-panels', conversationId])
    let contents = cached?.map((m) => htmlToPlain(m.content || '')).filter(Boolean) ?? []
    if (!cached) {
      const supabase = createClient()
      const { data } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', conversationId)
      contents = (data ?? []).map((m) => htmlToPlain((m.content as string) || '')).filter(Boolean)
    }
    try {
      await navigator.clipboard.writeText(contents.join('\n\n'))
      setCopiedContents(true)
      window.setTimeout(() => setCopiedContents(false), 1600)
    } catch {
      setCopiedContents(false)
    }
  }, [conversationId, queryClient])

  const presentBoard = useCallback(() => {
    setEditMenuPillMode('view') // View bar owns Present / captures
  }, [setEditMenuPillMode])

  const toggleFavorite = useCallback(async () => {
    if (!conversationId) return
    const next = !favorited // Optimistic fill
    setFavorited(next)
    try {
      const supabase = createClient()
      const { data: row, error: fetchError } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      if (fetchError) throw fetchError
      const existing = (row?.metadata as Record<string, unknown> | null) || {}
      const updated = { ...existing, favorite: next } // Merge so icon/parent_id stay
      const { error } = await supabase
        .from('conversations')
        .update({ metadata: updated })
        .eq('id', conversationId)
      if (error) throw error
      queryClient.setQueryData(['conversations'], (old: Array<{ id: string; metadata?: Record<string, unknown> }> | undefined) => {
        if (!old) return old
        return old.map((c) => (c.id === conversationId ? { ...c, metadata: updated } : c))
      })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (err) {
      setFavorited(!next) // Revert star if persist failed
      console.error('Failed to update favorite:', err)
    }
  }, [conversationId, favorited, queryClient])

  const showFont = !q || matchesQuery('font default serif mono', q) // Keep font row unless search misses
  const showFooter = !q // Metadata stays at the bottom when not filtering
  const showConnections = !q || matchesQuery('connections notion', q) // Same hay as Connections row
  const hasSearchHit =
    !q ||
    showFont ||
    showConnections ||
    [
      'Copy link',
      'Add to favorites',
      'Remove from favorites',
      'Copy board contents',
      'Duplicate',
      'Move to',
      'Move to Trash',
      'Present',
      'Small text',
      'Full width',
      'Customize board',
      'Lock board',
      'Use with AI',
      'Suggest edits',
      'Translate',
      'Import',
      'Export',
      'Turn into wiki',
      'Updates & analytics',
      'Version history',
      'Notify me',
      'Open in Mac app',
    ].some((label) => matchesQuery(label, q))

  const fonts = useMemo(
    () =>
      [
        { id: 'default' as const, label: 'Default', className: 'font-sans' },
        { id: 'serif' as const, label: 'Serif', className: 'font-serif' },
        { id: 'mono' as const, label: 'Mono', className: 'font-mono' },
      ] as const,
    []
  )

  return (
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isMobileMode && (
          <>
            {/* Desktop: copy + star sit beside More; phone uses More rows only */}
            <Button
              variant="ghost"
              size="sm"
              className={iconBtn}
              title={copied ? 'Copied' : 'Copy link'}
              type="button"
              disabled={!conversationId}
              onClick={() => void copyLink()}
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={iconBtn}
              title={favorited ? 'Remove from favorites' : 'Add to favorites'}
              type="button"
              disabled={!conversationId}
              aria-pressed={favorited}
              onClick={() => void toggleFavorite()}
            >
              <Star className={cn('h-4 w-4', favorited && 'fill-current')} />
            </Button>
          </>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={iconBtn}
              title="More"
              type="button"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[280px] p-0 max-h-[min(72vh,640px)] flex flex-col overflow-hidden"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="px-1.5 pt-1.5 pb-1 flex-shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search actions..."
                  className="w-full h-8 pl-7 pr-2 text-sm rounded-md bg-white border border-blue-200 outline-none text-gray-900 focus:border-blue-400"
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-1 pb-1">
              {q && !hasSearchHit && (
                <div className="px-2 py-2 text-xs text-gray-400">No matching actions</div>
              )}
              {showFont && (
                <div className="flex items-stretch gap-0.5 px-1 py-1">
                  {fonts.map((font) => {
                    const selected = boardFont === font.id
                    return (
                      <button
                        key={font.id}
                        type="button"
                        className={cn(
                          'flex-1 flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-gray-700 hover:bg-gray-50',
                          selected && 'bg-blue-50 text-blue-600'
                        )}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setBoardFont(font.id)}
                      >
                        <span className={cn('text-[17px] leading-none', font.className)}>Ag</span>
                        <span className="text-[10px] leading-none">{font.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {matchesQuery('Copy link', q) && (
                <DropdownMenuItem disabled={!conversationId} onClick={() => void copyLink()}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Copy link
                  <DropdownMenuShortcut>⌘⌥L</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {(matchesQuery('Add to favorites', q) || matchesQuery('Remove from favorites', q)) && (
                <DropdownMenuItem
                  disabled={!conversationId} // Unsaved board has no conversations.metadata.favorite
                  onClick={() => void toggleFavorite()} // Same persist path as the star button
                >
                  <Star className={cn('h-4 w-4 mr-2', favorited && 'fill-current')} />
                  {favorited ? 'Remove from favorites' : 'Add to favorites'}
                </DropdownMenuItem>
              )}
              {matchesQuery('Copy board contents', q) && (
                <DropdownMenuItem disabled={!conversationId} onClick={() => void copyBoardContents()}>
                  <Clipboard className="h-4 w-4 mr-2" />
                  {copiedContents ? 'Copied contents' : 'Copy board contents'}
                </DropdownMenuItem>
              )}
              {matchesQuery('Duplicate', q) && (
                <DropdownMenuItem>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                  <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {matchesQuery('Move to', q) && (
                <DropdownMenuItem>
                  <FolderInput className="h-4 w-4 mr-2" />
                  Move to
                  <DropdownMenuShortcut>⌘⇧P</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {matchesQuery('Move to Trash', q) && (
                <DropdownMenuItem>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Move to Trash
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Present', q) && (
                <DropdownMenuItem onClick={presentBoard}>
                  <Play className="h-4 w-4 mr-2" />
                  Present
                  <span className="ml-1 rounded px-1 py-px text-[10px] leading-none text-gray-400 bg-gray-100">
                    Beta
                  </span>
                  <DropdownMenuShortcut>⌘⌥P</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Small text', q) && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault() // Keep More open while toggling
                    setSmallText((v) => !v)
                  }}
                >
                  <Type className="h-4 w-4 mr-2" />
                  Small text
                  <MenuToggle on={smallText} />
                </DropdownMenuItem>
              )}
              {matchesQuery('Full width', q) && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault()
                    setFullWidth((v) => !v)
                  }}
                >
                  <Maximize2 className="h-4 w-4 mr-2" />
                  Full width
                  <MenuToggle on={fullWidth} />
                </DropdownMenuItem>
              )}
              {matchesQuery('Customize board', q) && (
                <DropdownMenuItem>
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Customize board
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Lock board', q) && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault()
                    setLockBoard((v) => !v)
                  }}
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Lock board
                  <MenuToggle on={lockBoard} />
                </DropdownMenuItem>
              )}
              {matchesQuery('Use with AI', q) && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Use with AI
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuItem>Summarize</DropdownMenuItem>
                    <DropdownMenuItem>Search board</DropdownMenuItem>
                    <DropdownMenuItem>Help me write</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Suggest edits', q) && (
                <DropdownMenuItem>
                  <MessageSquarePlus className="h-4 w-4 mr-2" />
                  Suggest edits
                </DropdownMenuItem>
              )}
              {matchesQuery('Translate', q) && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Languages className="h-4 w-4 mr-2" />
                    Translate
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuItem>English</DropdownMenuItem>
                    <DropdownMenuItem>Spanish</DropdownMenuItem>
                    <DropdownMenuItem>French</DropdownMenuItem>
                    <DropdownMenuItem>German</DropdownMenuItem>
                    <DropdownMenuItem>Japanese</DropdownMenuItem>
                    <DropdownMenuItem>Chinese</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Import', q) && (
                <DropdownMenuItem>
                  <Download className="h-4 w-4 mr-2" />
                  Import
                </DropdownMenuItem>
              )}
              {matchesQuery('Export', q) && (
                <DropdownMenuItem>
                  <Upload className="h-4 w-4 mr-2" />
                  Export
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Turn into wiki', q) && (
                <DropdownMenuItem>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Turn into wiki
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Updates & analytics', q) && (
                <DropdownMenuItem>
                  <Clock className="h-4 w-4 mr-2" />
                  Updates & analytics
                </DropdownMenuItem>
              )}
              {matchesQuery('Version history', q) && (
                <DropdownMenuItem>
                  <History className="h-4 w-4 mr-2" />
                  Version history
                </DropdownMenuItem>
              )}

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Notify me', q) && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Bell className="h-4 w-4 mr-2" />
                    Notify me
                    <span className="ml-auto mr-1 text-xs text-gray-400">Comments</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuItem>Comments</DropdownMenuItem>
                    <DropdownMenuItem>All activity</DropdownMenuItem>
                    <DropdownMenuItem>Mentions only</DropdownMenuItem>
                    <DropdownMenuItem>Off</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <NotionConnectMenuItems filterQuery={q} />

              {!q && <DropdownMenuSeparator />}

              {matchesQuery('Open in Mac app', q) && (
                <DropdownMenuItem>
                  <AppWindow className="h-4 w-4 mr-2" />
                  Open in Mac app
                </DropdownMenuItem>
              )}
            </div>

            {showFooter && (
              <div className="flex-shrink-0 border-t border-gray-100 px-3 py-2 text-[11px] leading-4 text-gray-400">
                <div>Word count: {wordCount == null ? '…' : `${wordCount} ${wordCount === 1 ? 'word' : 'words'}`}</div>
                {editedBy && <div>Last edited by {editedBy}</div>}
                {editedAt && <div>{editedAt}</div>}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
  )
}