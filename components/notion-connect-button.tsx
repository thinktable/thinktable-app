'use client'

// Notion connect host + More-menu Connections row (OAuth / import / disconnect / top-bar pin)

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, LayoutGrid, PinOff, Sparkles } from 'lucide-react' // Connections + import (magic) / edit / unpin
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { NotionImportModal } from './notion-import-modal'
import { NotionMarkIcon } from './notion-mark-icon' // Monochrome — matches other top-bar icons
import { cn } from '@/lib/utils'

/** localStorage — whether the connected Notion mark stays left of Share. */
const TOPBAR_PIN_KEY = 'thinktable-notion-topbar-pinned'

type NotionStatus = {
  configured: boolean // Whether server has OAuth secrets
  connected: boolean // Whether this user has a stored install
  workspaceName?: string | null // Connected workspace label
}

type NotionConnectApi = {
  status: NotionStatus | null // Latest /api/notion/status payload
  loading: boolean // Status fetch or disconnect in flight
  topBarPinned: boolean // Show Notion mark left of Share when connected
  authHref: string // /api/notion/auth?returnTo=… → 302 to Notion page picker
  startConnect: () => void // Kick off hosted Notion OAuth (first connect / edit permissions)
  disconnect: () => Promise<void> // Drop stored tokens
  openPicker: () => void // Open Import pages modal
  setTopBarPinned: (pinned: boolean) => void // Pin / unpin without disconnecting
}

const NotionConnectContext = createContext<NotionConnectApi | null>(null) // Shared by host + menu rows

/** Read Notion connect API from the nearest provider (top-bar pin, More menu). */
export function useNotionConnect(): NotionConnectApi | null {
  return useContext(NotionConnectContext)
}

/** Read pin preference; default true so a fresh connect appears left of Share. */
function readTopBarPinned(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(TOPBAR_PIN_KEY)
    if (raw === null) return true // First connect → pin
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

/** Build the OAuth start URL for the current board path. */
function buildAuthHref(pathname: string | null): string {
  const returnTo = pathname && pathname.startsWith('/') ? pathname : '/board'
  return `/api/notion/auth?returnTo=${encodeURIComponent(returnTo)}`
}

/**
 * Shared connected-Notion actions (More → Connections + top-bar connection popup).
 * Edit permissions is a real <a href> so the browser always follows /api/notion/auth → Notion.
 */
function NotionConnectedActions() {
  const api = useNotionConnect()
  if (!api?.status?.connected) return null
  const { status, authHref, openPicker, disconnect, topBarPinned, setTopBarPinned } = api

  return (
    <>
      <DropdownMenuItem disabled className="text-xs text-gray-500">
        Connected{status.workspaceName ? ` · ${status.workspaceName}` : ''}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault() // Keep parent menus from fighting the modal open
          window.setTimeout(() => openPicker(), 0) // Defer so the dropdown can finish closing
        }}
      >
        <Sparkles className="h-4 w-4 mr-2 shrink-0" />
        Import pages
      </DropdownMenuItem>
      {/* Native link — full document navigation; nested menus cannot cancel it */}
      <DropdownMenuItem asChild>
        <a href={authHref} className="cursor-pointer">
          <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
          Edit permissions
        </a>
      </DropdownMenuItem>
      {topBarPinned ? (
        <DropdownMenuItem onSelect={() => setTopBarPinned(false)}>
          <PinOff className="h-4 w-4 mr-2" />
          Unpin
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={() => setTopBarPinned(true)}>
          <NotionMarkIcon className="h-4 w-4 mr-2" />
          Pin to top bar
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          void disconnect()
        }}
        className="text-red-600 focus:text-red-600"
      >
        Disconnect Notion
      </DropdownMenuItem>
    </>
  )
}

