'use client'

// Full-height right chat column — prompt input + return-to-bottom slot (hidden by default)
import { ChatInput } from './chat-input'
import { useSidebarContext, CHAT_SIDEBAR_WIDTH } from './sidebar-context'
import { cn } from '@/lib/utils'

interface ChatSidebarProps {
  conversationId?: string
  projectId?: string
}

export function ChatSidebar({ conversationId, projectId }: ChatSidebarProps) {
  const { isChatSidebarOpen } = useSidebarContext()

  if (!isChatSidebarOpen) return null // Hidden by default; toggled via logo by minimap

  return (
    <aside
      data-chat-sidebar
      className={cn(
        'h-full flex-shrink-0 flex flex-col',
        // Match board/main area background; keep the left divider border
        'bg-gray-50 dark:bg-[#0f0f0f]',
        'border-l border-gray-200 dark:border-[#2f2f2f]'
      )}
      style={{ width: CHAT_SIDEBAR_WIDTH }} // Forces map + top edit bar to shrink left
    >
      {/* Reserved space for future transcript / fork tree */}
      <div className="flex-1 min-h-0 overflow-y-auto" />

      {/* Return-to-bottom portals here from BoardFlow */}
      <div
        data-chat-return-slot
        className="flex justify-center items-center pb-2 min-h-[44px] flex-shrink-0"
      />

      {/* Prompt input anchored to bottom of chat column */}
      <div className="flex-shrink-0 p-3 pt-0 pointer-events-auto">
        <div className="shadow-sm rounded-[26px] overflow-hidden">
          <ChatInput conversationId={conversationId} projectId={projectId} />
        </div>
      </div>
    </aside>
  )
}
