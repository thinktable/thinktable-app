'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_BOARD_TITLE } from '@/lib/board-title' // Nav + / nested mint use the same default as empty `/board`
import type { User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MoreHorizontal, Trash2, Pencil, ChevronDown, File, FileText, Folder, FolderOpen, Loader2, Share2, UserPlus, CornerUpLeft, Sparkles, HelpCircle, LogOut, ChevronRight as ChevronRightIcon, Settings } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SettingsPanel } from '@/components/settings-panel'
import { UpgradePanel } from '@/components/upgrade-panel'
import { cn } from '@/lib/utils'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import { useTheme } from './theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSidebarContext } from './sidebar-context'
import { demoteBlockForDeletedBoard, syncBoardRenameToBlock } from '@/lib/blocks' // Keep block cards ↔ pages in sync
import {
  DndContext,
  closestCenter,
  rectIntersection,
  pointerWithin,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  Over,
  useDroppable,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface AppSidebarProps {
  user: User
}

// Page icon stored in conversations.metadata.icon (Notion-compatible shape)
type PageIconMeta =
  | { type: 'emoji'; emoji: string }
  | { type: 'external'; url: string }
  | { type: 'file'; url: string }
  | null
  | undefined

// Clickable page icon — blank/filled default, or emoji/image; click opens emoji picker
function PageIconButton({
  conversation,
  supabase,
  queryClient,
  userId,
}: {
  conversation: Conversation
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
  userId: string
}) {
  const { resolvedTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const icon = (conversation.metadata?.icon as PageIconMeta) || null
  const hasContent = conversation.metadata?.hasContent === true // Filled page glyph when contentful

  const saveIcon = async (next: PageIconMeta) => {
    try {
      const { data: row, error: fetchError } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversation.id)
        .eq('user_id', userId)
        .single()
      if (fetchError) throw fetchError
      const existing = (row?.metadata as Record<string, any>) || {}
      const updated = { ...existing }
      if (next) updated.icon = next
      else delete updated.icon
      const { error } = await supabase
        .from('conversations')
        .update({ metadata: updated })
        .eq('id', conversation.id)
        .eq('user_id', userId)
      if (error) throw error
      queryClient.setQueryData(['conversations'], (old: Conversation[] | undefined) => {
        if (!old) return old
        return old.map((c) =>
          c.id === conversation.id ? { ...c, metadata: updated } : c
        )
      })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['path-board-menu'] })
      queryClient.invalidateQueries({ queryKey: ['edit-panel-title'] })
    } catch (err) {
      console.error('Failed to update board icon:', err)
    }
    setOpen(false)
  }

  let iconNode: React.ReactNode
  if (icon?.type === 'emoji' && icon.emoji) {
    iconNode = <span className="text-sm leading-none">{icon.emoji}</span>
  } else if ((icon?.type === 'external' || icon?.type === 'file') && 'url' in icon && icon.url) {
    // eslint-disable-next-line @next/next/no-img-element
    iconNode = <img src={icon.url} alt="" className="h-4 w-4 rounded-sm object-cover" />
  } else if (hasContent) {
    iconNode = <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" /> // Filled / content page
  } else {
    iconNode = <File className="h-4 w-4 text-gray-400 dark:text-gray-500" /> // Blank page
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="h-5 w-5 flex-shrink-0 flex items-center justify-center rounded hover:bg-gray-200/70 dark:hover:bg-gray-700/70"
          title="Change icon"
          aria-label="Change board icon"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()} // Don't start row drag
        >
          {iconNode}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="p-0 w-auto border-0 shadow-lg overflow-hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="p-1">
          <Picker
            data={data}
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            onEmojiSelect={(emoji: { native?: string }) => {
              if (emoji?.native) saveIcon({ type: 'emoji', emoji: emoji.native })
            }}
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
        <div className="border-t border-gray-200 dark:border-gray-700 p-1">
          <DropdownMenuItem
            className="text-xs cursor-pointer"
            onClick={() => saveIcon(null)}
          >
            Default board icon
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Sortable board item component
function SortableBoardItem({
  conversation,
  isActive,
  isDeleting,
  deletingConversationId,
  isRenaming,
  pathname,
  openRenameDialog,
  openDeleteDialog,
  dragOverId,
  dragOverPosition,
  activeId,
  filteredConversations,
  projects,
  supabase,
  queryClient,
  refetch,
  project,
  depth = 0, // Nesting indent level (0 = root)
  hasChildren = false, // True when this board has nested sub-pages
  isExpanded = false, // Whether children are visible
  onToggleExpand, // Expand/collapse nested children
  onCreateSubBoard, // Mint an Untitled child nested under this board
  isCreatingBoard, // Disable New board while a mint is in flight
  userId, // Owner id for icon updates
}: {
  conversation: Conversation
  isActive: boolean
  isDeleting: boolean
  deletingConversationId: string | null
  isRenaming: boolean
  pathname: string
  openRenameDialog: (conv: Conversation) => void
  openDeleteDialog: (conv: Conversation) => void
  dragOverId: string | null
  dragOverPosition: 'above' | 'below' | 'top' | 'bottom' | 'into' | null
  activeId: string | null
  filteredConversations: Conversation[]
  projects: Project[]
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
  refetch: () => void
  project?: Project // Optional project if this board is under a project
  depth?: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpand?: (id: string) => void
  onCreateSubBoard?: (parent: Conversation) => void // Nested Untitled board under this row
  isCreatingBoard?: boolean // True while any board mint is in flight
  userId: string // Owner id for icon updates
}) {
  // Fetch bookmark count for this conversation
  const { data: bookmarkCount = 0 } = useQuery({
    queryKey: ['bookmark-count', conversation.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return 0

      // Count messages in this conversation that have bookmarked: true in metadata
      const { data: messages, error } = await supabase
        .from('messages')
        .select('metadata')
        .eq('conversation_id', conversation.id)
        .eq('user_id', user.id)

      if (error) {
        console.error('Error fetching bookmark count:', error)
        return 0
      }

      // Count messages where metadata.bookmarked === true
      const count = (messages || []).filter((msg) => {
        const metadata = (msg.metadata as Record<string, any>) || {}
        return metadata.bookmarked === true
      }).length

      return count
    },
    refetchOnWindowFocus: true,
    staleTime: 30000, // Cache for 30 seconds
  })

  const { closeSidebar } = useSidebarContext() // Dismiss nav when a board is opened
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: conversation.id })

  // Don't apply transform during drag - keep all items in place
  // Only show opacity change and cursor for the dragged item
  // Other items should not move until drag ends
  const isActiveDragging = activeId === conversation.id
  const style = {
    transform: activeId ? 'none' : CSS.Transform.toString(transform), // Prevent all transforms while any item is dragging
    transition: activeId ? 'none' : transition, // No transitions during drag
    opacity: isDragging ? 0.5 : 1,
  }

  const showIndicatorAbove = dragOverId === conversation.id && dragOverPosition === 'above'
  const showIndicatorBelow = dragOverId === conversation.id && dragOverPosition === 'below'
  const showNestHighlight = dragOverId === conversation.id && dragOverPosition === 'into' // Dropping into this page
  const showIndicatorTop = dragOverPosition === 'top' && conversation.id === filteredConversations[0]?.id
  const showIndicatorBottom = dragOverPosition === 'bottom' && conversation.id === filteredConversations[filteredConversations.length - 1]?.id

  return (
    <li ref={setNodeRef} style={style} data-id={conversation.id}>
      {/* Drop indicator line at top of list */}
      {showIndicatorTop && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mb-1 rounded-full" />
      )}

      {/* Drop indicator line above */}
      {showIndicatorAbove && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mb-1 rounded-full" />
      )}

      <div
        {...attributes}
        {...listeners}
        className={cn(
          'flex items-center gap-1 pr-4 h-8 rounded-lg transition-colors text-sm group cursor-grab active:cursor-grabbing relative',
          isActive
            ? 'bg-blue-50 dark:bg-[#2a2a3a]'
            // Hover bg only on real hover devices — iOS sticky :hover ate the first board tap
            : '[@media(hover:hover)]:hover:bg-gray-50 dark:[@media(hover:hover)]:hover:bg-[#1f1f1f]',
          isDragging && 'cursor-grabbing opacity-50',
          // Clear nest-into affordance when hovering center of a page
          showNestHighlight && 'bg-blue-100 dark:bg-blue-950/50 ring-2 ring-inset ring-blue-500 dark:ring-blue-400'
        )}
        style={{ paddingLeft: `${16 + depth * 14}px`, touchAction: 'manipulation' }} // Indent nested sub-pages; skip double-tap zoom delay
        title={showNestHighlight ? 'Drop to nest inside' : undefined}
      >
        {showNestHighlight && (
          // Left nest cue — mirrors Notion’s “make sub-page” hover state
          <span
            className="absolute left-1 top-1 bottom-1 w-0.5 rounded-full bg-blue-500 dark:bg-blue-400 pointer-events-none"
            aria-hidden
          />
        )}
        {/* Expand/collapse nested children (Notion-style) */}
        {hasChildren ? (
          <button
            type="button"
            className="h-5 w-5 flex-shrink-0 flex items-center justify-center rounded hover:bg-gray-200/60 dark:hover:bg-gray-700/60 text-gray-500"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleExpand?.(conversation.id)
            }}
            onPointerDown={(e) => e.stopPropagation()} // Don't start drag from chevron
            aria-label={isExpanded ? 'Collapse sub-boards' : 'Expand sub-boards'}
          >
            <ChevronRightIcon className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="h-5 w-5 flex-shrink-0" aria-hidden /> // Spacer aligns titles with parents that have chevrons
        )}
        <PageIconButton
          conversation={conversation}
          supabase={supabase}
          queryClient={queryClient}
          userId={userId}
        />
        <Link
          href={`/board/${conversation.id}`}
          className="flex items-center gap-2 flex-1 min-w-0 text-gray-700 dark:text-gray-300"
          onClick={(e) => {
            // Prevent navigation when dragging
            if (isDragging) {
              e.preventDefault()
              return
            }
            closeSidebar() // Board select dismisses the nav (same as outside click)
          }}
        >
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="truncate">{conversation.title}</span>
            {/* Bookmark count badge with circular yellow shadow - positioned inline right after title text */}
            {bookmarkCount > 0 && (
              <span
                className="flex-shrink-0 h-3 min-w-[12px] px-0.5 inline-flex items-center justify-center text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-yellow-400/20 dark:bg-yellow-400/20 rounded-full shadow-[0_0_4px_1px_rgba(250,204,21,0.4)]"
              >
                {bookmarkCount}
              </span>
            )}
          </span>
        </Link>

        {/* Hover actions: + nests a child board; … opens the rest of the options */}
        <div
          className={cn(
            'flex items-center flex-shrink-0 transition-opacity',
            // Always visible on touch; fade in on hover-capable pointers only (avoids sticky first-tap)
            'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-6 hover:bg-transparent',
              isActive
                ? 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-900'
                : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200'
            )}
            title="Add board inside" // Tooltip for the nested-board mint
            aria-label="Add board inside"
            disabled={isCreatingBoard} // One mint at a time
            onClick={(e) => {
              e.stopPropagation() // Don't navigate the row
              e.preventDefault()
              onCreateSubBoard?.(conversation) // Nest an Untitled board under this one
            }}
            onPointerDown={(e) => {
              e.stopPropagation() // Don't start drag from +
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-6 hover:bg-transparent',
                isActive
                  ? 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-900'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200'
              )}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onPointerDown={(e) => {
                // Stop drag when clicking dropdown
                e.stopPropagation()
              }}
            >
              <MoreHorizontal className="h-8 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation() // Don't navigate the row
                onCreateSubBoard?.(conversation) // Nest an Untitled board under this one
              }}
              disabled={isCreatingBoard} // One mint at a time
            >
              <Plus className="h-4 w-4 mr-2" />
              Add board inside
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                // Share functionality - copy board URL to clipboard
                const boardUrl = `${window.location.origin}/board/${conversation.id}`
                navigator.clipboard.writeText(boardUrl)
                // TODO: Show toast notification
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openRenameDialog(conversation)
              }}
              disabled={isRenaming}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <Folder className="h-4 w-4 mr-2" />
                Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          const { data: conversationData, error: fetchError } = await supabase
                            .from('conversations')
                            .select('metadata')
                            .eq('id', conversation.id)
                            .single()

                          if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

                          const existingMetadata = (conversationData?.metadata as Record<string, any>) || {}
                          const updatedMetadata = { ...existingMetadata, project_id: project.id }

                          const { error } = await supabase
                            .from('conversations')
                            .update({ metadata: updatedMetadata })
                            .eq('id', conversation.id)

                          if (error) {
                            console.error('Error moving board to project:', error)
                            alert('Failed to move board to project. Please try again.')
                          } else {
                            // Optimistic update
                            queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
                              if (!oldData) return oldData
                              return oldData.map((conv) =>
                                conv.id === conversation.id ? { ...conv, metadata: updatedMetadata } : conv
                              )
                            })

                            // Refetch
                            queryClient.invalidateQueries({ queryKey: ['conversations'] })
                            refetch()
                          }
                        } catch (error: any) {
                          console.error('Error moving board to project:', error)
                          alert('Failed to move board to project. Please try again.')
                        }
                      }}
                    >
                      {project.name}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    No projects available
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {project && (
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    const { data: conversationData, error: fetchError } = await supabase
                      .from('conversations')
                      .select('metadata')
                      .eq('id', conversation.id)
                      .single()

                    if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

                    const existingMetadata = (conversationData?.metadata as Record<string, any>) || {}
                    const updatedMetadata = { ...existingMetadata }
                    // Remove project_id from metadata
                    delete updatedMetadata.project_id

                    const { error } = await supabase
                      .from('conversations')
                      .update({ metadata: updatedMetadata })
                      .eq('id', conversation.id)

                    if (error) {
                      console.error('Error removing board from project:', error)
                      alert('Failed to remove board from project. Please try again.')
                    } else {
                      // Optimistic update
                      queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
                        if (!oldData) return oldData
                        return oldData.map((conv) =>
                          conv.id === conversation.id ? { ...conv, metadata: updatedMetadata } : conv
                        )
                      })

                      // Refetch
                      queryClient.invalidateQueries({ queryKey: ['conversations'] })
                      refetch()
                    }
                  } catch (error: any) {
                    console.error('Error removing board from project:', error)
                    alert('Failed to remove board from project. Please try again.')
                  }
                }}
              >
                <CornerUpLeft className="h-4 w-4 mr-2" />
                Remove from {project.name}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="mx-2 my-1" />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openDeleteDialog(conversation)
              }}
              disabled={deletingConversationId === conversation.id}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deletingConversationId === conversation.id ? 'Deleting...' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>

      </div>

      {/* Drop indicator line below */}
      {showIndicatorBelow && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mt-1 rounded-full" />
      )}

      {/* Drop indicator line at bottom of list */}
      {showIndicatorBottom && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mt-1 rounded-full" />
      )}
    </li>
  )
}

