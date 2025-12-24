'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Search, MoreVertical, MoreHorizontal, Trash2, ChevronLeft, ChevronRight, SquarePen, Pencil, ChevronDown, FolderPlus, File, Folder, FolderOpen, Loader2, Share2, UserPlus, Archive, CornerUpLeft } from 'lucide-react'
import { SettingsPanel } from '@/components/settings-panel'
import { cn } from '@/lib/utils'
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
  dragOverPosition: 'above' | 'below' | 'top' | 'bottom' | null
  activeId: string | null
  filteredConversations: Conversation[]
  projects: Project[]
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
  refetch: () => void
  project?: Project // Optional project if this board is under a project
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
          'flex items-center gap-2 px-4 h-8 rounded-lg transition-colors text-sm group cursor-grab active:cursor-grabbing',
          isActive
            ? 'bg-blue-50 dark:bg-[#2a2a3a]'
            : 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]', // CSS hover requires window focus (as intended)
          isDragging && 'cursor-grabbing opacity-50'
        )}
      >
        <Link
          href={`/board/${conversation.id}`}
          className="flex items-center gap-2 flex-1 min-w-0 text-gray-700 dark:text-gray-300"
          onClick={(e) => {
            // Prevent navigation when dragging
            if (isDragging) {
              e.preventDefault()
            }
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

        {/* Dropdown menu button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-6 transition-opacity hover:bg-transparent',
                'opacity-0 group-hover:opacity-100', // CSS group-hover requires window focus (as intended)
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
              onClick={async (e) => {
                e.stopPropagation()
                // Archive functionality - TODO: Implement archive (add archived flag to metadata)
                try {
                  const { data: conversationData, error: fetchError } = await supabase
                    .from('conversations')
                    .select('metadata')
                    .eq('id', conversation.id)
                    .single()

                  if (fetchError) throw new Error(fetchError.message || 'Failed to fetch conversation')

                  const existingMetadata = (conversationData?.metadata as Record<string, any>) || {}
                  const updatedMetadata = { ...existingMetadata, archived: true }

                  const { error } = await supabase
                    .from('conversations')
                    .update({ metadata: updatedMetadata })
                    .eq('id', conversation.id)

                  if (error) {
                    console.error('Error archiving board:', error)
                    alert('Failed to archive board. Please try again.')
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
                  console.error('Error archiving board:', error)
                  alert('Failed to archive board. Please try again.')
                }
              }}
            >
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </DropdownMenuItem>
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
  dragOverPosition: 'above' | 'below' | 'top' | 'bottom' | null
  activeId: string | null
  filteredConversations: Conversation[]
  projects: Project[]
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
  refetch: () => void
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

// Study set item component - similar to board item but for study sets
function StudySetItem({
  studySet,
  isActive,
  pathname,
  openRenameDialog,
  openDeleteDialog,
  isRenaming,
  deletingStudySetId,
  supabase,
  queryClient,
}: {
  studySet: { id: string; name: string }
  isActive: boolean
  pathname: string
  openRenameDialog: (studySet: { id: string; name: string }) => void
  openDeleteDialog: (studySet: { id: string; name: string }) => void
  isRenaming: boolean
  deletingStudySetId: string | null
  supabase: ReturnType<typeof createClient>
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-2 px-4 h-8 rounded-lg transition-colors text-sm group',
          isActive
            ? 'bg-blue-50 dark:bg-[#2a2a3a]'
            : 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]'
        )}
      >
        <Link
          href={`/study-set/${studySet.id}`}
          className="flex items-center gap-2 flex-1 min-w-0 text-gray-700 dark:text-gray-300"
        >
          <span className="truncate flex-1">{studySet.name}</span>
        </Link>

        {/* Dropdown menu button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-6 transition-opacity hover:bg-transparent',
                'opacity-0 group-hover:opacity-100', // CSS group-hover requires window focus (as intended)
                isActive
                  ? 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-900'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200'
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
                // Share functionality - copy study set URL to clipboard
                const studySetUrl = `${window.location.origin}/study-set/${studySet.id}`
                navigator.clipboard.writeText(studySetUrl)
                // TODO: Show toast notification
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openRenameDialog(studySet)
              }}
              disabled={isRenaming}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 my-1" />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                openDeleteDialog(studySet)
              }}
              disabled={deletingStudySetId === studySet.id}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deletingStudySetId === studySet.id ? 'Deleting...' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
    position?: number
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

// Fetch study sets from user metadata
async function fetchStudySets(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('metadata')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Error fetching study sets:', error)
      return []
    }

    const studySets = (profile?.metadata as Record<string, any>)?.studySets || []
    console.log('📚 Fetched study sets:', studySets.length, 'sets:', studySets.map((s: any) => s.name))
    return Array.isArray(studySets) ? studySets : []
  } catch (error) {
    console.error('Error fetching study sets:', error)
    return []
  }
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

export default function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false) // Sidebar collapse state
  const [showDeleteBoardDialog, setShowDeleteBoardDialog] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState<{ id: string; title: string } | null>(null)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [conversationToRename, setConversationToRename] = useState<{ id: string; title: string } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isBoardsExpanded, setIsBoardsExpanded] = useState(true) // Boards section expanded/collapsed state
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false) // Archive section expanded/collapsed state (collapsed by default)
  const [isStudySetsExpanded, setIsStudySetsExpanded] = useState(true) // Study Sets section expanded/collapsed state
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true) // Projects section expanded/collapsed state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set()) // Track which individual projects are expanded
  const [activeId, setActiveId] = useState<string | null>(null) // Currently dragging board ID
  const [dragOverId, setDragOverId] = useState<string | null>(null) // Board being dragged over
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below' | 'top' | 'bottom' | null>(null) // Position indicator
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null) // Project being dragged over (for board-to-project drops)
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
  const [showDeleteStudySetDialog, setShowDeleteStudySetDialog] = useState(false) // Delete study set dialog state
  const [studySetToDelete, setStudySetToDelete] = useState<{ id: string; name: string } | null>(null) // Study set to delete
  const [deletingStudySetId, setDeletingStudySetId] = useState<string | null>(null) // Currently deleting study set ID
  const [showRenameStudySetDialog, setShowRenameStudySetDialog] = useState(false) // Rename study set dialog state
  const [studySetToRename, setStudySetToRename] = useState<{ id: string; name: string } | null>(null) // Study set to rename
  const [studySetRenameInput, setStudySetRenameInput] = useState('') // Study set rename input
  const [isRenamingStudySet, setIsRenamingStudySet] = useState(false) // Renaming study set state
  const mouseMoveCleanupRef = useRef<(() => void) | null>(null) // Cleanup function for mouse move listener
  const currentMouseYRef = useRef<number | null>(null) // Track current mouse Y position for accurate indicator placement
  const projectsExpandedInitializedRef = useRef(false) // Track if we've initialized project expansion
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { isMobileMode, isSidebarOpen, closeSidebar } = useSidebarContext()

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
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // 250ms delay for touch
        tolerance: 5, // 5px tolerance
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
    }

    document.addEventListener('mousemove', handleMouseMove)

    // Store cleanup function
    mouseMoveCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }

  // Handle drag end - save new order or associate with project
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Store drag over state BEFORE clearing (needed to detect project drops via indicator)
    const wasOverProject = dragOverProjectId !== null
    const dragOverProjectIdValue = dragOverProjectId
    const dragOverIdValue = dragOverId

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
        const updatedMetadata = { ...existingMetadata, project_id: projectId }

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
      setDragOverPosition(relativeY < elementCenter ? 'above' : 'below')
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

  // Fetch study sets
  const { data: studySets = [], isLoading: isLoadingStudySets, error: studySetsError } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
    refetchOnWindowFocus: true,
  })

  // Debug: Log study sets data
  useEffect(() => {
    console.log('📚 Sidebar: studySets state:', studySets.length, 'sets:', studySets.map(s => s.name))
    if (studySetsError) {
      console.error('📚 Sidebar: Error fetching study sets:', studySetsError)
    }
  }, [studySets, studySetsError])

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

  // Set up Supabase Realtime subscription for study sets (profile metadata updates)
  useEffect(() => {
    const channel = supabase
      .channel('study-sets-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          console.log('🔄 Sidebar: Profile updated via Realtime (study sets may have changed)')
          // Immediately invalidate and refetch study sets
          queryClient.invalidateQueries({ queryKey: ['studySets'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user.id, queryClient, supabase])

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

  // Separate archived boards
  const archivedConversations = conversationsWithoutProjects.filter((conversation) => {
    const isArchived = conversation.metadata?.archived === true
    const matchesSearch = conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
    return isArchived && matchesSearch
  })

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
      // Delete conversation (cascade will delete all messages)
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

  // Open delete study set dialog
  const openDeleteStudySetDialog = (studySet: { id: string; name: string }) => {
    setStudySetToDelete(studySet)
    setShowDeleteStudySetDialog(true)
  }

  // Open rename study set dialog
  const openRenameStudySetDialog = (studySet: { id: string; name: string }) => {
    setStudySetToRename(studySet)
    setStudySetRenameInput(studySet.name)
    setShowRenameStudySetDialog(true)
  }

  // Handle delete study set
  const handleDeleteStudySet = async () => {
    if (!studySetToDelete) return

    setDeletingStudySetId(studySetToDelete.id)
    setShowDeleteStudySetDialog(false)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Get current profile metadata
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('metadata')
        .eq('id', user.id)
        .single()

      if (fetchError) throw new Error(fetchError.message || 'Failed to fetch profile')

      const existingMetadata = (profile?.metadata as Record<string, any>) || {}
      const studySets = (existingMetadata.studySets || []) as Array<{ id: string; name: string }>

      // Remove the study set from the array
      const updatedStudySets = studySets.filter((set) => set.id !== studySetToDelete.id)

      // Update profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({
          metadata: { ...existingMetadata, studySets: updatedStudySets },
        })
        .eq('id', user.id)

      if (error) {
        throw new Error(error.message || 'Failed to delete study set')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['studySets'] })

      // If we're currently viewing this study set, redirect to /board
      if (pathname === `/study-set/${studySetToDelete.id}`) {
        router.push('/board')
      }
    } catch (error: any) {
      console.error('Failed to delete study set:', error)
      alert(error.message || 'Failed to delete study set. Please try again.')
    } finally {
      setDeletingStudySetId(null)
      setStudySetToDelete(null)
    }
  }

  // Handle rename study set
  const handleRenameStudySet = async () => {
    if (!studySetToRename || !studySetRenameInput.trim()) return

    setIsRenamingStudySet(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Get current profile metadata
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('metadata')
        .eq('id', user.id)
        .single()

      if (fetchError) throw new Error(fetchError.message || 'Failed to fetch profile')

      const existingMetadata = (profile?.metadata as Record<string, any>) || {}
      const studySets = (existingMetadata.studySets || []) as Array<{ id: string; name: string }>

      // Update the study set name in the array
      const updatedStudySets = studySets.map((set) =>
        set.id === studySetToRename.id ? { ...set, name: studySetRenameInput.trim() } : set
      )

      // Update profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({
          metadata: { ...existingMetadata, studySets: updatedStudySets },
        })
        .eq('id', user.id)

      if (error) {
        throw new Error(error.message || 'Failed to rename study set')
      }

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['studySets'] })

      // Close dialog and reset form
      setShowRenameStudySetDialog(false)
      setStudySetToRename(null)
      setStudySetRenameInput('')
    } catch (error: any) {
      console.error('Failed to rename study set:', error)
      alert(error.message || 'Failed to rename study set. Please try again.')
    } finally {
      setIsRenamingStudySet(false)
    }
  }

  // Handle rename conversation/board
  const handleRenameConversation = async () => {
    if (!conversationToRename || !renameInput.trim()) return

    setIsRenaming(true)

    try {
      // Update conversation title and mark as manually renamed in metadata
      const { error } = await supabase
        .from('conversations')
        .update({
          title: renameInput.trim(),
          metadata: { manuallyRenamed: true }, // Track that this was manually renamed
        })
        .eq('id', conversationToRename.id)
        .eq('user_id', user.id) // Ensure user owns this conversation

      if (error) {
        throw new Error(error.message || 'Failed to rename board')
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

  // In mobile mode without sidebar open, don't render anything
  if (isMobileMode && !isSidebarOpen) {
    return null
  }

  return (
    <>
      {/* Backdrop overlay when sidebar is open in mobile mode */}
      {isMobileMode && isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      <div className={cn(
        'bg-white dark:bg-[#171717] border-r border-gray-200 dark:border-[#2f2f2f] flex flex-col transition-all duration-300',
        isCollapsed ? 'w-16' : 'w-64',
        // In mobile mode, show as fixed overlay
        isMobileMode && isSidebarOpen && 'fixed left-0 top-0 bottom-0 z-50 shadow-xl'
      )}>
        {/* Logo / Expand Button Area - height matches top bar (52px) */}
        <div className="relative h-[52px] flex items-center">
          {/* Logo - fixed position, same distance from left edge in both states */}
          <div className="absolute top-0 left-0 h-[52px] pl-4 pt-0 flex items-center">
            {isCollapsed ? (
              // Collapsed: Show expand button on hover (ChatGPT style)
              <button
                onClick={() => setIsCollapsed(false)}
                className="w-8 h-8 rounded-md hover:bg-gray-100 transition-colors flex items-center justify-center relative group"
                title="Expand sidebar"
              >
                {/* Logo - visible by default, slightly smaller */}
                <Image
                  src="/thinkable-logo.svg"
                  alt="Thinkable"
                  width={24}
                  height={24}
                  className="h-6 w-6 absolute inset-0 m-auto group-hover:opacity-0 transition-opacity"
                  priority
                />
                {/* Expand icon - visible on hover, slightly bigger */}
                <ChevronRight className="h-6 w-6 text-gray-500 group-hover:text-gray-900 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-all" />
              </button>
            ) : (
              <button
                onClick={() => {
                  // Create new board - navigate to /board which will create one on first message
                  router.push('/board')
                }}
                className="flex items-center ml-[4px] hover:opacity-80 transition-opacity"
                title="New board"
              >
                <Image
                  src="/thinkable-logo.svg"
                  alt="Thinkable"
                  width={24}
                  height={24}
                  className="h-6 w-6"
                  priority
                />
              </button>
            )}
          </div>

          {/* Collapse button - positioned absolutely on the right when expanded */}
          {!isCollapsed && (
            <div className="absolute top-0 right-0 h-[52px] pr-4 pt-0 flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex items-center justify-center group"
                onClick={() => {
                  // In mobile mode, close the overlay completely
                  // In normal mode, just collapse the sidebar
                  if (isMobileMode) {
                    closeSidebar()
                  } else {
                    setIsCollapsed(true)
                  }
                }}
                title={isMobileMode ? "Close sidebar" : "Collapse sidebar"}
              >
                <ChevronLeft className="h-6 w-6 text-gray-500 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors" />
              </Button>
            </div>
          )}
        </div>

        {/* Divider between logo area and search/new section */}
        <div className="mx-4 h-px bg-gray-200 dark:bg-[#2f2f2f]" />

        {/* Search Bar and New/Add Dropdown */}
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
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg bg-transparent border-0 hover:bg-gray-100 dark:hover:bg-gray-800 group"
                    title="New"
                  >
                    <Plus className="h-5 w-5 text-gray-500 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => {
                      // Create new board - navigate to /board which will create one on first message
                      router.push('/board')
                    }}
                  >
                    <SquarePen className="h-4 w-4 mr-2" />
                    New board
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setShowCreateProjectDialog(true)
                    }}
                  >
                    <FolderPlus className="h-4 w-4 mr-2" />
                    New project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : (
          // Collapsed: Show centered Plus button - same vertical position as expanded state
          <div className="px-4 pt-2 pb-4 flex justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg bg-transparent border-0 hover:bg-gray-100 group"
                  title="New"
                >
                  <Plus className="h-5 w-5 text-gray-500 group-hover:text-gray-900 transition-colors" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={() => {
                    // Create new board - navigate to /board which will create one on first message
                    router.push('/board')
                  }}
                >
                  <SquarePen className="h-4 w-4 mr-2" />
                  New board
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setShowCreateProjectDialog(true)
                  }}
                >
                  <FolderPlus className="h-4 w-4 mr-2" />
                  New project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Boards/Conversations List - hidden when collapsed */}
        {!isCollapsed && (
          <nav className="flex-1 px-4 pb-4 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-400/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-400/70 dark:[&::-webkit-scrollbar-thumb]:bg-gray-500/50 dark:[&::-webkit-scrollbar-thumb]:hover:bg-gray-500/70 [&::-webkit-scrollbar]:bg-transparent">
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
              {/* Study Sets Header */}
              <div
                className="flex items-center gap-1 pl-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer group transition-colors rounded-lg min-h-[32px]"
                onClick={() => setIsStudySetsExpanded(!isStudySetsExpanded)}
              >
                <span>Study Sets</span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 opacity-0 group-hover:opacity-100 transition-all duration-200',
                    !isStudySetsExpanded && 'group-hover:-rotate-90'
                  )}
                />
              </div>

              {/* Study Sets List - collapsible */}
              {isStudySetsExpanded && (
                <div className="space-y-1">
                  {studySets.length > 0 ? (
                    <ul className="space-y-1">
                      {studySets.map((studySet) => (
                        <StudySetItem
                          key={studySet.id}
                          studySet={studySet}
                          isActive={pathname === `/study-set/${studySet.id}`}
                          pathname={pathname}
                          openRenameDialog={openRenameStudySetDialog}
                          openDeleteDialog={openDeleteStudySetDialog}
                          isRenaming={isRenamingStudySet}
                          deletingStudySetId={deletingStudySetId}
                          supabase={supabase}
                          queryClient={queryClient}
                        />
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                      No study sets yet
                    </div>
                  )}
                </div>
              )}

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

              {/* Boards List - collapsible, boards are sortable/reorderable */}
              {isBoardsExpanded && (
                <BoardsListWrapper>
                  {filteredConversations.length > 0 ? (
                    <SortableContext
                      items={filteredConversations.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="space-y-1">
                        {filteredConversations.map((conversation) => {
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

              {/* Archive Header */}
              <div
                className="flex items-center gap-1 pl-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer group transition-colors rounded-lg min-h-[32px]"
                onClick={() => setIsArchiveExpanded(!isArchiveExpanded)}
              >
                <span>Archive</span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 opacity-0 group-hover:opacity-100 transition-all duration-200',
                    !isArchiveExpanded && 'group-hover:-rotate-90'
                  )}
                />
              </div>

              {/* Archive List - collapsible */}
              {isArchiveExpanded && archivedConversations.length > 0 && (
                <SortableContext
                  items={archivedConversations.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-1">
                    {archivedConversations.map((conversation) => {
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
                          filteredConversations={archivedConversations}
                          projects={projects}
                          supabase={supabase}
                          queryClient={queryClient}
                          refetch={refetch}
                        />
                      )
                    })}
                  </ul>
                </SortableContext>
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
              <button
                onClick={() => setSettingsOpen(true)}
                className="w-8 h-8 rounded-full bg-blue-100 dark:bg-[#2a2a3a] flex items-center justify-center hover:bg-blue-200 dark:hover:bg-[#353545] transition-colors"
                title="Settings"
              >
                <span className="text-blue-600 dark:text-blue-300 font-semibold text-sm">
                  {user.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setSettingsOpen(true)}
                className="w-full flex items-center gap-3 pl-1 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1f1f1f] transition-colors"
              >
                <div className="w-8 h-8 bg-blue-100 dark:bg-[#2a2a3a] rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 dark:text-blue-300 font-semibold text-sm">
                    {user.email?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {user.email}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Free Plan</p>
                </div>
              </button>
            )}
          </div>
        </div>

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

        {/* Rename Study Set Dialog */}
        <Dialog open={showRenameStudySetDialog} onOpenChange={setShowRenameStudySetDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Rename study set</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                Enter a new name for this study set.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-4">
              <Input
                value={studySetRenameInput}
                onChange={(e) => setStudySetRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && studySetRenameInput.trim() && !isRenamingStudySet) {
                    handleRenameStudySet()
                  }
                }}
                placeholder="Study set name"
                className="w-full"
                autoFocus
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRenameStudySetDialog(false)
                  setStudySetToRename(null)
                  setStudySetRenameInput('')
                }}
                className="px-4 py-2"
                disabled={isRenamingStudySet}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRenameStudySet}
                disabled={!studySetRenameInput.trim() || isRenamingStudySet}
                className="px-4 py-2"
              >
                {isRenamingStudySet ? 'Renaming...' : 'Rename'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Study Set Confirmation Dialog */}
        <Dialog open={showDeleteStudySetDialog} onOpenChange={setShowDeleteStudySetDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Delete study set?</DialogTitle>
              <DialogDescription className="text-sm text-gray-600 pt-2">
                This will delete <span className="font-semibold text-gray-900">{studySetToDelete?.name}</span>.
              </DialogDescription>
              <DialogDescription className="text-sm text-gray-500 pt-1">
                The study set will be permanently deleted. Flashcards in this study set will not be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteStudySetDialog(false)
                  setStudySetToDelete(null)
                }}
                className="px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteStudySet}
                disabled={deletingStudySetId !== null}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white"
              >
                {deletingStudySetId ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}

