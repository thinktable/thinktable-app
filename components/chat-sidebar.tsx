'use client'

// Full-height right chat column — Notion-style AI panel layout
import { useState } from 'react'
import { ChatInput } from './chat-input'
import { useSidebarContext, CHAT_SIDEBAR_WIDTH } from './sidebar-context'
import { ThinktableBrandMark, PersonalizeAiModal } from './personalize-ai-modal'
import { cn } from '@/lib/utils'
import {
  X,
  ChevronsRight,
  ChevronDown,
  MessageSquarePlus,
  Search,
  ListTodo,
  Sparkles,
  Pencil,
} from 'lucide-react'

interface ChatSidebarProps {
  conversationId?: string
  projectId?: string
}

export function ChatSidebar({ conversationId, projectId }: ChatSidebarProps) {
  const { isChatSidebarOpen, setChatSidebarOpen, topperId, setTopperId } = useSidebarContext()
  const [personalizeOpen, setPersonalizeOpen] = useState(false) // Sample personalize modal
  const [hoverBrand, setHoverBrand] = useState(false) // Show Personalize pill on logo hover

  if (!isChatSidebarOpen) return null // Hidden by default; opened via board brand logo

  return (
    // Overlay on the right — does not shrink map / top-bar column
    <div className="absolute inset-y-0 right-0 z-30 flex h-full pointer-events-none">
      <div className="relative h-full flex pointer-events-auto">
      <aside
        data-chat-sidebar
        className={cn(
          'h-full flex flex-col',
          // Match board/top-bar surface (reverted from Notion tint)
          'bg-gray-50 dark:bg-[#0f0f0f]',
          'border-l border-black/10 dark:border-white/10',
          'shadow-[-8px_0_24px_rgba(0,0,0,0.06)] dark:shadow-[-8px_0_24px_rgba(0,0,0,0.35)]' // Soft separation over map
        )}
        style={{ width: CHAT_SIDEBAR_WIDTH }}
      >
        {/* Header — title left, actions right (Notion AI / agent panel pattern) */}
        <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 h-11">
          <button
            type="button"
            className="flex items-center gap-1 min-w-0 rounded-md px-1.5 py-1 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            title="Chat sessions"
          >
            <span className="truncate">New AI chat</span>
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          </button>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              title="New chat"
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setChatSidebarOpen(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              title="Hide chat"
              aria-label="Hide chat sidebar"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
            {/* Top-right X — kept */}
            <button
              type="button"
              onClick={() => setChatSidebarOpen(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              title="Hide chat"
              aria-label="Close chat sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Body — empty state / transcript (Notion-like quiet center) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
          <div className="flex flex-col items-start gap-5 max-w-[280px] mx-auto mt-6">
            {/* Brand mark + Personalize on hover (Notion AI pattern) */}
            <div
              className="flex items-center gap-2.5"
              onMouseEnter={() => setHoverBrand(true)}
              onMouseLeave={() => setHoverBrand(false)}
            >
              <button
                type="button"
                onClick={() => setPersonalizeOpen(true)}
                className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                title="Personalize Thinktable AI"
                aria-label="Personalize Thinktable AI"
              >
                <ThinktableBrandMark topperId={topperId} size={52} />
              </button>

              {/* Personalize pill — appears on hover, Notion-style */}
              <button
                type="button"
                onClick={() => setPersonalizeOpen(true)}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium',
                  'bg-black/[0.06] dark:bg-white/[0.08] text-gray-700 dark:text-gray-200',
                  'border border-black/5 dark:border-white/10',
                  'hover:bg-black/[0.1] dark:hover:bg-white/[0.12] transition-all',
                  hoverBrand
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 -translate-x-1 pointer-events-none'
                )}
                tabIndex={hoverBrand ? 0 : -1}
                aria-hidden={!hoverBrand}
              >
                <Pencil className="h-3 w-3" />
                Personalize
              </button>
            </div>

            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                What&apos;s on your mind?
              </h2>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Ask anything about this board, or pick a starting point.
              </p>
            </div>

            {/* Quick actions — Notion-style list rows */}
            <ul className="w-full flex flex-col gap-0.5">
              {[
                { icon: Sparkles, label: 'Summarize this board' },
                { icon: ListTodo, label: 'Turn notes into tasks' },
                { icon: Search, label: 'Search connected pages' },
              ].map(({ icon: Icon, label }) => (
                <li key={label}>
                  <button
                    type="button"
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm',
                      'text-gray-700 dark:text-gray-300',
                      'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                    <span className="truncate">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Return-to-bottom portals from BoardFlow */}
          <div
            data-chat-return-slot
            className="flex justify-center items-center min-h-[44px] mt-4"
          />
        </div>

        {/* Composer — bottom dock, Notion-like quiet chrome */}
        <div className="flex-shrink-0 px-3 pb-3 pt-1 pointer-events-auto">
          <div className="rounded-xl overflow-hidden bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 shadow-sm">
            <ChatInput conversationId={conversationId} projectId={projectId} variant="sidebar" />
          </div>
        </div>
      </aside>

      {/* Sample personalize popup — topper picker */}
      <PersonalizeAiModal
        open={personalizeOpen}
        onOpenChange={setPersonalizeOpen}
        topperId={topperId}
        onTopperChange={setTopperId}
      />
      </div>
    </div>
  )
}