// Droppable project item component - accepts board drops
function DroppableProjectItem({
  project,
  isActive,
  isDragOver,
  isExpanded,
  onToggleExpand,
  projectBoards,
  pathname,
  deletingConversationId,
  isRenaming,
  openRenameDialog,
  openDeleteDialog,
  openRenameProjectDialog,
  openDeleteProjectDialog,
  deletingProjectId,
  isRenamingProject,
  dragOverId,
  dragOverPosition,
  activeId,
  filteredConversations,
  projects,
  supabase,
  queryClient,
  refetch,
  userId,
  onCreateSubBoard, // Forward nested-board mint to child rows
  isCreatingBoard, // Disable New board while a mint is in flight
}: {
  project: Project
  isActive: boolean
  isDragOver: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  projectBoards: Conversation[]
  pathname: string
  deletingConversationId: string | null
  isRenaming: boolean
  openRenameDialog: (conv: Conversation) => void
  openDeleteDialog: (conv: Conversation) => void
  openRenameProjectDialog: (project: Project) => void
  openDeleteProjectDialog: (project: Project) => void
  deletingProjectId: string | null
  isRenamingProject: boolean
  dragOverId: string | null
  dragOverPosition: 'above' | 'below' | 'top' | 'bottom' | 'into' | null
  activeId: string | null
  filteredConversations: Conversation[]
  projects: Project[]
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
  refetch: () => void
  userId: string
  onCreateSubBoard?: (parent: Conversation) => void // Nested Untitled board under a project board
  isCreatingBoard?: boolean // True while any board mint is in flight
}) {
  const { setNodeRef } = useDroppable({
    id: `project-${project.id}`, // Prefix with 'project-' to identify as project drop target
  })

  const hasBoards = projectBoards.length > 0
  // Show folder icon when not expanded, folder-open icon when expanded and has boards, file icon when expanded but no boards
  const Icon = !isExpanded ? Folder : (hasBoards ? FolderOpen : File)

  // Check if drop indicator should show above or below this project
  // Only show indicators when actively dragging (activeId is not null)
  const projectDragOverId = `project-${project.id}`
  const isDragging = activeId !== null
  const isLastProject = project.id === projects[projects.length - 1]?.id
  const showIndicatorAbove = isDragging && dragOverId === projectDragOverId && dragOverPosition === 'above'
  // Only show "below" indicator if it's not the last project (last project uses "bottom" indicator)
  const showIndicatorBelow = isDragging && !isLastProject && dragOverId === projectDragOverId && dragOverPosition === 'below'
  const showIndicatorTop = isDragging && dragOverPosition === 'top' && project.id === projects[0]?.id
  const showIndicatorBottom = isDragging && dragOverPosition === 'bottom' && isLastProject

  return (
    <li ref={setNodeRef} className="space-y-0" data-id={projectDragOverId}>
      {/* Drop indicator line at top of projects list */}
      {showIndicatorTop && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mb-1 rounded-full" />
      )}

      {/* Drop indicator line above project */}
      {showIndicatorAbove && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mb-1 rounded-full" />
      )}

      <div
        className={cn(
          'flex items-center gap-2 px-4 h-8 rounded-lg transition-colors text-sm border-2 group',
          isActive
            ? 'bg-blue-50 dark:bg-[#2a2a3a] text-gray-700 dark:text-gray-300 border-transparent'
            : isDragOver
              ? 'bg-blue-50 dark:bg-[#2a2a3a] text-gray-700 dark:text-gray-300 border-blue-500 dark:border-blue-400 border-dashed'
              : 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f] text-gray-700 dark:text-gray-300 border-transparent'
        )}
      >
        <Link
          href={`/project/${project.id}`}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          {hasBoards ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onToggleExpand()
              }}
              className="flex-shrink-0 p-0.5 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] rounded transition-colors"
              title={isExpanded ? 'Collapse project' : 'Expand project'}
              aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
            >
              <Icon className="h-4 w-4" />
            </button>
          ) : (
            <Icon className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="truncate flex-1">{project.name}</span>
        </Link>

        {/* Dropdown menu button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:bg-transparent',
                isActive ? 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-900' : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200'
              )}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              <MoreHorizontal className="h-8 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                // Share functionality - copy project URL to clipboard
                const projectUrl = `${window.location.origin}/project/${project.id}`
                navigator.clipboard.writeText(projectUrl)
                // TODO: Show toast notification
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openRenameProjectDialog(project)
              }}
              disabled={isRenamingProject}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Rename project
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 my-1" />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openDeleteProjectDialog(project)
              }}
              disabled={deletingProjectId === project.id}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deletingProjectId === project.id ? 'Deleting...' : 'Delete project'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Show boards under project when expanded - styled like ChatGPT nested items (directly under, no extra spacing) */}
      {isExpanded && hasBoards && (
        <ul className="space-y-0">
          {projectBoards.map((conversation) => {
            const isActive = pathname === `/board/${conversation.id}`
            const isDeleting = deletingConversationId === conversation.id
            return (
              <SortableBoardItem
                key={conversation.id}
                conversation={conversation}
                isActive={isActive}
                isDeleting={isDeleting}
                deletingConversationId={deletingConversationId}
                isRenaming={isRenaming}
                pathname={pathname}
                openRenameDialog={openRenameDialog}
                openDeleteDialog={openDeleteDialog}
                dragOverId={dragOverId}
                dragOverPosition={dragOverPosition}
                activeId={activeId}
                filteredConversations={filteredConversations}
                projects={projects}
                supabase={supabase}
                queryClient={queryClient}
                refetch={refetch}
                project={project}
                userId={userId}
                onCreateSubBoard={onCreateSubBoard} // Same nested-board mint as the Boards list
                isCreatingBoard={isCreatingBoard} // Disable New board while a mint is in flight
              />
            )
          })}
        </ul>
      )}

      {/* Drop indicator line below project */}
      {showIndicatorBelow && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mt-1 rounded-full" />
      )}

      {/* Drop indicator line at bottom of projects list */}
      {showIndicatorBottom && (
        <div className="h-0.5 bg-blue-500 dark:bg-blue-400 mx-4 mt-1 rounded-full" />
      )}
    </li>
  )
}


