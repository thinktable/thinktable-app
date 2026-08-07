'use client'

// Edit panel - always visible at top of map area (logo + board title + toolbar)
import { cn } from '@/lib/utils'
import { EditorToolbar } from './editor-toolbar'
import { useEditorContext } from './editor-context'
import { useState } from 'react'
import { useSidebarContext } from './sidebar-context'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'

interface EditPanelProps {
  conversationId?: string
  projectId?: string
}

export function EditPanel({ conversationId, projectId }: EditPanelProps) {
  const { activeEditor } = useEditorContext()
  const [isHidden, setIsHidden] = useState(false) // Track if top bar is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over pill
  const { openSidebar, scheduleCloseSidebar, toggleSidebar, isMobileMode } = useSidebarContext()
  const supabase = createClient() // Client for board/project title lookup

  // Resolve current board title for the top bar (ellipsis when long)
  const { data: boardTitle } = useQuery({
    queryKey: ['edit-panel-title', conversationId, projectId],
    queryFn: async () => {
      if (conversationId) {
        const { data } = await supabase
          .from('conversations')
          .select('title')
          .eq('id', conversationId)
          .maybeSingle()
        return (data?.title as string | undefined)?.trim() || 'Untitled'
      }
      if (projectId) {
        const { data } = await supabase
          .from('projects')
          .select('name')
          .eq('id', projectId)
          .maybeSingle()
        return (data?.name as string | undefined)?.trim() || 'Untitled project'
      }
      return 'Thinktable'
    },
    enabled: Boolean(conversationId || projectId),
    staleTime: 30_000,
  })

  const displayTitle = boardTitle || (conversationId || projectId ? '…' : 'Thinktable') // Placeholder while loading

  const panelHeight = 52 // px - matches input box height

  return (
    <>
      <div
        className={cn(
          'absolute left-0 right-0 z-10 pointer-events-auto flex flex-col items-center'
        )}
        style={{
          // Position at very top of map area - no gap
          top: '0px',
        }}
      >
        {/* Top bar content - hidden when isHidden is true */}
        <div
          className={cn(
            // Match React Flow board/main area background — no border, no shadow
            'bg-gray-50 dark:bg-[#0f0f0f] flex items-center gap-1 w-full transition-all duration-200 overflow-hidden',
            isHidden && 'opacity-0 h-0'
          )}
          style={{
            // No rounded corners - fills map column width (chat sidebar is a sibling column)
            borderRadius: '0px',
            border: 'none', // Explicitly no bottom (or any) border
            boxShadow: 'none',
            height: isHidden ? '0px' : `${panelHeight}px`, // Same height as input box (52px), 0 when hidden
            paddingLeft: isHidden ? '0' : '0.5rem', // 8px left padding
            paddingRight: isHidden ? '0' : '0.5rem', // 8px right padding
            boxSizing: 'border-box', // Ensure padding is included in height
          }}
        >
          {/* Brand logo — hover/click opens rounded nav popup (former left sidebar) */}
          <div
            data-nav-logo-trigger
            className="flex items-center gap-2 flex-shrink-0 min-w-0 mr-2 max-w-[min(240px,32vw)]"
            onMouseEnter={() => {
              if (!isMobileMode) openSidebar() // Desktop: open on hover
            }}
            onMouseLeave={() => {
              if (!isMobileMode) scheduleCloseSidebar() // Allow pointer to reach popup
            }}
          >
            <button
              type="button"
              onClick={() => toggleSidebar()} // Mobile / click: toggle popup
              className="w-8 h-8 flex-shrink-0 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center"
              title="Open menu"
              aria-label="Open navigation menu"
            >
              <Image
                src="/thinktable-logo.svg"
                alt="ThinkTable"
                width={24}
                height={24}
                className="h-6 w-6 dark:invert"
                priority
              />
            </button>
            {/* Current board / project name — truncates with ellipsis when too long */}
            <span
              className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate select-none"
              title={displayTitle}
            >
              {displayTitle}
            </span>
          </div>

          {/* Editor Toolbar - shows lock/zoom controls always, editor controls when editor is active */}
          <EditorToolbar editor={activeEditor} conversationId={conversationId} />
        </div>

        {/* Thin pill toggle below top bar - only visible on hover or when hidden */}
        <div
          onClick={() => setIsHidden(!isHidden)}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          className={cn(
            'w-12 h-1.5 rounded-full cursor-pointer transition-all duration-200 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500',
            isHidden ? 'mt-2' : 'mt-1.5',
            // Show pill when hovering on it, or always show if bar is hidden (so user can restore it)
            (isHovering || isHidden) ? 'opacity-100' : 'opacity-0'
          )}
          title={isHidden ? 'Show toolbar' : 'Hide toolbar'}
        />
      </div>
    </>
  )
}
