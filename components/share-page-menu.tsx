'use client'

// Top-bar Share dropdown: Notion people + email invites + copy link with view/comment/edit

import { useCallback, useEffect, useRef, useState } from 'react' // Local UI state
import { Check, ChevronDown, Copy, Link as LinkIcon, Loader2, Share2, X } from 'lucide-react' // Icons
import { Button } from '@/components/ui/button' // Shared button chrome
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Anchored panel
import { Input } from '@/components/ui/input' // Search / email field
import { SHARE_ROLE_LABELS, SHARE_ROLES, type ShareRole } from '@/lib/share/roles' // Role labels

type NotionPerson = {
  id: string // Notion user id
  name: string | null // Display name
  email: string | null // Email when available
  avatarUrl: string | null // Avatar URL
}

type SharePerson = {
  id: string // Grant row id
  role: ShareRole // Current permission
  email: string | null // Invite email
  notion_user_id: string | null // Notion person id
  display_name: string | null // Cached label
  avatar_url: string | null // Cached avatar
}

type ShareLink = {
  id: string // Link row id
  role: ShareRole // Permission attached to URL
  createdAt?: string // Mint time
}

type SharePageMenuProps = {
  pageId: string // conversations.id for this board
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: ShareRole // Current role
  onChange: (role: ShareRole) => void // Role change handler
  disabled?: boolean // Disable while saving
}) {
  return (
    <div className="relative flex-shrink-0">
      <select
        className="h-7 appearance-none rounded-md border border-gray-200 bg-white pl-2 pr-6 text-xs text-gray-700 outline-none hover:bg-gray-50 disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ShareRole)}
        onClick={(e) => e.stopPropagation()} // Keep share panel open
      >
        {SHARE_ROLES.map((role) => (
          <option key={role} value={role}>
            {SHARE_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
    </div>
  )
}

function PersonAvatar({
  name,
  avatarUrl,
}: {
  name: string | null // Fallback initial
  avatarUrl: string | null // Image when present
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() // Single-letter fallback
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-700">
      {initial}
    </div>
  )
}

export function SharePageMenu({ pageId }: SharePageMenuProps) {
  const [open, setOpen] = useState(false) // Dropdown open state
  const [query, setQuery] = useState('') // Search / email input
  const [inviteRole, setInviteRole] = useState<ShareRole>('edit') // Role for new invites
  const [linkRole, setLinkRole] = useState<ShareRole>('edit') // Role attached to copy link
  const [people, setPeople] = useState<SharePerson[]>([]) // Existing grants
  const [notionPeople, setNotionPeople] = useState<NotionPerson[]>([]) // Notion search hits
  const [notionConnected, setNotionConnected] = useState(false) // Whether Notion is linked
  const [loading, setLoading] = useState(false) // Initial share load
  const [searching, setSearching] = useState(false) // Notion search in flight
  const [inviting, setInviting] = useState(false) // Invite POST in flight
  const [copying, setCopying] = useState(false) // Copy-link in flight
  const [copied, setCopied] = useState(false) // Copied feedback flash
  const [error, setError] = useState<string | null>(null) // Inline error
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // Debounce handle

  const loadShare = useCallback(async () => {
    setLoading(true) // Spinner on
    setError(null) // Clear prior error
    try {
      const res = await fetch(`/api/share/${pageId}`) // Load grants + links
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load share')
      setPeople((data.people || []) as SharePerson[]) // Seed invited list
      const links = (data.links || []) as ShareLink[] // Active role links
      const preferred =
        links.find((l) => l.role === 'edit') ||
        links.find((l) => l.role === 'comment') ||
        links.find((l) => l.role === 'view') // Prefer strongest existing
      if (preferred) setLinkRole(preferred.role) // Restore last link role
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load share') // Show error
    } finally {
      setLoading(false) // Spinner off
    }
  }, [pageId])

  const searchNotion = useCallback(
    async (q: string) => {
      setSearching(true) // Search spinner
      try {
        const res = await fetch(`/api/notion/users?q=${encodeURIComponent(q)}`) // Notion people proxy
        const data = await res.json()
        if (!res.ok) {
          setNotionConnected(false) // Treat failure as disconnected
          setNotionPeople([])
          return
        }
        setNotionConnected(Boolean(data.connected)) // Connection flag
        setNotionPeople((data.people || []) as NotionPerson[]) // Hits
      } catch {
        setNotionConnected(false) // Offline / misconfig
        setNotionPeople([])
      } finally {
        setSearching(false) // Done
      }
    },
    []
  )

  useEffect(() => {
    if (!open) return // Only load when panel opens
    void loadShare() // Fetch grants
    void searchNotion('') // Prefetch workspace people
  }, [open, loadShare, searchNotion])

  useEffect(() => {
    if (!open) return // Ignore when closed
    if (searchTimer.current) clearTimeout(searchTimer.current) // Reset debounce
    searchTimer.current = setTimeout(() => {
      void searchNotion(query.trim()) // Debounced Notion search
    }, 200)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current) // Cleanup
    }
  }, [query, open, searchNotion])

  const invitePerson = async (opts: {
    email?: string | null
    notionUserId?: string | null
    displayName?: string | null
    avatarUrl?: string | null
    role?: ShareRole
  }) => {
    setInviting(true) // Lock UI
    setError(null)
    try {
      const res = await fetch(`/api/share/${pageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: opts.role || inviteRole,
          email: opts.email || undefined,
          notionUserId: opts.notionUserId || undefined,
          displayName: opts.displayName || undefined,
          avatarUrl: opts.avatarUrl || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to invite')
      const person = data.person as SharePerson
      setPeople((prev) => {
        const without = prev.filter((p) => p.id !== person.id) // Replace if updated
        return [...without, person]
      })
      setQuery('') // Clear search after add
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  const updatePersonRole = async (personId: string, role: ShareRole) => {
    setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, role } : p))) // Optimistic
    try {
      const res = await fetch(`/api/share/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, role }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update role')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
      void loadShare() // Revert from server
    }
  }

  const removePerson = async (personId: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== personId)) // Optimistic remove
    try {
      const res = await fetch(`/api/share/${pageId}?personId=${encodeURIComponent(personId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to remove')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
      void loadShare()
    }
  }

  const copyLink = async () => {
    setCopying(true) // Lock copy button
    setCopied(false)
    setError(null)
    try {
      const res = await fetch(`/api/share/${pageId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: linkRole }), // Permission attached to minted link
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create link')
      const url = data.link?.url as string
      await navigator.clipboard.writeText(url) // Copy role-bearing URL
      setCopied(true) // Flash success
      window.setTimeout(() => setCopied(false), 1600) // Clear flash
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to copy link')
    } finally {
      setCopying(false)
    }
  }

  const invitedNotionIds = new Set(
    people.map((p) => p.notion_user_id).filter(Boolean) as string[]
  ) // Already-added Notion ids
  const invitedEmails = new Set(
    people.map((p) => (p.email || '').toLowerCase()).filter(Boolean)
  ) // Already-added emails

  const suggestionPeople = notionPeople.filter((p) => {
    if (invitedNotionIds.has(p.id)) return false // Hide already invited
    if (p.email && invitedEmails.has(p.email.toLowerCase())) return false
    return true
  }) // Notion suggestions still available

  const trimmed = query.trim() // Current query
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) // Simple email check
  const canInviteEmail =
    looksLikeEmail && !invitedEmails.has(trimmed.toLowerCase()) // New email invite

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
          title="Share"
          type="button"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[360px] p-0"
        onCloseAutoFocus={(e) => e.preventDefault()} // Keep focus calm after close
        onKeyDown={(e) => e.stopPropagation()} // Don't let board shortcuts steal keys
      >
        <div className="border-b border-gray-100 px-3 py-2.5">
          <div className="mb-2 text-sm font-medium text-gray-900">Share</div>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                notionConnected ? 'Name, email, or Notion person…' : 'Invite by email…'
              }
              className="h-8 flex-1 text-sm"
              autoFocus
            />
            <RoleSelect value={inviteRole} onChange={setInviteRole} disabled={inviting} />
          </div>
        </div>

        <div className="max-h-56 overflow-y-auto px-1 py-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              {people.length > 0 && (
                <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  People with access
                </div>
              )}
              {people.map((person) => {
                const label =
                  person.display_name || person.email || person.notion_user_id || 'Person'
                return (
                  <div
                    key={person.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50"
                  >
                    <PersonAvatar name={label} avatarUrl={person.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-900">{label}</div>
                      {person.email && person.display_name ? (
                        <div className="truncate text-xs text-gray-500">{person.email}</div>
                      ) : null}
                    </div>
                    <RoleSelect
                      value={person.role}
                      onChange={(role) => void updatePersonRole(person.id, role)}
                    />
                    <button
                      type="button"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title="Remove"
                      onClick={() => void removePerson(person.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}

              {(searching || suggestionPeople.length > 0 || canInviteEmail) && (
                <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {notionConnected ? 'From Notion' : 'Invite'}
                </div>
              )}

              {canInviteEmail && (
                <button
                  type="button"
                  disabled={inviting}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 disabled:opacity-50"
                  onClick={() =>
                    void invitePerson({
                      email: trimmed,
                      displayName: trimmed,
                      role: inviteRole,
                    })
                  }
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-700">
                    @
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm text-gray-900">
                    Invite {trimmed}
                  </div>
                </button>
              )}

              {suggestionPeople.slice(0, 8).map((person) => {
                const label = person.name || person.email || 'Notion person'
                return (
                  <button
                    key={person.id}
                    type="button"
                    disabled={inviting}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 disabled:opacity-50"
                    onClick={() =>
                      void invitePerson({
                        email: person.email,
                        notionUserId: person.id,
                        displayName: person.name,
                        avatarUrl: person.avatarUrl,
                        role: inviteRole,
                      })
                    }
                  >
                    <PersonAvatar name={label} avatarUrl={person.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-900">{label}</div>
                      {person.email ? (
                        <div className="truncate text-xs text-gray-500">{person.email}</div>
                      ) : null}
                    </div>
                  </button>
                )
              })}

              {!loading &&
                people.length === 0 &&
                suggestionPeople.length === 0 &&
                !canInviteEmail &&
                !searching && (
                  <div className="px-3 py-5 text-center text-xs text-gray-500">
                    {notionConnected
                      ? 'Search Notion people or type an email'
                      : 'Connect Notion for workspace people, or invite by email'}
                  </div>
                )}
            </>
          )}
        </div>

        <div className="border-t border-gray-100 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
            <LinkIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">Anyone with the link</span>
            <RoleSelect value={linkRole} onChange={setLinkRole} disabled={copying} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center gap-2 text-sm"
            disabled={copying}
            onClick={() => void copyLink()}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" />
                Copied {SHARE_ROLE_LABELS[linkRole].toLowerCase()} link
              </>
            ) : (
              <>
                {copying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy {SHARE_ROLE_LABELS[linkRole].toLowerCase()} link
              </>
            )}
          </Button>
          <button
            type="button"
            className="mt-2 w-full text-center text-[11px] text-gray-400 hover:text-gray-700"
            onClick={() => {
              void (async () => {
                setError(null)
                const res = await fetch(`/api/share/${pageId}?revokeLinks=1`, { method: 'DELETE' })
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}))
                  setError(data.error || 'Failed to revoke links')
                  return
                }
                void loadShare()
              })()
            }}
          >
            Revoke all link access
          </button>
          {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