// Boards section header component - NOT droppable, just a header
function BoardsSectionHeader({
  isExpanded,
  onToggleExpand,
}: {
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <div
      className="flex items-center gap-1 pl-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer group transition-colors rounded-lg min-h-[32px]"
      onClick={onToggleExpand}
    >
      <span>Boards</span>
      <ChevronDown
        className={cn(
          'h-3 w-3 opacity-0 group-hover:opacity-100 transition-all duration-200',
          !isExpanded && 'group-hover:-rotate-90'
        )}
      />
    </div>
  )
}

// Boards List wrapper - NOT droppable, just a container
function BoardsListWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {children}
    </div>
  )
}

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  position?: number // Optional position field for ordering
  metadata?: {
    project_id?: string
    parent_id?: string // Nest under another board (Notion-style sub-pages)
    position?: number
    icon?: PageIconMeta // Emoji / image / default blank|filled
    hasContent?: boolean // True → filled page glyph when no custom icon
    notionPageId?: string // Linked Notion page when imported
    [key: string]: any
  }
}

interface Project {
  id: string
  name: string
  created_at: string
  updated_at: string
  position?: number // Optional position field for ordering
}

// Resolve parent board id from metadata (null = root)
function getBoardParentId(conv: Conversation): string | null {
  const parentId = conv.metadata?.parent_id // Nested under this board when set
  if (parentId && typeof parentId === 'string' && parentId.trim() !== '') return parentId
  return null
}

// True if nesting dragId under targetParentId would create a cycle
function wouldCreateNestCycle(boards: Conversation[], dragId: string, targetParentId: string): boolean {
  let current: string | null = targetParentId // Walk up from proposed parent
  const byId = new Map(boards.map((b) => [b.id, b])) // O(1) parent lookup
  const seen = new Set<string>() // Guard against corrupt cycles in data
  while (current) {
    if (current === dragId) return true // Target is drag or its descendant
    if (seen.has(current)) return true
    seen.add(current)
    const parent = byId.get(current)
    current = parent ? getBoardParentId(parent) : null
  }
  return false
}

// Flatten boards into a depth-aware list for Notion-style nested menu rendering
function flattenBoardTree(
  boards: Conversation[],
  expandedIds: Set<string>
): { conversation: Conversation; depth: number; hasChildren: boolean }[] {
  const byParent = new Map<string | null, Conversation[]>() // Children grouped by parent_id
  const idSet = new Set(boards.map((b) => b.id)) // Known ids for orphan roots

  for (const board of boards) {
    let parentId = getBoardParentId(board)
    if (parentId && !idSet.has(parentId)) parentId = null // Orphan → treat as root
    const list = byParent.get(parentId) || []
    list.push(board)
    byParent.set(parentId, list)
  }

  const sortSiblings = (a: Conversation, b: Conversation) => {
    if (a.position !== undefined && b.position !== undefined) return a.position - b.position
    if (a.position !== undefined) return -1
    if (b.position !== undefined) return 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  }

  for (const [, kids] of byParent) kids.sort(sortSiblings)

  const result: { conversation: Conversation; depth: number; hasChildren: boolean }[] = []
  const walk = (parentId: string | null, depth: number) => {
    const kids = byParent.get(parentId) || []
    for (const child of kids) {
      const hasChildren = (byParent.get(child.id) || []).length > 0
      result.push({ conversation: child, depth, hasChildren })
      if (hasChildren && expandedIds.has(child.id)) walk(child.id, depth + 1) // Recurse when expanded
    }
  }
  walk(null, 0)
  return result
}

// Mint a New board (root from +, nested from a row’s more menu). Client UUID avoids INSERT…RETURNING RLS races.
async function createUntitledBoard(
  supabase: ReturnType<typeof createClient>,
  opts: {
    userId: string // Owner of the new conversations row
    parentId?: string // When set, nest under this board via metadata.parent_id
    projectId?: string // Keep project membership when nesting under a project board
  }
): Promise<string | null> {
  const boardId = crypto.randomUUID() // Client id so INSERT need not RETURNING through SELECT RLS
  const metadata: Record<string, unknown> = {} // Spatial/nav fields only — empty board has no body yet
  if (opts.parentId) metadata.parent_id = opts.parentId // Sub-board in the boards list tree
  else metadata.position = -1 // Root boards pin to the top of the list
  if (opts.projectId) metadata.project_id = opts.projectId // Stay in the same project as the parent
  const { error } = await supabase.from('conversations').insert({
    id: boardId, // Use the client UUID as the primary key
    user_id: opts.userId, // RLS: owner is the signed-in user
    title: DEFAULT_BOARD_TITLE, // Same default as empty `/board` until the user renames
    metadata, // Nesting / project / list position
  })
  if (error) {
    console.error('Failed to create board:', error) // Surface insert failures for debugging
    return null // Caller shows an alert
  }
  return boardId // Navigate + cache-patch with this id
}

// Fetch conversations/boards for the user
async function fetchConversations(): Promise<Conversation[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at, metadata')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching conversations:', error)
    return []
  }

  // Map data and include full metadata (for project_id and position)
  // IMPORTANT: Return ALL conversations (including project boards) - filtering happens in component
  const conversations = (data || []).map((conv: any) => ({
    id: conv.id,
    title: conv.title,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    position: conv.metadata?.position ?? undefined,
    metadata: conv.metadata || undefined, // Include full metadata object for project_id
  })) as Conversation[]

  // Sort by position if available, otherwise by updated_at
  // Don't filter here - we need all conversations to show project boards under projects
  return conversations.sort((a, b) => {
    if (a.position !== undefined && b.position !== undefined) {
      return a.position - b.position
    }
    if (a.position !== undefined) return -1
    if (b.position !== undefined) return 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

// Fetch projects for the user
async function fetchProjects(): Promise<Project[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, updated_at, metadata')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching projects:', error)
    return []
  }

  // Map data and extract position from metadata if available
  const projects = (data || []).map((proj: any) => ({
    id: proj.id,
    name: proj.name,
    created_at: proj.created_at,
    updated_at: proj.updated_at,
    position: proj.metadata?.position ?? undefined,
  })) as Project[]

  // Sort by position if available, otherwise by updated_at
  return projects.sort((a, b) => {
    if (a.position !== undefined && b.position !== undefined) {
      return a.position - b.position
    }
    if (a.position !== undefined) return -1
    if (b.position !== undefined) return 1
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
}

const NAV_POPUP_TOP = 52 // Flush under top bar so hover can bridge from the menu icon
const NAV_POPUP_MAX_CAP = 720 // Don't grow endlessly on tall screens
const NAV_POPUP_CHROME_GAP = 8 // Air between the popup bottom and Free nav / minimap
const NAV_POPUP_MIN_H = 160 // Search + a few boards still usable if chrome is tall

/** Cap the board nav popup so it never covers Free nav or an open minimap. */
function measureNavPopupMaxHeight(popupTop: number): number {
  const vh = window.innerHeight // Fallback when map chrome isn't on this page
  let chromeTop = vh - NAV_POPUP_CHROME_GAP // Default: inset from the window bottom
  document.querySelectorAll('[data-minimap-toggle-context], [data-minimap-context], [data-minimap-pill-context]').forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect() // Screen box of Free nav / minimap / +/-
    if (r.height < 1 || r.width < 1) return // Skip clipped (closed) minimap
    chromeTop = Math.min(chromeTop, r.top) // Highest chrome edge in the bottom-left stack
  })
  const available = chromeTop - popupTop - NAV_POPUP_CHROME_GAP // Room between the top bar and that chrome
  return Math.max(NAV_POPUP_MIN_H, Math.min(NAV_POPUP_MAX_CAP, available)) // Clamp to a usable range
}

