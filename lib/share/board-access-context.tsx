'use client'

// Board access role for the open board (owner / edit / comment / view)

import { createContext, useContext, type ReactNode } from 'react' // Context primitives
import {
  canEditBoard,
  canManageShare,
  canViewBoard,
  type BoardAccessRole,
} from '@/lib/share/roles' // Role helpers

type BoardAccessValue = {
  role: BoardAccessRole // Resolved access for current user
  boardId: string // conversations.id
  canView: boolean // SELECT allowed
  canEdit: boolean // Mutations allowed (edit|owner)
  canShare: boolean // Share menu (owner only)
  isOwner: boolean // Convenience
}

const BoardAccessContext = createContext<BoardAccessValue | null>(null) // Default unset

export function BoardAccessProvider({
  role,
  boardId,
  children,
}: {
  role: BoardAccessRole // From server resolve
  boardId: string // Current board
  children: ReactNode // Board tree
}) {
  const value: BoardAccessValue = {
    role, // Raw role
    boardId, // Board id
    canView: canViewBoard(role), // view+
    canEdit: canEditBoard(role), // edit|owner
    canShare: canManageShare(role), // owner
    isOwner: role === 'owner', // Owner flag
  }
  return <BoardAccessContext.Provider value={value}>{children}</BoardAccessContext.Provider>
}

/** Access for the current board; defaults to owner when outside provider (legacy embeds). */
export function useBoardAccess(): BoardAccessValue {
  const ctx = useContext(BoardAccessContext)
  if (ctx) return ctx // Provided
  return {
    role: 'owner', // Safe default for owner-only legacy mounts
    boardId: '',
    canView: true,
    canEdit: true,
    canShare: true,
    isOwner: true,
  }
}
