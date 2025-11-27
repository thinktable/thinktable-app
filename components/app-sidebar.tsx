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
import { Plus, Search, MoreVertical, Trash2, ChevronLeft, ChevronRight, SquarePen } from 'lucide-react'
import { SettingsPanel } from '@/components/settings-panel'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Fetch conversations/boards
  const { data: conversations = [], refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchOnWindowFocus: true,
  })

  // Listen for conversation creation events to refetch
  useEffect(() => {
    const handleConversationCreated = () => {
      refetch()
    }
    window.addEventListener('conversation-created', handleConversationCreated)
    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated)
    }
  }, [refetch])

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

  return (
    <div className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Logo / Expand Button Area */}
      <div className="relative h-16 flex items-center">
        {/* Logo - fixed position, same distance from left edge in both states */}
        <div className="absolute top-0 left-0 h-16 pl-4 pt-0 flex items-center">
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
          <div className="absolute top-0 right-0 h-16 pr-4 pt-0 flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex items-center justify-center group"
              onClick={() => setIsCollapsed(true)}
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-6 w-6 text-gray-500 group-hover:text-gray-900 transition-colors" />
            </Button>
          </div>
        )}
      </div>

      {/* New Board Button - hidden when collapsed */}
      {!isCollapsed && (
        <div className="px-4 pb-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-auto py-2 px-3 hover:bg-gray-100"
            onClick={() => {
              // Create new board - navigate to /board which will create one on first message
              router.push('/board')
            }}
          >
            <SquarePen className="h-4 w-4 text-gray-900" />
            <span className="text-sm font-medium text-gray-900">New board</span>
          </Button>
        </div>
      )}

      {/* Search Bar - hidden when collapsed */}
      {!isCollapsed && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search boards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-sm rounded-lg"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-transparent border border-input hover:bg-transparent group"
              onClick={() => {
                // Create new board - navigate to /board which will create one on first message
                router.push('/board')
              }}
              title="New board"
            >
              <Plus className="h-5 w-5 text-gray-500 group-hover:text-gray-900 transition-colors" />
            </Button>
          </div>
        </div>
      )}

      {/* Boards/Conversations List - hidden when collapsed */}
      {!isCollapsed && (
        <nav className="flex-1 p-4 overflow-y-auto">
        {filteredConversations.length > 0 ? (
          <ul className="space-y-1">
            {filteredConversations.map((conversation) => {
              const isActive = pathname === `/board/${conversation.id}`
              const isDeleting = deletingConversationId === conversation.id
              return (
                <li key={conversation.id}>
                  <div className={`flex items-center gap-2 px-4 h-8 rounded-lg transition-colors text-sm group ${
                    isActive
                      ? 'bg-blue-50'
                      : 'hover:bg-gray-50'
                  }`}>
                    <Link
                      href={`/board/${conversation.id}`}
                      className="flex items-center gap-2 flex-1 min-w-0 text-gray-700"
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
                            isActive ? 'text-blue-600 hover:text-blue-700' : 'text-gray-500 hover:text-gray-700'
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
              className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center hover:bg-blue-200 transition-colors"
              title="Settings"
            >
              <span className="text-blue-600 font-semibold text-xs">
                {user.email?.charAt(0).toUpperCase() || 'U'}
              </span>
            </button>
          ) : (
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-blue-600 font-semibold text-xs">
                  {user.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.email}
                </p>
                <p className="text-xs text-gray-500">Free Plan</p>
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
  )
}