/** Fetch status, own the import modal, and listen for AI-composer connect events. */
export function NotionConnectProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() // Current board path for returnTo
  const router = useRouter() // Navigate after import
  const queryClient = useQueryClient() // Refresh note panels after import
  const [status, setStatus] = useState<NotionStatus | null>(null) // Connection state from API
  const [loading, setLoading] = useState(true) // Initial fetch in flight
  const [pickerOpen, setPickerOpen] = useState(false) // Import pages modal
  const [topBarPinned, setTopBarPinnedState] = useState(true) // Hydrate from localStorage after mount

  const authHref = useMemo(() => buildAuthHref(pathname), [pathname])

  useEffect(() => {
    setTopBarPinnedState(readTopBarPinned()) // Client-only preference
  }, [])

  useEffect(() => {
    let cancelled = false // Avoid setState after unmount
    const load = async () => {
      try {
        const res = await fetch('/api/notion/status') // Server-safe status (no token)
        if (!res.ok) {
          if (!cancelled) setStatus({ configured: true, connected: false }) // Treat 401 as disconnected
          return
        }
        const data = (await res.json()) as NotionStatus // Typed payload
        if (!cancelled) setStatus(data) // Update UI
      } catch {
        if (!cancelled) setStatus({ configured: false, connected: false }) // Offline / misconfig
      } finally {
        if (!cancelled) setLoading(false) // Stop spinner state
      }
    }
    load() // Fetch on mount
    return () => {
      cancelled = true // Cleanup
    }
  }, [])

  // After OAuth connect / Edit permissions, open the page picker and re-pin the top-bar mark
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const shouldOpen = params.get('notion') === 'connected' || params.get('picker') === '1'
    if (!shouldOpen || !status?.connected) return
    setPickerOpen(true)
    setTopBarPinnedState(true) // Fresh OAuth → show pin left of Share again
    try {
      window.localStorage.setItem(TOPBAR_PIN_KEY, '1')
    } catch {
      /* ignore quota */
    }
    params.delete('notion')
    params.delete('picker')
    params.delete('imported')
    const next = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''))
  }, [status?.connected])

  const startConnect = useCallback(() => {
    if (status?.configured === false) {
      window.alert(
        'Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env.local from a Notion public connection (redirect URI: http://localhost:3031/api/notion/callback), then restart the dev server.'
      ) // Guide local setup when secrets are missing
      return
    }
    // Hard navigation — first-time connect / same path as Edit permissions <a>
    window.location.assign(buildAuthHref(pathname))
  }, [status?.configured, pathname])

  const handleImport = async (opts: { pageIds: string[]; mode: 'card' | 'mindmap' }) => {
    const res = await fetch('/api/notion/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        returnTo: pathname || '/board',
        pageIds: opts.pageIds,
        mode: opts.mode,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error || 'Failed to import Notion pages')
    }
    if (data.conversationId) {
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', data.conversationId] })
      await queryClient.invalidateQueries({ queryKey: ['panel-edges', data.conversationId] }) // Mindmap threads
      await queryClient.invalidateQueries({ queryKey: ['conversations'] }) // Refresh Pages menu nesting
      await queryClient.invalidateQueries({ queryKey: ['path-board-menu'] })
      await queryClient.invalidateQueries({ queryKey: ['edit-panel-title'] })
      if (!pathname?.includes(data.conversationId)) {
        router.push(`/board/${data.conversationId}?notion=connected&imported=${data.importedCount || 0}`)
      } else {
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', data.conversationId] })
        await queryClient.refetchQueries({ queryKey: ['panel-edges', data.conversationId] }) // Load new threads
        await queryClient.refetchQueries({ queryKey: ['conversations'] })
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('fit-view-start'))
        }, 300)
      }
    }
  }

  const disconnect = useCallback(async () => {
    setLoading(true) // Disable UI while deleting
    try {
      await fetch('/api/notion/disconnect', { method: 'POST' }) // Remove stored tokens
      setStatus((prev) => ({ configured: prev?.configured ?? true, connected: false, workspaceName: null })) // Clear connected UI
      setPickerOpen(false)
    } finally {
      setLoading(false) // Re-enable
    }
  }, [])

  const openPicker = useCallback(() => {
    setPickerOpen(true) // Import pages from More / top-bar connection popup
  }, [])

  const setTopBarPinned = useCallback((pinned: boolean) => {
    setTopBarPinnedState(pinned)
    try {
      window.localStorage.setItem(TOPBAR_PIN_KEY, pinned ? '1' : '0')
    } catch {
      /* ignore quota */
    }
  }, [])

  // AI composer Connection menu → open Notion connect / import
  useEffect(() => {
    const onOpen = () => {
      if (status?.connected) setPickerOpen(true)
      else startConnect()
    }
    window.addEventListener('thinktable-open-notion-connect', onOpen)
    return () => window.removeEventListener('thinktable-open-notion-connect', onOpen)
  }, [status?.connected, startConnect])

  const api = useMemo<NotionConnectApi>(
    () => ({
      status,
      loading,
      topBarPinned,
      authHref,
      startConnect,
      disconnect,
      openPicker,
      setTopBarPinned,
    }),
    [status, loading, topBarPinned, authHref, startConnect, disconnect, openPicker, setTopBarPinned]
  )

  return (
    <NotionConnectContext.Provider value={api}>
      {/* Hidden hit target so AI composer can still click [data-notion-connect] */}
      <button
        type="button"
        data-notion-connect
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onClick={() => {
          if (status?.connected) setPickerOpen(true)
          else startConnect()
        }}
      />
      {children}
      <NotionImportModal open={pickerOpen} onOpenChange={setPickerOpen} onImport={handleImport} />
    </NotionConnectContext.Provider>
  )
}