export default function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const [isCollapsed] = useState(false) // Always expanded inside hover popup (kept for legacy branches)
  const [showDeleteBoardDialog, setShowDeleteBoardDialog] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState<{ id: string; title: string } | null>(null)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [conversationToRename, setConversationToRename] = useState<{ id: string; title: string } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isBoardsExpanded, setIsBoardsExpanded] = useState(true) // Boards section expanded/collapsed state
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true) // Projects section expanded/collapsed state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set()) // Track which individual projects are expanded
  const [activeId, setActiveId] = useState<string | null>(null) // Currently dragging board ID
  const [dragOverId, setDragOverId] = useState<string | null>(null) // Board being dragged over
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below' | 'top' | 'bottom' | 'into' | null>(null) // Position indicator (into = nest)
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null) // Project being dragged over (for board-to-project drops)
  const [expandedBoardIds, setExpandedBoardIds] = useState<Set<string>>(new Set()) // Nested sub-page expand state
  const [isCreatingBoard, setIsCreatingBoard] = useState(false) // True while + or New board mint is in flight
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false) // Create project dialog state
  const [projectName, setProjectName] = useState('') // Project name input
  const [isCreatingProject, setIsCreatingProject] = useState(false) // Creating project state
  const [showDeleteProjectDialog, setShowDeleteProjectDialog] = useState(false) // Delete project dialog state
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null) // Project to delete
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null) // Currently deleting project ID
  const [showRenameProjectDialog, setShowRenameProjectDialog] = useState(false) // Rename project dialog state
  const [projectToRename, setProjectToRename] = useState<{ id: string; name: string } | null>(null) // Project to rename
  const [projectRenameInput, setProjectRenameInput] = useState('') // Project rename input
  const [isRenamingProject, setIsRenamingProject] = useState(false) // Renaming project state
  const mouseMoveCleanupRef = useRef<(() => void) | null>(null) // Cleanup function for mouse move listener
  const currentMouseYRef = useRef<number | null>(null) // Track current mouse Y position for accurate indicator placement
  const projectsExpandedInitializedRef = useRef(false) // Track if we've initialized project expansion
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { isMobileMode, isSidebarOpen, isSidebarPinned, closeSidebar, openSidebar, scheduleCloseSidebar, cancelCloseSidebar, aiMapDockLiftPx } = useSidebarContext()
  const [navPopupMaxHeight, setNavPopupMaxHeight] = useState<number>(() =>
    typeof window === 'undefined' ? NAV_POPUP_MAX_CAP : measureNavPopupMaxHeight(NAV_POPUP_TOP) // SSR: cap; client: already miss chrome
  )

  // Close hover-only nav on route change; click-pinned stays open across page switches
  useEffect(() => {
    if (isSidebarPinned) return // Keep open across board switches; board click still dismisses
    closeSidebar()
  }, [pathname, closeSidebar, isSidebarPinned])

  // Keep the popup above Free nav / open minimap (height tween, phone dock lift, window resize)
  useLayoutEffect(() => {
    if (!isSidebarOpen) return // Closed — nothing to size
    const update = () => setNavPopupMaxHeight(measureNavPopupMaxHeight(NAV_POPUP_TOP)) // Re-read chrome boxes
    update() // Before paint so the first open frame already misses the stack
    const ro = new ResizeObserver(update) // Minimap clip height 0→120 and Free nav size
    document.querySelectorAll('[data-minimap-toggle-context], [data-minimap-context]').forEach((el) => ro.observe(el))
    window.addEventListener('resize', update) // Desktop window / top-bar wrap
    window.visualViewport?.addEventListener('resize', update) // iOS keyboard inset
    return () => {
      ro.disconnect() // Drop chrome observers
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [isSidebarOpen, pathname, aiMapDockLiftPx, isMobileMode]) // Rebind when chrome mounts or the dock jumps

  // Fetch user profile for name/username and subscription tier
  const { data: profile } = useQuery({
    queryKey: ['user-profile', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, subscription_tier')
        .eq('id', user.id)
        .single()
      
      if (error) {
        console.error('Error fetching profile:', error)
        return null
      }
      return data
    },
  })

  // Handle logout
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      router.push('/login')
    } catch (error) {
      console.error('Error signing out:', error)
      // Still redirect even if signOut fails
      router.push('/login')
    }
  }

  // Ensure hover works on first load when window is in focus
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Wait for page to be fully interactive before ensuring hover works
    const ensureHoverWorks = () => {
      // If window has focus, ensure it stays focused so CSS hover works immediately
      // This fixes the issue where hover doesn't work on first load even when window has focus
      if (document.hasFocus()) {
        // Window is in focus - ensure it stays focused for hover to work on first load
        // Calling focus() when already focused helps ensure hover events are ready
        window.focus()
      }
    }

    // Wait for page to be fully loaded and interactive
    if (document.readyState === 'complete') {
      // Page is already loaded - try immediately
      ensureHoverWorks()
    } else {
      // Wait for page to finish loading
      window.addEventListener('load', ensureHoverWorks, { once: true })
    }

    // Also try after a short delay to catch edge cases
    const timeoutId = setTimeout(ensureHoverWorks, 200)

    // Listen for focus events to ensure hover works when window gains focus
    const handleFocus = () => {
      // When window gains focus, ensure it's focused so hover works
      window.focus()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('load', ensureHoverWorks)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  // Configure drag sensors
  // Mouse: small drag distance. Touch: hold ~long-press so a quick tap still opens the board.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 450, // Match LONG_PRESS_MS — tap navigates; hold reorders
        tolerance: 10, // Match LONG_PRESS_MOVE_PX so jitter doesn’t arm drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const activeIdValue = event.active.id as string
    setActiveId(activeIdValue)

    // Add document-level mouse move listener for top/bottom detection and accurate cursor tracking
    const handleMouseMove = (e: MouseEvent) => {
      // Store current mouse Y position for accurate indicator placement
      currentMouseYRef.current = e.clientY

      const listElement = document.querySelector('ul.space-y-1') as HTMLElement
      if (listElement) {
        const listRect = listElement.getBoundingClientRect()
        const threshold = 15 // Pixels from top/bottom to trigger absolute positioning (reduced to prevent premature jumping)
        const clearBuffer = 10 // Buffer zone before clearing top/bottom to prevent jumping

        // Check if mouse is very close to top of list (within threshold and within list bounds)
        if (e.clientY >= listRect.top && e.clientY < listRect.top + threshold) {
          setDragOverId(null)
          setDragOverPosition('top')
          return
        }

        // Check if mouse is very close to bottom of list (within threshold and within list bounds)
        if (e.clientY > listRect.bottom - threshold && e.clientY <= listRect.bottom) {
          setDragOverId(null)
          setDragOverPosition('bottom')
          return
        }

        // If we're not at top/bottom, clear those positions (but keep relative positions)
        // Use a function to get current state
        setDragOverPosition((current) => {
          if (current === 'top') {
            // When coming down from top, only clear if we're well past the threshold
            // Use a larger buffer to allow smooth transition to first item's "above" position
            // This prevents skipping the second-to-top line
            const topClearThreshold = listRect.top + threshold + clearBuffer + 20 // Extra buffer for smooth transition
            if (e.clientY > topClearThreshold) {
              return null
            }
            return current
          }
          if (current === 'bottom') {
            // When coming up from bottom, only clear if we're well past the threshold
            // Use a larger buffer to allow smooth transition to last item's "below" position
            const bottomClearThreshold = listRect.bottom - threshold - clearBuffer - 20 // Extra buffer for smooth transition
            if (e.clientY < bottomClearThreshold) {
              return null
            }
            return current
          }
          return current
        })
      }

      // Continuous above / into / below while hovering a board row (onDragOver often skips same-target moves)
      // Walk the hit stack so DragOverlay / the dragged row don't block the drop target underneath
      const stack = document.elementsFromPoint(e.clientX, e.clientY)
      for (const node of stack) {
        const row = (node as Element).closest?.('[data-id]') as HTMLElement | null
        if (!row) continue
        const rowId = row.getAttribute('data-id')
        if (!rowId || rowId === activeIdValue || rowId.startsWith('project-')) continue

        const rect = row.getBoundingClientRect()
        const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1)
        setDragOverId(rowId)
        setDragOverProjectId(null)
        // Narrow edge bands so the nest-into zone is easy to hit on short rows
        if (ratio < 0.22) setDragOverPosition('above')
        else if (ratio > 0.78) setDragOverPosition('below')
        else setDragOverPosition('into')
        break
      }
    }

    document.addEventListener('mousemove', handleMouseMove)

    // Store cleanup function
    mouseMoveCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }

  // Handle drag end - save new order, nest under a page, or associate with project
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Store drag over state BEFORE clearing (needed to detect project drops via indicator)
    const wasOverProject = dragOverProjectId !== null
    const dragOverProjectIdValue = dragOverProjectId
    const dragOverIdValue = dragOverId
    const dragOverPositionValue = dragOverPosition // Nest vs reorder zone

    // Clear all drag over states immediately
    setActiveId(null)
    setDragOverId(null)
    setDragOverPosition(null)
    setDragOverProjectId(null)

    // Clean up mouse move listener
    if (mouseMoveCleanupRef.current) {
      mouseMoveCleanupRef.current()
      mouseMoveCleanupRef.current = null
    }

    const boardId = active.id as string
    const activeBoard = conversations.find(c => c.id === boardId)
    const activeBoardHasProject = activeBoard?.metadata?.project_id &&
      typeof activeBoard.metadata.project_id === 'string' &&
      activeBoard.metadata.project_id.trim() !== ''

    const overId = over ? (typeof over.id === 'string' ? over.id : String(over.id)) : null

    // Check if dropping on a project (direct hit OR via indicator) OR on a board that belongs to a project
    // When indicator shows below project, dragOverId is 'project-{id}' even if over.id is something else
    let projectId: string | null = null

    // PRIORITY 1: Check if dragOverId was set to a project (indicator was showing)
    if (dragOverIdValue && typeof dragOverIdValue === 'string' && dragOverIdValue.startsWith('project-')) {
      projectId = dragOverIdValue.replace('project-', '')
      console.log('🎯 PRIORITY 1: Detected project drop via indicator:', { projectId, dragOverIdValue, overId })
    }
    // PRIORITY 2: Check if over.id is directly a project
    else if (overId && overId.startsWith('project-')) {
      projectId = overId.replace('project-', '')
      console.log('🎯 PRIORITY 2: Detected project drop via direct hit:', { projectId, overId })
    }
    // PRIORITY 3: Check if dropping on a board that belongs to a project (dropping between boards in project list)
    else if (overId) {
      const overBoard = conversations.find(c => c.id === overId)
      if (overBoard?.metadata?.project_id && typeof overBoard.metadata.project_id === 'string' && overBoard.metadata.project_id.trim() !== '') {
        projectId = overBoard.metadata.project_id
        console.log('🎯 PRIORITY 3: Detected project drop via board in project list:', { projectId, overId, overBoardTitle: overBoard.title })
      }
    }
    // PRIORITY 4: Fallback - we were over a project
    if (!projectId && wasOverProject && dragOverProjectIdValue) {
      projectId = dragOverProjectIdValue
      console.log('🎯 PRIORITY 4: Detected project drop via fallback:', { projectId, dragOverProjectIdValue, overId })
    }

    if (projectId) {
      console.log('✅ Dropping board on project:', { boardId, projectId })

      try {
        const { data: conversation, error: fetchError } = await supabase
          .from('conversations')
          .select('metadata')
          .eq('id', boardId)
          .eq('user_id', user.id)
          .single()

        if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

        const existingMetadata = (conversation?.metadata as Record<string, any>) || {}
        // Moving into a project clears page nesting (project membership takes over)
        const { parent_id: _clearedParent, ...withoutParent } = existingMetadata
        const updatedMetadata = { ...withoutParent, project_id: projectId }

        const { error } = await supabase
          .from('conversations')
          .update({ metadata: updatedMetadata })
          .eq('id', boardId)
          .eq('user_id', user.id)

        if (error) {
          console.error('❌ Error adding board to project:', error)
          alert('Failed to move board to project. Please try again.')
        } else {
          // Optimistic update
          queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
            if (!oldData) return oldData
            return oldData.map((conv) =>
              conv.id === boardId ? { ...conv, metadata: updatedMetadata } : conv
            )
          })

          // Expand project
          setExpandedProjects((prev) => new Set(prev).add(projectId))

          // Refetch
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await refetch()
        }
      } catch (error: any) {
        console.error('Error adding board to project:', error)
        alert('Failed to move board to project. Please try again.')
      }
      return
    }

    // Nest into another page when dropped in the center "into" zone (Notion-style)
    if (
      dragOverPositionValue === 'into' &&
      overId &&
      !overId.startsWith('project-') &&
      overId !== boardId
    ) {
      const targetParentId = overId
      if (wouldCreateNestCycle(conversations, boardId, targetParentId)) {
        return // Refuse cycles (can't nest a page under its own descendant)
      }
      try {
        const { data: conversation, error: fetchError } = await supabase
          .from('conversations')
          .select('metadata')
          .eq('id', boardId)
          .eq('user_id', user.id)
          .single()
        if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

        const existingMetadata = (conversation?.metadata as Record<string, any>) || {}
        const { project_id: _dropProject, ...rest } = existingMetadata // Nesting is for main board list
        const updatedMetadata = { ...rest, parent_id: targetParentId }

        const { error } = await supabase
          .from('conversations')
          .update({ metadata: updatedMetadata })
          .eq('id', boardId)
          .eq('user_id', user.id)

        if (error) {
          console.error('Error nesting board:', error)
          alert('Failed to nest board. Please try again.')
        } else {
          queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
            if (!oldData) return oldData
            return oldData.map((conv) =>
              conv.id === boardId ? { ...conv, metadata: updatedMetadata } : conv
            )
          })
          setExpandedBoardIds((prev) => new Set(prev).add(targetParentId)) // Show newly nested child
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          queryClient.invalidateQueries({ queryKey: ['edit-panel-title'] }) // Refresh top-bar path
          queryClient.invalidateQueries({ queryKey: ['path-board-menu'] }) // Refresh path sibling menus
          await refetch()
        }
      } catch (error: any) {
        console.error('Error nesting board:', error)
        alert('Failed to nest board. Please try again.')
      }
      return
    }

    // Check if dropping on a board in the main list (to remove from project) - only if not adding to project
    // Only boards in the main list (without projects) are valid drop targets, NOT the header
    // Compute boards without projects inline to ensure we have the latest data
    const boardsWithoutProjects = conversations.filter((conv) => {
      const projectId = conv.metadata?.project_id
      return !(projectId && typeof projectId === 'string' && projectId.trim() !== '')
    })
    const isDroppingOnBoardInMainList = overId && boardsWithoutProjects.some(c => c.id === overId)

    console.log('🔍 Checking board drop in main list:', {
      projectId,
      overId,
      isDroppingOnBoardInMainList,
      activeBoardHasProject,
      boardId,
      willRemove: !projectId && isDroppingOnBoardInMainList && activeBoardHasProject,
      totalBoards: conversations.length,
      boardsWithoutProjectsCount: boardsWithoutProjects.length
    })

    if (!projectId && isDroppingOnBoardInMainList && activeBoardHasProject) {
      console.log('✅ Dropping board on board in main list, removing from project:', {
        boardId,
        overId,
        isDroppingOnBoardInMainList,
        activeBoardHasProject
      })

      try {
        const { data: conversation, error: fetchError } = await supabase
          .from('conversations')
          .select('metadata')
          .eq('id', boardId)
          .eq('user_id', user.id)
          .single()

        if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

        const existingMetadata = (conversation?.metadata as Record<string, any>) || {}
        const { project_id: _, ...updatedMetadata } = existingMetadata
        const finalMetadata = Object.keys(updatedMetadata).length > 0 ? updatedMetadata : {}

        const { error } = await supabase
          .from('conversations')
          .update({ metadata: finalMetadata })
          .eq('id', boardId)
          .eq('user_id', user.id)

        if (error) {
          console.error('❌ Error removing board from project:', error)
          alert('Failed to move board back to boards list. Please try again.')
        } else {
          // Optimistic update
          queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
            if (!oldData) return oldData
            return oldData.map((conv) =>
              conv.id === boardId ? { ...conv, metadata: finalMetadata } : conv
            )
          })

          // Refetch
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          await refetch()
        }
      } catch (error: any) {
        console.error('Error removing board from project:', error)
        alert('Failed to move board back to boards list. Please try again.')
      }
      return
    }

    // Sibling reorder / re-parent: drop above or below another board
    if (
      over &&
      active.id !== over.id &&
      overId &&
      !overId.startsWith('project-') &&
      (dragOverPositionValue === 'above' || dragOverPositionValue === 'below')
    ) {
      const overBoard = conversations.find((c) => c.id === overId)
      if (overBoard) {
        const newParentId = getBoardParentId(overBoard) // Match sibling's parent (null = root)
        const currentParentId = activeBoard ? getBoardParentId(activeBoard) : null
        const parentChanged = newParentId !== currentParentId

        if (parentChanged) {
          if (newParentId && wouldCreateNestCycle(conversations, boardId, newParentId)) {
            return
          }
          try {
            const { data: conversation, error: fetchError } = await supabase
              .from('conversations')
              .select('metadata')
              .eq('id', boardId)
              .eq('user_id', user.id)
              .single()
            if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

            const existingMetadata = (conversation?.metadata as Record<string, any>) || {}
            const nextMetadata = { ...existingMetadata }
            if (newParentId) {
              nextMetadata.parent_id = newParentId
            } else {
              delete nextMetadata.parent_id // Move to root
            }

            const { error } = await supabase
              .from('conversations')
              .update({ metadata: nextMetadata })
              .eq('id', boardId)
              .eq('user_id', user.id)

            if (error) {
              console.error('Error updating board parent:', error)
            } else {
              queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
                if (!oldData) return oldData
                return oldData.map((conv) =>
                  conv.id === boardId ? { ...conv, metadata: nextMetadata } : conv
                )
              })
              if (newParentId) setExpandedBoardIds((prev) => new Set(prev).add(newParentId))
              queryClient.invalidateQueries({ queryKey: ['conversations'] })
              queryClient.invalidateQueries({ queryKey: ['edit-panel-title'] })
              queryClient.invalidateQueries({ queryKey: ['path-board-menu'] })
            }
          } catch (error) {
            console.error('Error updating board parent:', error)
          }
        }
      }
    }

    // Normal board reordering (dropping on another board) - only if we have a valid over target
    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = filteredConversations.findIndex((conv) => conv.id === active.id)
    const newIndex = filteredConversations.findIndex((conv) => conv.id === over.id)

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return
    }

    // Reorder conversations
    const reorderedConversations = arrayMove(filteredConversations, oldIndex, newIndex)

    // Optimistic cache update
    queryClient.setQueryData(['conversations'], (oldData: Conversation[] | undefined) => {
      if (!oldData) return reorderedConversations

      const fullOldIndex = oldData.findIndex((conv) => conv.id === active.id)
      const fullNewIndex = oldData.findIndex((conv) => conv.id === over.id)

      if (fullOldIndex === -1 || fullNewIndex === -1) {
        return oldData
      }

      const reorderedFull = arrayMove(oldData, fullOldIndex, fullNewIndex)

      return reorderedFull.map((conv, index) => ({
        ...conv,
        metadata: { ...conv.metadata, position: index },
      }))
    })

    // Update positions in database
    try {
      const { data: currentConversations } = await supabase
        .from('conversations')
        .select('id, metadata')
        .in('id', reorderedConversations.map((c) => c.id))
        .eq('user_id', user.id)

      const metadataMap = new Map(
        (currentConversations || []).map((c: any) => [c.id, c.metadata || {}])
      )

      for (let index = 0; index < reorderedConversations.length; index++) {
        const conv = reorderedConversations[index]
        const existingMetadata = metadataMap.get(conv.id) || {}

        await supabase
          .from('conversations')
          .update({
            metadata: { ...existingMetadata, position: index },
          })
          .eq('id', conv.id)
          .eq('user_id', user.id)
      }

      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (error) {
      console.error('Error saving board order:', error)
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  }

  // Handle drag over - show position indicator or project border
  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event

    console.log('🔄 handleDragOver:', { activeId: active.id, overId: over?.id })

    // Check if dragging over a board that belongs to a project (in project's board list)
    if (over && typeof over.id === 'string') {
      const overBoard = conversations.find(c => c.id === over.id)
      if (overBoard?.metadata?.project_id && typeof overBoard.metadata.project_id === 'string' && overBoard.metadata.project_id.trim() !== '') {
        // Dragging over a board in a project's list - set the project as drag over target
        const projectId = overBoard.metadata.project_id
        console.log('✅ Over board in project list:', { overId: over.id, projectId, boardTitle: overBoard.title })
        setDragOverProjectId(projectId)
        // Continue to normal board drag over handling to show indicator
      } else {
        // Dragging over a board in the main list (not in a project)
        console.log('✅ Over board in main list:', { overId: over.id })
        // Clear project drag over states when over a board in main list
        setDragOverProjectId(null)
      }
    }

    // Check if dragging over a project
    if (over && typeof over.id === 'string' && over.id.startsWith('project-')) {
      const projectId = over.id.replace('project-', '')
      console.log('🔄 handleDragOver: Over project', { projectId, overId: over.id })
      setDragOverProjectId(projectId)

      // Set drag over ID and position for drop indicator
      // This is critical - when indicator shows, dragOverId must be 'project-{id}'
      setDragOverId(over.id as string)

      // Get mouse position for relative positioning
      // Use the tracked mouse position from the document-level listener for accuracy
      const mouseY = currentMouseYRef.current ||
        (event as any).activatorEvent?.clientY ||
        (event as any).clientY ||
        null

      // Determine if dragging above or below based on mouse position
      const overElement = document.querySelector(`[data-id="${over.id}"]`) as HTMLElement
      if (overElement && mouseY !== null) {
        const rect = overElement.getBoundingClientRect()
        // Calculate the exact position within the element relative to cursor
        const elementTop = rect.top
        const elementHeight = rect.height
        const relativeY = mouseY - elementTop

        // Use center point for accurate alignment with cursor
        const elementCenter = elementHeight / 2
        const position = relativeY < elementCenter ? 'above' : 'below'
        console.log('🔄 handleDragOver: Setting position', { position, mouseY, relativeY, elementCenter, elementHeight })
        setDragOverPosition(position)
      } else {
        // Fallback: default to 'below' if we can't determine position
        console.log('🔄 handleDragOver: Using fallback position "below"')
        setDragOverPosition('below')
      }

      // Clear board drag over state when over project
      return
    }

    // Clear project drag over when not over a project
    setDragOverProjectId(null)

    // If we're at top/bottom, check if we should transition to relative positions
    // Allow transition when we're over an item but still in the transition zone
    if (dragOverPosition === 'top' || dragOverPosition === 'bottom') {
      // If we have an 'over' target, allow transition to relative positioning
      // This enables smooth transition from top/bottom to above/below indicators
      if (over && over.id !== active.id) {
        // Clear top/bottom to allow relative positioning
        setDragOverPosition(null)
        setDragOverId(null)
        // Continue processing to set relative position
      } else {
        // No over target, keep top/bottom
        return
      }
    }

    if (!over || active.id === over.id) {
      setDragOverId(null)
      setDragOverPosition(null)
      return
    }

    setDragOverId(over.id as string)

    // Get mouse position for relative positioning
    // Use the tracked mouse position from the document-level listener for accuracy
    const mouseY = currentMouseYRef.current ||
      (event as any).activatorEvent?.clientY ||
      (event as any).clientY ||
      null

    // Determine above / into / below based on mouse Y within the row (Notion-style nest zone)
    const overElement = document.querySelector(`[data-id="${over.id}"]`) as HTMLElement
    if (overElement && mouseY !== null) {
      const rect = overElement.getBoundingClientRect()
      // Calculate the exact position within the element relative to cursor
      const elementTop = rect.top
      const elementHeight = rect.height
      const relativeY = mouseY - elementTop
      const ratio = relativeY / Math.max(elementHeight, 1)

      // Edge bands reorder; center band nests under the target page
      if (typeof over.id === 'string' && !over.id.startsWith('project-')) {
        if (ratio < 0.22) setDragOverPosition('above')
        else if (ratio > 0.78) setDragOverPosition('below')
        else setDragOverPosition('into')
      } else {
        const elementCenter = elementHeight / 2
        setDragOverPosition(relativeY < elementCenter ? 'above' : 'below')
      }
    } else {
      // Fallback: default to 'below' if we can't determine position
      setDragOverPosition('below')
    }
  }

  // Fetch conversations/boards
  const { data: conversations = [], refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchOnWindowFocus: true,
  })

  // Fetch projects
  const { data: projects = [], refetch: refetchProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    refetchOnWindowFocus: true,
  })


  // Set up Supabase Realtime subscription for conversation updates (most reliable)
  useEffect(() => {
    const channel = supabase
      .channel('conversations-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔄 Sidebar: Conversation updated via Realtime:', payload.new?.title)
          // Immediately invalidate and refetch
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          refetch()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔄 Sidebar: New conversation created via Realtime:', payload.new?.title)
          // Immediately invalidate and refetch
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
          refetch()
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user.id, refetch, queryClient, supabase])

  // Set up Supabase Realtime subscription for project updates
  useEffect(() => {
    const channel = supabase
      .channel('projects-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔄 Sidebar: Project updated via Realtime:', payload.new?.name)
          // Immediately invalidate and refetch
          queryClient.invalidateQueries({ queryKey: ['projects'] })
          refetchProjects()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔄 Sidebar: New project created via Realtime:', payload.new?.name)
          // Immediately invalidate and refetch
          queryClient.invalidateQueries({ queryKey: ['projects'] })
          refetchProjects()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          console.log('🔄 Sidebar: Project deleted via Realtime')
          // Immediately invalidate and refetch
          queryClient.invalidateQueries({ queryKey: ['projects'] })
          refetchProjects()
        }
      )
      .subscribe((status) => {
        console.log('📡 Projects Realtime subscription status:', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user.id, refetchProjects, queryClient, supabase])


  // Listen for conversation creation/update events to refetch (fallback)
  useEffect(() => {
    const handleConversationCreated = (e: Event) => {
      const customEvent = e as CustomEvent<{ conversationId: string }>
      console.log('🔄 Sidebar: conversation-created event received', customEvent.detail?.conversationId)
      console.log('🔄 Sidebar: Invalidating and refetching conversations')
      // Immediately invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      refetch()
      // Multiple attempts to ensure we get the latest data
      setTimeout(() => {
        console.log('🔄 Sidebar: First refetch attempt (200ms)')
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        refetch().then((result) => {
          console.log('🔄 Sidebar: First refetch result:', result.data?.length, 'conversations')
        })
      }, 200)
      setTimeout(() => {
        console.log('🔄 Sidebar: Second refetch attempt (400ms)')
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        refetch().then((result) => {
          console.log('🔄 Sidebar: Second refetch result:', result.data?.length, 'conversations')
        })
      }, 400)
    }
    const handleConversationUpdated = () => {
      console.log('🔄 Sidebar: conversation-updated event received - refetching immediately')
      // Immediately invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      refetch()
      // Additional refetch after short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        refetch()
      }, 100)
    }
    window.addEventListener('conversation-created', handleConversationCreated)
    window.addEventListener('conversation-updated', handleConversationUpdated)
    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated)
      window.removeEventListener('conversation-updated', handleConversationUpdated)
    }
  }, [refetch, queryClient])

  const handleDeleteAccount = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch('/api/auth/delete-account', {
        method: 'POST',
      })
      const data = await response.json()

      console.log('Delete account response:', { status: response.status, data })

      if (!response.ok || data.error) {
        // If user was signed out, redirect to home
        if (data.signedOut) {
          alert(data.error || 'Account deletion failed. You have been signed out.')
          router.push('/')
          return
        }
        throw new Error(data.error || 'Failed to delete account')
      }

      // Success - sign out and redirect to home
      console.log('✅ Account deleted successfully')
      await supabase.auth.signOut()
      router.push('/')
    } catch (error: any) {
      console.error('Failed to delete account:', error)
      alert(error.message || 'Failed to delete account. Please try again.')
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const [searchQuery, setSearchQuery] = useState('')

  // Filter conversations based on search query
  // Separate conversations into those with projects and those without
  // Check for project_id in metadata - must be truthy and not empty string
  const conversationsWithProjects = conversations.filter((conversation) => {
    const projectId = conversation.metadata?.project_id
    const hasProject = projectId && typeof projectId === 'string' && projectId.trim() !== ''
    return hasProject
  })
  const conversationsWithoutProjects = conversations.filter((conversation) => {
    const projectId = conversation.metadata?.project_id
    const hasProject = projectId && typeof projectId === 'string' && projectId.trim() !== ''
    return !hasProject
  })

  // Filter out archived boards from main list
  const filteredConversations = conversationsWithoutProjects.filter((conversation) => {
    const isArchived = conversation.metadata?.archived === true
    const matchesSearch = conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
    return !isArchived && matchesSearch
  })

  // Depth-aware flat list for nested sub-page rendering in the Boards menu
  // When searching, expand all so nested matches remain visible
  const nestedBoardRows = useMemo(() => {
    const expandAll = searchQuery.trim().length > 0
    const expanded = expandAll
      ? new Set(filteredConversations.map((c) => c.id))
      : expandedBoardIds
    return flattenBoardTree(filteredConversations, expanded)
  }, [filteredConversations, expandedBoardIds, searchQuery])

  // Toggle expand/collapse for a board's nested children
  const toggleBoardExpand = (id: string) => {
    setExpandedBoardIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Keep ancestors + the open page expanded so nested children (e.g. Notion imports) stay visible
  useEffect(() => {
    const match = pathname.match(/^\/board\/([^/]+)/)
    const openId = match?.[1]
    if (!openId || filteredConversations.length === 0) return
    const byId = new Map(filteredConversations.map((c) => [c.id, c]))
    const toExpand: string[] = [openId] // Expand current page to reveal its children
    let current = byId.get(openId)
    let parentId = current ? getBoardParentId(current) : null
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      toExpand.push(parentId)
      current = byId.get(parentId)
      parentId = current ? getBoardParentId(current) : null
    }
    setExpandedBoardIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of toExpand) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pathname, filteredConversations])

  // Create a stable memoized string key of project IDs that have boards
  const projectsWithBoardsKey = useMemo(() => {
    const projectIds: string[] = []
    conversationsWithProjects.forEach((conv) => {
      const projectId = conv.metadata?.project_id
      if (projectId) {
        projectIds.push(projectId)
      }
    })
    return projectIds.sort().join(',')
  }, [conversationsWithProjects.map(c => `${c.id}:${c.metadata?.project_id || ''}`).join('|')])

  // Auto-expand projects that have boards (only when the set of projects with boards changes)
  useEffect(() => {
    if (projectsWithBoardsKey && projects.length > 0) {
      const projectIds = projectsWithBoardsKey.split(',').filter(Boolean)

      setExpandedProjects((prev) => {
        // Check if we need to update (if any project with boards is not expanded)
        let needsUpdate = false
        projectIds.forEach((projectId) => {
          if (!prev.has(projectId)) {
            needsUpdate = true
          }
        })

        // Only create new Set if update is needed
        if (!needsUpdate) {
          return prev
        }

        const next = new Set(prev)
        projectIds.forEach((projectId) => {
          next.add(projectId)
        })
        return next
      })
    }
  }, [projectsWithBoardsKey, projects.length])

  // Header + mints a root New board; a row’s Add board inside (+) mints a nested child under that row
  const handleCreateBoard = async (parent?: Conversation) => {
    if (isCreatingBoard) return // Ignore double-clicks while the insert is in flight
    setIsCreatingBoard(true) // Disable + and New board until this mint finishes
    try {
      const parentId = parent?.id // Nested when called from a row more menu
      const rawProjectId = parent?.metadata?.project_id // Inherit project so the child stays in that list
      const projectId =
        typeof rawProjectId === 'string' && rawProjectId.trim() !== '' ? rawProjectId : undefined
      const boardId = await createUntitledBoard(supabase, {
        userId: user.id, // RLS owner
        parentId, // undefined → root board from +
        projectId, // undefined when the parent is not in a project
      })
      if (!boardId) {
        alert('Failed to create board. Please try again.') // Insert failed — stay on this board
        return
      }
      const now = new Date().toISOString() // Optimistic timestamps until refetch
      const metadata: Conversation['metadata'] = parentId
        ? { parent_id: parentId, ...(projectId ? { project_id: projectId } : {}) } // Nested nav row
        : { position: -1 } // Root row pins to the top
      queryClient.setQueryData(['conversations'], (old: Conversation[] | undefined) => {
        const row: Conversation = {
          id: boardId,
          title: DEFAULT_BOARD_TITLE, // Match the inserted conversations.title so the row doesn’t flash Untitled
          created_at: now,
          updated_at: now,
          ...(parentId ? {} : { position: -1 }), // Match list sort for root boards
          metadata,
        }
        return old ? [row, ...old] : [row] // Show immediately in the boards list
      })
      if (parentId) {
        setExpandedBoardIds((prev) => new Set(prev).add(parentId)) // Reveal the new child under its parent
      }
      setIsBoardsExpanded(true) // Ensure the Boards section is open
      queryClient.invalidateQueries({ queryKey: ['conversations'] }) // Confirm from the server
      router.push(`/board/${boardId}`) // Open the empty board
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create board. Please try again.'
      console.error('Failed to create board:', error)
      alert(message)
    } finally {
      setIsCreatingBoard(false) // Re-enable + / New board
    }
  }

  // Handle create project
  const handleCreateProject = async () => {
    if (!projectName.trim()) return

    setIsCreatingProject(true)

    try {
      // Create project with position -1 to ensure it appears at the top
      const { data: newProject, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: projectName.trim(),
          metadata: { position: -1 }, // Set position to -1 to appear at top
        })
        .select()
        .single()

      if (error) {
        throw new Error(error.message || 'Failed to create project')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['projects'] })

      // Close dialog and reset form
      setShowCreateProjectDialog(false)
      setProjectName('')

      // Navigate to project page (for now, just navigate to /board - can be updated later)
      // router.push(`/project/${newProject.id}`)

      console.log('✅ Project created:', newProject)
    } catch (error: any) {
      console.error('Failed to create project:', error)
      alert(error.message || 'Failed to create project. Please try again.')
    } finally {
      setIsCreatingProject(false)
    }
  }

  // Handle delete conversation/board
  const handleDeleteConversation = async () => {
    if (!conversationToDelete) return

    setDeletingConversationId(conversationToDelete.id)
    setShowDeleteBoardDialog(false)

    try {
      // Before delete: demote any parent-map item that linked to this page (keeps card body, clears title)
      const parentMapId = await demoteBlockForDeletedBoard(supabase, conversationToDelete.id)
      if (parentMapId) {
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', parentMapId] })
      }

      // Delete conversation (cascade will delete all messages on this page’s map)
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationToDelete.id)
        .eq('user_id', user.id) // Ensure user owns this conversation

      if (error) {
        throw new Error(error.message || 'Failed to delete board')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationToDelete.id] })

      // If we're currently viewing this conversation, redirect to /board
      if (pathname === `/board/${conversationToDelete.id}`) {
        router.push('/board')
      }
    } catch (error: any) {
      console.error('Failed to delete conversation:', error)
      alert(error.message || 'Failed to delete board. Please try again.')
    } finally {
      setDeletingConversationId(null)
      setConversationToDelete(null)
    }
  }

  // Open delete dialog
  const openDeleteDialog = (conversation: Conversation) => {
    setConversationToDelete({ id: conversation.id, title: conversation.title })
    setShowDeleteBoardDialog(true)
  }

  // Open rename dialog
  const openRenameDialog = (conversation: Conversation) => {
    setConversationToRename({ id: conversation.id, title: conversation.title })
    setRenameInput(conversation.title)
    setShowRenameDialog(true)
  }


  // Handle rename conversation/board
  const handleRenameConversation = async () => {
    if (!conversationToRename || !renameInput.trim()) return

    setIsRenaming(true)

    try {
      const nextTitle = renameInput.trim() // Shared title for page + linked item

      // Merge metadata so we do not wipe parent_id / sourceBlockMessageId / icon
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationToRename.id)
        .single()
      const existingMeta = (existingConv?.metadata as Record<string, unknown>) || {}

      const { error } = await supabase
        .from('conversations')
        .update({
          title: nextTitle,
          metadata: { ...existingMeta, manuallyRenamed: true }, // Preserve nesting + item link
        })
        .eq('id', conversationToRename.id)
        .eq('user_id', user.id) // Ensure user owns this conversation

      if (error) {
        throw new Error(error.message || 'Failed to rename board')
      }

      // Mirror rename onto the parent-map item card when this page was promoted from an item
      const parentMapId = await syncBoardRenameToBlock(supabase, conversationToRename.id, nextTitle)
      if (parentMapId) {
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', parentMapId] })
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })

      // Trigger sidebar refresh
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('conversation-updated'))
      }

      // Also refetch immediately
      refetch()

      setShowRenameDialog(false)
      setConversationToRename(null)
      setRenameInput('')
    } catch (error: any) {
      console.error('Failed to rename conversation:', error)
      alert(error.message || 'Failed to rename board. Please try again.')
    } finally {
      setIsRenaming(false)
    }
  }

  // Handle delete project
  const handleDeleteProject = async () => {
    if (!projectToDelete) return

    setDeletingProjectId(projectToDelete.id)
    setShowDeleteProjectDialog(false)

    try {
      // Delete project (cascade will handle related data if configured)
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectToDelete.id)
        .eq('user_id', user.id) // Ensure user owns this project

      if (error) {
        throw new Error(error.message || 'Failed to delete project')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })

      // If we're currently viewing this project, redirect to /board
      if (pathname === `/project/${projectToDelete.id}`) {
        router.push('/board')
      }
    } catch (error: any) {
      console.error('Failed to delete project:', error)
      alert(error.message || 'Failed to delete project. Please try again.')
    } finally {
      setDeletingProjectId(null)
      setProjectToDelete(null)
    }
  }

  // Open delete project dialog
  const openDeleteProjectDialog = (project: Project) => {
    setProjectToDelete({ id: project.id, name: project.name })
    setShowDeleteProjectDialog(true)
  }

  // Open rename project dialog
  const openRenameProjectDialog = (project: Project) => {
    setProjectToRename({ id: project.id, name: project.name })
    setProjectRenameInput(project.name)
    setShowRenameProjectDialog(true)
  }

  // Handle rename project
  const handleRenameProject = async () => {
    if (!projectToRename || !projectRenameInput.trim()) return

    setIsRenamingProject(true)

    try {
      // Update project name
      const { error } = await supabase
        .from('projects')
        .update({
          name: projectRenameInput.trim(),
        })
        .eq('id', projectToRename.id)
        .eq('user_id', user.id) // Ensure user owns this project

      if (error) {
        throw new Error(error.message || 'Failed to rename project')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['projects'] })

      setShowRenameProjectDialog(false)
      setProjectToRename(null)
      setProjectRenameInput('')
    } catch (error: any) {
      console.error('Failed to rename project:', error)
      alert(error.message || 'Failed to rename project. Please try again.')
    } finally {
      setIsRenamingProject(false)
    }
  }

  // Nav popup visibility — dialogs/settings render outside the floating shell
  const showNavPopup = isSidebarOpen

  return (
    <>
      {/* Scrim below the top bar so the menu icon stays tappable (toggle close; no click-through reopen) */}
      {isSidebarOpen && isMobileMode && (
        <div
          className="fixed inset-x-0 bottom-0 bg-black/20 z-40 transition-opacity"
          style={{ top: NAV_POPUP_TOP }} // Leave the 52px top bar (hamburger) above the scrim
          onClick={closeSidebar}
        />
      )}

      {/* Rounded rectangular nav popup (former left sidebar) — top-left under logo */}
      {showNavPopup && (
      <div
        data-app-sidebar
        data-nav-menu-popup
        className={cn(
          'fixed z-50 flex flex-col bg-white dark:bg-[#171717] border border-gray-200 dark:border-[#2f2f2f] shadow-xl rounded-2xl overflow-hidden',
          'w-72 min-h-0' // min-h-0 so the board list can shrink and scroll under maxHeight
        )}
        style={{
          top: NAV_POPUP_TOP, // Flush under top bar so hover can bridge from logo
          left: '0.5rem',
          maxHeight: navPopupMaxHeight, // Stops above Free nav / open minimap (measured)
        }}
        onMouseEnter={() => {
          cancelCloseSidebar() // Keep open while pointer is in menu
          openSidebar()
        }}
        onMouseLeave={(e) => {
          if (isMobileMode) return // Mobile uses click + scrim
          // Portaled menus/dialogs: relatedTarget is often null — keep open while they exist
          if (document.querySelector('[data-radix-popper-content-wrapper], [role="menu"], [data-radix-dialog-content]')) {
            cancelCloseSidebar()
            return
          }
          const related = e.relatedTarget as HTMLElement | null
          if (related?.closest?.('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"]')) {
            return
          }
          scheduleCloseSidebar()
        }}
      >
        {/* Search + mint a root Untitled board (no New project / New board dropdown) */}
        {!isCollapsed ? (
          <div className="px-4 pt-2 pb-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-1 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search anything..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 h-8 text-sm rounded-lg border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  suppressHydrationWarning
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-800 group"
                title="Create board"
                disabled={isCreatingBoard} // Prevent duplicate mints
                onClick={() => handleCreateBoard()} // Root Untitled board, then open it
              >
                {isCreatingBoard ? (
                  <Loader2 className="h-5 w-5 text-gray-500 animate-spin" /> // In-flight mint
                ) : (
                  <Plus className="h-5 w-5 text-gray-500 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          // Collapsed: same mint, centered to match expanded vertical position
          <div className="px-4 pt-2 pb-4 flex justify-center">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-transparent border-0 hover:bg-gray-100 group"
              title="Create board"
              disabled={isCreatingBoard} // Prevent duplicate mints
              onClick={() => handleCreateBoard()} // Root Untitled board, then open it
            >
              {isCreatingBoard ? (
                <Loader2 className="h-5 w-5 text-gray-500 animate-spin" /> // In-flight mint
              ) : (
                <Plus className="h-5 w-5 text-gray-500 group-hover:text-gray-900 transition-colors" />
              )}
            </Button>
          </div>
        )}

        {/* Boards/Conversations List - hidden when collapsed */}
        {!isCollapsed && (
          <nav className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-400/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-400/70 dark:[&::-webkit-scrollbar-thumb]:bg-gray-500/50 dark:[&::-webkit-scrollbar-thumb]:hover:bg-gray-500/70 [&::-webkit-scrollbar]:bg-transparent">
            <DndContext
              sensors={sensors}
              collisionDetection={(args) => {
                // First try pointer-based collision for accurate cursor tracking
                const pointerCollisions = pointerWithin(args)
                if (pointerCollisions.length > 0) {
                  return pointerCollisions
                }
                // Fallback to rectangle intersection for sortable items
                return rectIntersection(args)
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
            >
              {/* Projects Header - only show if projects exist */}
              {projects.length > 0 && (
                <>
                  <div
                    className="flex items-center gap-1 pl-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer group transition-colors rounded-lg min-h-[32px]"
                    onClick={() => setIsProjectsExpanded(!isProjectsExpanded)}
                  >
                    <span>Projects</span>
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 opacity-0 group-hover:opacity-100 transition-all duration-200',
                        !isProjectsExpanded && 'group-hover:-rotate-90'
                      )}
                    />
                  </div>

                  {/* Projects List - collapsible */}
                  {isProjectsExpanded && (
                    <SortableContext
                      items={conversationsWithProjects.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="space-y-0">
                        {projects.map((project) => {
                          const isActive = pathname === `/project/${project.id}`
                          const isDragOver = dragOverProjectId === project.id
                          const isExpanded = expandedProjects.has(project.id)
                          // Get boards for this project, filtered by search query
                          const projectBoards = conversationsWithProjects
                            .filter((conv) => conv.metadata?.project_id === project.id)
                            .filter((conversation) =>
                              conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                          return (
                            <DroppableProjectItem
                              key={project.id}
                              project={project}
                              isActive={isActive}
                              isDragOver={isDragOver}
                              isExpanded={isExpanded}
                              onToggleExpand={() => {
                                setExpandedProjects((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(project.id)) {
                                    next.delete(project.id)
                                  } else {
                                    next.add(project.id)
                                  }
                                  return next
                                })
                              }}
                              projectBoards={projectBoards}
                              pathname={pathname}
                              deletingConversationId={deletingConversationId}
                              isRenaming={isRenaming}
                              openRenameDialog={openRenameDialog}
                              openDeleteDialog={openDeleteDialog}
                              openRenameProjectDialog={openRenameProjectDialog}
                              openDeleteProjectDialog={openDeleteProjectDialog}
                              deletingProjectId={deletingProjectId}
                              isRenamingProject={isRenamingProject}
                              dragOverId={dragOverId}
                              dragOverPosition={dragOverPosition}
                              activeId={activeId}
                              filteredConversations={filteredConversations}
                              projects={projects}
                              supabase={supabase}
                              queryClient={queryClient}
                              refetch={refetch}
                              userId={user.id}
                              onCreateSubBoard={handleCreateBoard} // Nested Untitled board under a project board
                              isCreatingBoard={isCreatingBoard} // Disable New board while a mint is in flight
                            />
                          )
                        })}
                      </ul>
                    </SortableContext>
                  )}
                </>
              )}

              {/* Boards Header - NOT droppable, just a header */}
              <BoardsSectionHeader
                isExpanded={isBoardsExpanded}
                onToggleExpand={() => setIsBoardsExpanded(!isBoardsExpanded)}
              />

              {/* Boards List - collapsible, boards are sortable/reorderable / nestable */}
              {isBoardsExpanded && (
                <BoardsListWrapper>
                  {nestedBoardRows.length > 0 ? (
                    <SortableContext
                      items={nestedBoardRows.map((r) => r.conversation.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="space-y-1">
                        {nestedBoardRows.map(({ conversation, depth, hasChildren }) => {
                          const isActive = pathname === `/board/${conversation.id}`
                          const isDeleting = deletingConversationId === conversation.id
                          return (
                            <SortableBoardItem
                              key={conversation.id}
                              conversation={conversation}
                              isActive={isActive}
                              isDeleting={isDeleting}
                              deletingConversationId={deletingConversationId}
                              isRenaming={isRenaming}
                              pathname={pathname}
                              openRenameDialog={openRenameDialog}
                              openDeleteDialog={openDeleteDialog}
                              dragOverId={dragOverId}
                              dragOverPosition={dragOverPosition}
                              activeId={activeId}
                              filteredConversations={filteredConversations}
                              projects={projects}
                              supabase={supabase}
                              queryClient={queryClient}
                              refetch={refetch}
                              depth={depth}
                              hasChildren={hasChildren}
                              isExpanded={expandedBoardIds.has(conversation.id)}
                              onToggleExpand={toggleBoardExpand}
                              onCreateSubBoard={handleCreateBoard} // Nested Untitled board under this row
                              isCreatingBoard={isCreatingBoard} // Disable New board while a mint is in flight
                              userId={user.id}
                            />
                          )
                        })}
                      </ul>
                    </SortableContext>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">
                      {searchQuery ? 'No boards found' : 'No boards yet. Start a chat!'}
                    </div>
                  )}
                </BoardsListWrapper>
              )}

              <DragOverlay>
                {activeId ? (
                  <div className="flex items-center gap-2 px-4 h-8 rounded-lg bg-blue-50 dark:bg-[#2a2a3a] text-sm shadow-lg opacity-90 cursor-grabbing">
                    <span className="truncate flex-1 text-gray-700 dark:text-gray-300">
                      {filteredConversations.find((c) => c.id === activeId)?.title || ''}
                    </span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </nav>
        )}

        {/* Create Project Dialog */}
        <Dialog open={showCreateProjectDialog} onOpenChange={setShowCreateProjectDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="project-name" className="text-sm font-medium">
                  Project name
                </label>
                <Input
                  id="project-name"
                  placeholder="Enter project name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && projectName.trim()) {
                      handleCreateProject()
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateProjectDialog(false)
                  setProjectName('')
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={!projectName.trim() || isCreatingProject}
              >
                {isCreatingProject ? 'Creating...' : 'Create project'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Profile Section - fixed at bottom */}
        <div className="relative h-16 flex-shrink-0 mt-auto flex items-center">
          {/* Divider - same width as divider below logo, fades out on collapse */}
          <div className={cn(
            "absolute top-0 left-4 right-4 h-px bg-gray-200 dark:bg-[#2f2f2f] transition-opacity duration-300",
            isCollapsed ? "opacity-0" : "opacity-100"
          )} />

          {/* Profile content - centered vertically */}
          <div className={cn(
            "w-full",
            isCollapsed ? "flex items-center justify-center" : "px-4"
          )}>
            {isCollapsed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-8 h-8 rounded-full bg-blue-100 dark:bg-[#2a2a3a] flex items-center justify-center hover:bg-blue-200 dark:hover:bg-[#353545] transition-colors"
                    title="Profile"
                  >
                    <span className="text-gray-700 dark:text-gray-300 font-semibold text-sm">
                      {user.email?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => {
                    setSettingsOpen(true)
                    closeSidebar()
                  }}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="w-full relative">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="w-full flex items-center gap-3 pl-1 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1f1f1f] transition-colors">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-[#2a2a3a] rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-gray-700 dark:text-gray-300 font-semibold text-sm">
                          {user.email?.charAt(0).toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {profile?.full_name || user.email?.split('@')[0] || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {profile?.subscription_tier === 'pro' ? 'Plus' : profile?.subscription_tier === 'enterprise' ? 'Enterprise' : 'Free'}
                        </p>
                      </div>
                      {/* Spacer for Upgrade / Help button beside profile */}
                      <div className="w-[70px] flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem 
                    onClick={() => {
                      setSettingsOpen(true)
                      closeSidebar()
                    }}
                    className="px-2 py-1.5 focus:bg-transparent"
                  >
                    <div className="w-full flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-[#2a2a3a] rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-gray-700 dark:text-gray-300 font-semibold text-sm">
                          {user.email?.charAt(0).toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {profile?.full_name || user.email?.split('@')[0] || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {user.email || 'user@example.com'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-2" />
                  {profile?.subscription_tier !== 'pro' && profile?.subscription_tier !== 'enterprise' && (
                    <DropdownMenuItem
                      onClick={() => {
                        setUpgradeOpen(true)
                        closeSidebar()
                      }}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Upgrade plan
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => {
                    setSettingsOpen(true)
                    closeSidebar()
                  }}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-2" />
                  {/* Help lives on the profile button when upgraded; keep it in the menu for free users */}
                  {profile?.subscription_tier !== 'pro' && profile?.subscription_tier !== 'enterprise' && (
                    <DropdownMenuItem>
                      <HelpCircle className="h-4 w-4 mr-2" />
                      Help
                      <ChevronRightIcon className="h-4 w-4 ml-auto" />
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </DropdownMenu>
                {/* Free: Upgrade button; upgraded: Help in the same spot */}
                {profile?.subscription_tier !== 'pro' && profile?.subscription_tier !== 'enterprise' ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 h-auto text-xs font-medium bg-white dark:bg-white text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#1f1f1f] rounded-md transition-colors flex-shrink-0 z-10"
                    onClick={(e) => {
                      e.stopPropagation() // Prevent event from bubbling
                      e.preventDefault() // Prevent default behavior
                      setUpgradeOpen(true) // Open upgrade panel
                      closeSidebar()
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation() // Prevent mousedown from triggering dropdown
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation() // Prevent pointerdown from triggering dropdown
                    }}
                  >
                    Upgrade
                  </button>
                ) : (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 h-auto text-xs font-medium bg-white dark:bg-white text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#1f1f1f] rounded-md transition-colors flex-shrink-0 z-10"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      closeSidebar()
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                    }}
                  >
                    Help
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
      )}

        {/* Settings Panel */}
        <SettingsPanel
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false)
            setShowDeleteConfirm(false)
          }}
          user={user}
          onDeleteAccount={handleDeleteAccount}
          isDeleting={isDeleting}
          showDeleteConfirm={showDeleteConfirm}
          onShowDeleteConfirm={setShowDeleteConfirm}
        />

        {/* Upgrade Panel */}
        <UpgradePanel
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          user={user}
        />

        {/* Rename Board Dialog */}
        <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Rename board</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                Enter a new name for this board.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4">
              <Input
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameInput.trim() && !isRenaming) {
                    handleRenameConversation()
                  }
                }}
                placeholder="Board name"
                className="w-full"
                autoFocus
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRenameDialog(false)
                  setConversationToRename(null)
                  setRenameInput('')
                }}
                className="px-4 py-2"
                disabled={isRenaming}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRenameConversation}
                disabled={!renameInput.trim() || isRenaming}
                className="px-4 py-2"
              >
                {isRenaming ? 'Renaming...' : 'Rename'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Board Confirmation Dialog */}
        <Dialog open={showDeleteBoardDialog} onOpenChange={setShowDeleteBoardDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Delete board?</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                This will delete <span className="font-semibold text-gray-900">{conversationToDelete?.title}</span>.
              </DialogDescription>
              <DialogDescription className="text-sm text-gray-500 pt-1">
                All messages in this board will be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteBoardDialog(false)
                  setConversationToDelete(null)
                }}
                className="px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConversation}
                disabled={deletingConversationId !== null}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white"
              >
                {deletingConversationId ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Project Dialog */}
        <Dialog open={showRenameProjectDialog} onOpenChange={setShowRenameProjectDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Rename project</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                Enter a new name for this project.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4">
              <Input
                value={projectRenameInput}
                onChange={(e) => setProjectRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectRenameInput.trim() && !isRenamingProject) {
                    handleRenameProject()
                  }
                }}
                placeholder="Project name"
                className="w-full"
                autoFocus
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRenameProjectDialog(false)
                  setProjectToRename(null)
                  setProjectRenameInput('')
                }}
                className="px-4 py-2"
                disabled={isRenamingProject}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRenameProject}
                disabled={!projectRenameInput.trim() || isRenamingProject}
                className="px-4 py-2"
              >
                {isRenamingProject ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Renaming...
                  </>
                ) : (
                  'Rename'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Project Dialog */}
        <Dialog open={showDeleteProjectDialog} onOpenChange={setShowDeleteProjectDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Delete project?</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                This will delete <span className="font-semibold text-gray-900">{projectToDelete?.name}</span>.
              </DialogDescription>
              <DialogDescription className="text-sm text-gray-500 pt-1">
                The project will be permanently deleted. Boards in this project will not be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteProjectDialog(false)
                  setProjectToDelete(null)
                }}
                className="px-4 py-2"
                disabled={deletingProjectId !== null}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteProject}
                disabled={deletingProjectId !== null}
                variant="destructive"
                className="px-4 py-2"
              >
                {deletingProjectId ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

    </>
  )
}

