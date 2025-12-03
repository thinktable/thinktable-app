'use client'

// Edit panel - always visible at top of map area
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Menu, ChevronRight } from 'lucide-react'
import { EditorToolbar } from './editor-toolbar'
import { useEditorContext } from './editor-context'
import { useState } from 'react'
import { useSidebarContext } from './sidebar-context'
import Image from 'next/image'

interface EditPanelProps {
  conversationId?: string
}

export function EditPanel({ conversationId }: EditPanelProps) {
  const { activeEditor } = useEditorContext()
  const [isHidden, setIsHidden] = useState(false) // Track if top bar is hidden
  const [isHovering, setIsHovering] = useState(false) // Track if mouse is hovering over pill
  const { isMobileMode, toggleSidebar } = useSidebarContext()

  // Calculate corner radius and height: matches input box
  const cornerRadius = 26 // px - matches input box corner radius
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
            'bg-white dark:bg-[#171717] shadow-sm border-b border-gray-200 dark:border-[#2f2f2f] backdrop-blur-sm flex items-center gap-1 w-full transition-all duration-200 overflow-hidden',
            isHidden && 'opacity-0 h-0 border-0 shadow-none'
          )}
          style={{
            // No rounded corners - fills full width
            borderRadius: '0px',
            height: isHidden ? '0px' : `${panelHeight}px`, // Same height as input box (52px), 0 when hidden
            paddingLeft: isHidden ? '0' : '0.5rem', // 8px left padding
            paddingRight: isHidden ? '0' : '0.5rem', // 8px right padding
            boxSizing: 'border-box', // Ensure padding is included in height
          }}
        >
          {/* Sidebar toggle button - only shown in mobile mode (when sidebar is hidden) */}
          {/* Exact same button as collapsed sidebar expand button */}
          {isMobileMode && (
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 flex-shrink-0 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center relative group mr-2"
              title="Expand sidebar"
            >
              {/* Logo - visible by default, slightly smaller */}
              <Image
                src="/thinkable-logo.svg"
                alt="Thinkable"
                width={24}
                height={24}
                className="h-6 w-6 absolute inset-0 m-auto group-hover:opacity-0 transition-opacity dark:invert"
                priority
              />
              {/* Expand icon - visible on hover, slightly bigger */}
              <ChevronRight className="h-6 w-6 text-gray-500 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-all" />
            </button>
          )}
          
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