/** More → Connections — flat actions when connected (no 3rd nested submenu that ate OAuth clicks). */
export function NotionConnectMenuItems({ filterQuery = '' }: { filterQuery?: string }) {
  const api = useContext(NotionConnectContext) // Provider owns status / OAuth
  if (!api) return null
  const { status, loading, authHref } = api
  const q = filterQuery.trim().toLowerCase() // Search actions… filter
  const hay = `connections notion unpin pin permissions manage ${status?.workspaceName || ''}` // Match row or actions
  if (q && !hay.toLowerCase().includes(q)) return null // Hide when search misses
  const rightLabel = status?.connected ? status.workspaceName || 'Notion' : 'None' // Screenshot-style status

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={loading}
        className={cn('text-sm', loading && 'opacity-50')}
        title={status?.connected ? `Connections · ${rightLabel}` : 'Connections'}
      >
        <LayoutGrid className="h-4 w-4 mr-2" />
        Connections
        <span className="ml-auto mr-1 text-xs text-gray-400">{rightLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {status?.connected ? (
          <>
            <div className="px-2 py-1.5 flex items-center gap-2 text-sm text-gray-700">
              <NotionMarkIcon className="h-4 w-4" />
              <span className="truncate">Notion</span>
            </div>
            <DropdownMenuSeparator />
            <NotionConnectedActions />
          </>
        ) : (
          <DropdownMenuItem asChild disabled={loading}>
            <a
              href={status?.configured === false ? undefined : authHref}
              title={
                status?.configured === false
                  ? 'Notion OAuth credentials missing — click for setup steps'
                  : 'Connect Notion'
              }
              onClick={(e) => {
                if (status?.configured === false) {
                  e.preventDefault()
                  api.startConnect() // Shows the env setup alert
                }
              }}
              className="cursor-pointer"
            >
              <NotionMarkIcon className="h-4 w-4 mr-2" />
              Notion
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Top-bar pin left of Share — connection popup with Import / Edit permissions / Unpin / Disconnect.
 */
export function NotionTopBarPin({ className }: { className?: string }) {
  const api = useNotionConnect()
  const [open, setOpen] = useState(false)
  if (!api?.status?.connected || !api.topBarPinned) return null // Hidden until connected + pinned
  const label = api.status.workspaceName
    ? `Notion · ${api.status.workspaceName}`
    : 'Notion connection'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          disabled={api.loading}
          className={cn(
            'h-7 w-7 p-0 inline-flex items-center justify-center rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0 disabled:opacity-50',
            open && 'bg-gray-100',
            className
          )}
        >
          <NotionMarkIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        <NotionConnectedActions />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
