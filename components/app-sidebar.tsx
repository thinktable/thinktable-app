'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Search, MoreVertical, Trash2, ChevronLeft, ChevronRight, SquarePen, Pencil, ChevronDown, FolderPlus } from 'lucide-react'
import { SettingsPanel } from '@/components/settings-panel'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

interface AppSidebarProps {
  user: User
}

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// Fetch conversations/boards for the user
async function fetchConversations(): Promise<Conversation[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching conversations:', error)
    return []
  }
  return (data || []) as Conversation[]
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
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { isMobileMode, isSidebarOpen, closeSidebar } = useSidebarContext()

  // Fetch conversations/boards
  const { data: conversations = [], refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
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

  // Listen for conversation creation/update events to refetch (fallback)
  useEffect(() => {
    const handleConversationCreated = () => {
      console.log('🔄 Sidebar: conversation-created event received')
      console.log('🔄 Sidebar: Invalidating and refetching conversations')
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
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
                placeholder="Search boards..."
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
                    // TODO: Implement new project functionality
                    console.log('New project clicked')
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
                  // TODO: Implement new project functionality
                  console.log('New project clicked')
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
        <nav className="flex-1 px-4 pb-4 overflow-y-auto">
          {/* Boards Header */}
          <div 
            className="flex items-center gap-1 pl-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer group transition-colors"
            onClick={() => setIsBoardsExpanded(!isBoardsExpanded)}
          >
            <span>Boards</span>
            <ChevronDown 
              className={cn(
                'h-3 w-3 opacity-0 group-hover:opacity-100 transition-all duration-200',
                !isBoardsExpanded && 'opacity-100 -rotate-90'
              )}
            />
          </div>
          
          {/* Boards List - collapsible */}
          {isBoardsExpanded && (
            <>
            {filteredConversations.length > 0 ? (
              <ul className="space-y-1">
            {filteredConversations.map((conversation) => {
              const isActive = pathname === `/board/${conversation.id}`
              const isDeleting = deletingConversationId === conversation.id
              return (
                <li key={conversation.id}>
                  <div className={`flex items-center gap-2 px-4 h-8 rounded-lg transition-colors text-sm group ${
                    isActive
                      ? 'bg-blue-50 dark:bg-[#2a2a3a]'
                      : 'hover:bg-gray-50 dark:hover:bg-[#1f1f1f]'
                  }`}>
                    <Link
                      href={`/board/${conversation.id}`}
                      className="flex items-center gap-2 flex-1 min-w-0 text-gray-700 dark:text-gray-300"
                    >
                      <span className="truncate flex-1">{conversation.title}</span>
                    </Link>
                    {/* Dropdown menu button */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ${
                            isActive ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300' : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
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
                </li>
              )
            })}
              </ul>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                {searchQuery ? 'No boards found' : 'No boards yet. Start a chat!'}
              </div>
            )}
            </>
          )}
        </nav>
      )}

      {/* Profile Section - fixed at bottom */}
      <div className="relative h-16 flex-shrink-0 mt-auto flex items-center">
        {/* Divider - fades out on collapse */}
        <div className={cn(
          "absolute top-0 left-0 right-0 border-t border-gray-200 transition-opacity duration-300",
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
    </div>
    </>
  )
}

