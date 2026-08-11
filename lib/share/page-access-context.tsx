'use client'

// Page access role for the open board (owner / edit / comment / view)

import { createContext, useContext, type ReactNode } from 'react' // Context primitives
import {
  canEditPage,
  canManageShare,
  canViewPage,
  type PageAccessRole,
} from '@/lib/share/roles' // Role helpers

type PageAccessValue = {
  role: PageAccessRole // Resolved access for current user
  pageId: string // conversations.id
  canView: boolean // SELECT allowed
  canEdit: boolean // Mutations allowed (edit|owner)
  canShare: boolean // Share menu (owner only)
  isOwner: boolean // Convenience
}

const PageAccessContext = createContext<PageAccessValue | null>(null) // Default unset

export function PageAccessProvider({
  role,
  pageId,
  children,
}: {
  role: PageAccessRole // From server resolve
  pageId: string // Current page
  children: ReactNode // Board tree
}) {
  const value: PageAccessValue = {
    role, // Raw role
    pageId, // Page id
    canView: canViewPage(role), // view+
    canEdit: canEditPage(role), // edit|owner
    canShare: canManageShare(role), // owner
    isOwner: role === 'owner', // Owner flag
  }
  return <PageAccessContext.Provider value={value}>{children}</PageAccessContext.Provider>
}

/** Access for the current page; defaults to owner when outside provider (legacy embeds). */
export function usePageAccess(): PageAccessValue {
  const ctx = useContext(PageAccessContext)
  if (ctx) return ctx // Provided
  return {
    role: 'owner', // Safe default for owner-only legacy mounts
    pageId: '',
    canView: true,
    canEdit: true,
    canShare: true,
    isOwner: true,
  }
}
