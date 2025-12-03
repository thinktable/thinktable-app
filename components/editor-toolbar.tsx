'use client'

// TipTap editor toolbar component - matches the agent editor example
import { Editor } from '@tiptap/react'
import { Button } from './ui/button'
import { useReactFlowContext } from './react-flow-context'
import { useState, useEffect, useRef } from 'react'
import { Input } from './ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  Plus,
  Minus,
  ChevronDown,
  List,
  Lock,
  Unlock,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  MoreVertical,
  Pencil,
  MessageSquare,
  Eye,
  Undo2,
  Redo2,
  Paintbrush,
  Share2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

interface EditorToolbarProps {
  editor: Editor | null
  conversationId?: string
}

export function EditorToolbar({ editor, conversationId }: EditorToolbarProps) {
  const { reactFlowInstance, isLocked, setIsLocked, layoutMode, setLayoutMode } = useReactFlowContext()
  const [zoom, setZoom] = useState(1)
  const [isEditingZoom, setIsEditingZoom] = useState(false)
  const [zoomEditValue, setZoomEditValue] = useState('100')
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const [arrowDirection, setArrowDirection] = useState<'down' | 'right' | 'left' | 'up'>('down')
  const [verticalLineStyle, setVerticalLineStyle] = useState<'solid' | 'dotted'>('solid')
  const [lineStyle, setLineStyle] = useState<'curved' | 'boxed'>('curved')
  const [editMode, setEditMode] = useState<'editing' | 'suggesting' | 'viewing'>('editing')
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set())
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftSectionRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Handle creating a new component
  const handleCreateComponent = async () => {
    if (!conversationId) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Create a new message with role 'user' and empty content (will be editable)
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: '', // Empty content to start
        })
        .select()
        .single()

      if (error) {
        throw new Error(error.message || 'Failed to create component')
      }

      // Invalidate queries to refresh the board
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      
      // Trigger refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      }, 200)
    } catch (error) {
      console.error('Failed to create component:', error)
    }
  }

  // Update zoom display periodically and on mount
  // Also snap to 100% when zoom is close to 100%
  useEffect(() => {
    if (!reactFlowInstance) return

    const updateZoom = () => {
      if (!isEditingZoom) { // Don't update if user is editing
        const viewport = reactFlowInstance.getViewport()
        const currentZoom = viewport.zoom
        
        // Snap to 100% if zoom is within 2% of 100% (between 0.98 and 1.02)
        if (currentZoom >= 0.98 && currentZoom <= 1.02 && currentZoom !== 1) {
          reactFlowInstance.setViewport({
            x: viewport.x,
            y: viewport.y,
            zoom: 1,
          }, { duration: 150 }) // Smooth snap animation
          setZoom(1)
          setZoomEditValue('100')
        } else {
          setZoom(currentZoom)
          setZoomEditValue(Math.round(currentZoom * 100).toString())
        }
      }
    }

    // Initial zoom
    updateZoom()

    // Update zoom periodically to catch external changes
    const interval = setInterval(updateZoom, 100) // Check every 100ms

    return () => {
      clearInterval(interval)
    }
  }, [reactFlowInstance, isEditingZoom])

  const handleZoomInputFocus = () => {
    setIsEditingZoom(true)
    setZoomEditValue(Math.round(zoom * 100).toString())
    setTimeout(() => {
      zoomInputRef.current?.select()
    }, 0)
  }

  const handleZoomInputBlur = () => {
    setIsEditingZoom(false)
    const numericValue = parseFloat(zoomEditValue)
    if (!isNaN(numericValue) && reactFlowInstance) {
      const newZoom = Math.max(0.1, Math.min(2, numericValue / 100))
      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: newZoom,
      })
      setZoom(newZoom)
      setZoomEditValue(Math.round(newZoom * 100).toString())
    } else {
      setZoomEditValue(Math.round(zoom * 100).toString())
    }
  }

  const handleZoomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      zoomInputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setZoomEditValue(Math.round(zoom * 100).toString())
      zoomInputRef.current?.blur()
    }
  }

  const handleZoomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZoomEditValue(e.target.value)
  }

  const handleZoomChange = (zoomValue: number | 'fit') => {
    if (!reactFlowInstance) return
    
    if (zoomValue === 'fit') {
      // Fit view - check if top bar and input box are visible to adjust fitView padding
      const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
      const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
      
      let topPadding = 0
      let bottomPadding = 0
      
      if (topBar && reactFlowElement) {
        const topBarHeight = topBar.offsetHeight
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (topBarHeight > 0) {
          topPadding = topBarHeight / reactFlowHeight
        }
      }
      
      if (inputBox && reactFlowElement) {
        const inputBoxRect = inputBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
          bottomPadding = inputBoxHeight / reactFlowHeight
        }
      }
      
      const uiPadding = Math.max(topPadding, bottomPadding, 0.05)
      reactFlowInstance.fitView({ padding: uiPadding, minZoom: 0.1, maxZoom: 2, duration: 300 })
    } else {
      // Set specific zoom level - snap to 100% if close
      let finalZoom = zoomValue
      if (zoomValue >= 0.98 && zoomValue <= 1.02) {
        finalZoom = 1
      }
      
      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: finalZoom,
      }, finalZoom !== zoomValue ? { duration: 150 } : undefined) // Smooth snap if snapping
    }
    
    // Update zoom display
    setTimeout(() => {
      const viewport = reactFlowInstance.getViewport()
      setZoom(viewport.zoom)
    }, 10)
  }

  const handleToggleLock = () => {
    if (!reactFlowInstance) return
    
    // Get current nodes to check for selected ones
    const nodes = reactFlowInstance.getNodes()
    const selectedNodes = nodes.filter(node => node.selected)
    
    if (selectedNodes.length > 0) {
      // Lock/unlock only selected nodes
      // Check if selected nodes are currently locked (both draggable and connectable are false)
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id))
      const areSelectedLocked = selectedNodes.every(node => node.draggable === false && node.connectable === false)
      
      // Get viewMode from localStorage or default to 'canvas'
      const viewMode = (typeof window !== 'undefined') 
        ? (localStorage.getItem('thinkable-view-mode') as 'linear' | 'canvas' | null) || 'canvas'
        : 'canvas'
      
      reactFlowInstance.setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (selectedNodeIds.has(node.id)) {
            // Toggle lock state for selected nodes
            return {
              ...node,
              draggable: areSelectedLocked ? (viewMode === 'canvas') : false,
              connectable: areSelectedLocked ? true : false,
            }
          }
          return node
        })
      )
    } else {
      // No selected nodes - toggle global lock state
      setIsLocked(!isLocked)
    }
  }

  // Track which items should be hidden based on available space (Google Docs style)
  useEffect(() => {
    if (!toolbarRef.current) return

    const checkVisibility = () => {
      const toolbar = toolbarRef.current
      if (!toolbar) return

      const toolbarRect = toolbar.getBoundingClientRect()
      const rightSection = toolbar.querySelector('[data-right-section]') as HTMLElement
      const moreMenuButton = toolbar.querySelector('[data-more-menu]') as HTMLElement
      const componentButton = toolbar.querySelector('[data-component-button]') as HTMLElement
      
      if (!rightSection) return

      const rightSectionRect = rightSection.getBoundingClientRect()
      
      // Calculate widths of fixed elements (More menu, Component, right section)
      // More menu is only visible when items are hidden, so check if it exists
      const moreMenuWidth = moreMenuButton ? moreMenuButton.getBoundingClientRect().width + 8 : 0 // +8 for gap/separator
      const componentWidth = componentButton ? componentButton.getBoundingClientRect().width + 8 : 0 // +8 for gap/separator
      
      // Available width = space from toolbar start to right section start, minus More menu and Component
      // This ensures More menu and Component stay visible and get pushed right by the right section
      const availableWidth = rightSectionRect.left - toolbarRect.left - moreMenuWidth - componentWidth - 16

      // Define item groups with their approximate widths (right to left priority for hiding)
      const itemGroups = [
        { id: 'arrows', width: 120 }, // Arrow + Line + Curved/Boxed dropdowns
        { id: 'layout', width: 70 },
        { id: 'alignment', width: 40 },
        { id: 'formatting', width: 180 }, // Bold, Italic, Underline, Strike, Highlight
        { id: 'list', width: 40 },
        { id: 'heading', width: 50 },
        { id: 'paint', width: 40 },
        { id: 'undoRedo', width: 70 },
        { id: 'zoom', width: 60 },
        { id: 'lock', width: 40 },
      ]

      // Calculate total width needed
      let totalWidth = 0
      const newHiddenItems = new Set<string>()

      // Start from leftmost (lock) and work right, hiding from right side first
      for (const item of itemGroups) {
        totalWidth += item.width + 8 // +8 for gap/separator
      }

      // Hide items from right to left if we don't have enough space
      let currentWidth = totalWidth
      for (const item of itemGroups) {
        if (currentWidth > availableWidth) {
          newHiddenItems.add(item.id)
          currentWidth -= item.width + 8
        }
      }

      setHiddenItems(newHiddenItems)
    }

    // Initial check with delay to ensure DOM is ready
    const initialTimeout = setTimeout(checkVisibility, 100)

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkVisibility)
    })
    resizeObserver.observe(toolbarRef.current)

    window.addEventListener('resize', checkVisibility)

    return () => {
      clearTimeout(initialTimeout)
      resizeObserver.disconnect()
      window.removeEventListener('resize', checkVisibility)
    }
  }, [editor])

  const isItemHidden = (item: string) => hiddenItems.has(item)

  return (
    <div ref={toolbarRef} className="flex items-center gap-1 h-full flex-1 overflow-hidden">
      {/* Left Section - collapsible items */}
      <div ref={leftSectionRef} className="flex items-center gap-1 flex-shrink min-w-0">
        {/* Lock Control Button - toggles node dragging/connecting */}
        {!isItemHidden('lock') && (
          <>
            <div className="flex items-center px-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleLock}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0',
                  isLocked && 'bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100'
                )}
                disabled={!reactFlowInstance}
                title={isLocked ? 'Unlock nodes' : 'Lock nodes'}
              >
                {isLocked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <Unlock className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
          </>
        )}

      {/* Zoom/Scale Dropdown */}
      {!isItemHidden('zoom') && (
        <>
          {isEditingZoom ? (
            <Input
              ref={zoomInputRef}
              type="text"
              value={zoomEditValue}
              onChange={handleZoomInputChange}
              onBlur={handleZoomInputBlur}
              onKeyDown={handleZoomInputKeyDown}
              className="h-7 w-12 px-1 text-sm text-center text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-0 flex-shrink-0"
              style={{ fontSize: '0.875rem' }}
              autoFocus
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!reactFlowInstance}
                  className={cn(
                    'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                    !reactFlowInstance && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <span 
                    className="text-sm cursor-text"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleZoomInputFocus()
                    }}
                  >
                    {Math.round(zoom * 100)}%
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-32">
                <DropdownMenuItem
                  onClick={() => handleZoomChange('fit')}
                  className="flex items-center"
                >
                  Fit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleZoomChange(0.5)}
                  className={cn('flex items-center', zoom === 0.5 && 'bg-gray-100 dark:bg-[#1f1f1f]')}
                >
                  50%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(0.75)}
                  className={cn('flex items-center', zoom === 0.75 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  75%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(0.9)}
                  className={cn('flex items-center', zoom === 0.9 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  90%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(1)}
                  className={cn('flex items-center', zoom === 1 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  100%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(1.25)}
                  className={cn('flex items-center', zoom === 1.25 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  125%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(1.5)}
                  className={cn('flex items-center', zoom === 1.5 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  150%
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleZoomChange(2)}
                  className={cn('flex items-center', zoom === 2 && 'bg-gray-100 dark:bg-gray-800')}
                >
                  200%
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
        </>
      )}

      {/* Undo/Redo Controls */}
      {!isItemHidden('undoRedo') && (
        <>
          <div className="flex items-center gap-1 px-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!editor || !editor.can().undo()}
              className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              title="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!editor || !editor.can().redo()}
              className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              title="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
        </>
      )}

      {/* Paint Format / Clear Formatting Button */}
      {!isItemHidden('paint') && editor && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
            title="Clear formatting"
          >
            <Paintbrush className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0" />
        </>
      )}

      {/* Only show editor controls when editor is active */}
      {editor && (
        <>
          {/* Heading Style Dropdown */}
          {!isItemHidden('heading') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                      editor.isActive('heading', { level: 2 }) && 'bg-gray-100'
                    )}
                  >
                    <span className="text-sm">H₂</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().setParagraph().run()}
                    className={editor.isActive('paragraph') ? 'bg-gray-100 dark:bg-[#1f1f1f]' : ''}
                  >
                    Paragraph
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                    className={editor.isActive('heading', { level: 1 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 1
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={editor.isActive('heading', { level: 2 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 2
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                    className={editor.isActive('heading', { level: 3 }) ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Heading 3
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* List Dropdown */}
          {!isItemHidden('list') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                      (editor.isActive('bulletList') || editor.isActive('orderedList')) && 'bg-gray-100 dark:bg-[#1f1f1f]'
                    )}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={editor.isActive('bulletList') ? 'bg-gray-100 dark:bg-gray-800' : ''}
                  >
                    Bullet List
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={editor.isActive('orderedList') ? 'bg-gray-100' : ''}
                  >
                    Numbered List
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Text Formatting Controls */}
          {!isItemHidden('formatting') && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0',
                  editor.isActive('bold') && 'bg-gray-100 text-gray-900'
                )}
                title="Bold"
              >
                <span className="text-sm font-bold">B</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0',
                  editor.isActive('italic') && 'bg-gray-100 text-gray-900'
                )}
                title="Italic"
              >
                <span className="text-sm italic">I</span>
              </Button>
              {/* Underline - only show if underline extension is available */}
              {editor.extensionManager.extensions.find(ext => ext.name === 'underline') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  className={cn(
                    'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0',
                    editor.isActive('underline') && 'bg-gray-100 text-gray-900'
                  )}
                  title="Underline"
                >
                  <span className="text-sm underline">U</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleStrike().run()}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0',
                  editor.isActive('strike') && 'bg-gray-100 text-gray-900'
                )}
                title="Strikethrough"
              >
                <span className="text-sm line-through">S</span>
              </Button>
              {/* Highlight Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
                className={cn(
                  'h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0',
                  editor.isActive('highlight') && 'bg-gray-100 text-gray-900'
                )}
                title="Highlight"
              >
                <Highlighter className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </div>
          )}

          {/* Text Alignment Dropdown */}
          {!isItemHidden('alignment') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 px-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0',
                      (editor.isActive({ textAlign: 'center' }) || editor.isActive({ textAlign: 'right' }) || editor.isActive({ textAlign: 'justify' })) && 'bg-gray-100'
                    )}
                  >
                    {/* Show current alignment icon */}
                    {editor.isActive({ textAlign: 'center' }) ? (
                      <AlignCenter className="h-4 w-4" />
                    ) : editor.isActive({ textAlign: 'right' }) ? (
                      <AlignRight className="h-4 w-4" />
                    ) : editor.isActive({ textAlign: 'justify' }) ? (
                      <AlignJustify className="h-4 w-4" />
                    ) : (
                      <AlignLeft className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().setTextAlign('left').run()}
                    className={cn('flex items-center gap-2', editor.isActive({ textAlign: 'left' }) && 'bg-gray-100')}
                  >
                    <AlignLeft className="h-4 w-4" />
                    Left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().setTextAlign('center').run()}
                    className={cn('flex items-center gap-2', editor.isActive({ textAlign: 'center' }) && 'bg-gray-100')}
                  >
                    <AlignCenter className="h-4 w-4" />
                    Center
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().setTextAlign('right').run()}
                    className={cn('flex items-center gap-2', editor.isActive({ textAlign: 'right' }) && 'bg-gray-100')}
                  >
                    <AlignRight className="h-4 w-4" />
                    Right
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                    className={cn('flex items-center gap-2', editor.isActive({ textAlign: 'justify' }) && 'bg-gray-100')}
                  >
                    <AlignJustify className="h-4 w-4" />
                    Justify
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Layout Dropdown */}
          {!isItemHidden('layout') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
                  >
                    <span className="text-sm capitalize">{layoutMode === 'none' ? 'None' : layoutMode}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => setLayoutMode('auto')}
                    className={cn('flex items-center gap-2', layoutMode === 'auto' && 'bg-gray-100')}
                  >
                    Auto
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLayoutMode('tree')}
                    className={cn('flex items-center gap-2', layoutMode === 'tree' && 'bg-gray-100')}
                  >
                    Tree
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLayoutMode('cluster')}
                    className={cn('flex items-center gap-2', layoutMode === 'cluster' && 'bg-gray-100')}
                  >
                    Cluster
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLayoutMode('none')}
                    className={cn('flex items-center gap-2', layoutMode === 'none' && 'bg-gray-100')}
                  >
                    None
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-500 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Arrow Direction, Line Style, Curved/Boxed Dropdowns */}
          {!isItemHidden('arrows') && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
                  >
                    {arrowDirection === 'down' && <ArrowDown className="h-4 w-4" />}
                    {arrowDirection === 'up' && <ArrowUp className="h-4 w-4" />}
                    {arrowDirection === 'left' && <ArrowLeft className="h-4 w-4" />}
                    {arrowDirection === 'right' && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('down')}
                    className={cn('flex items-center justify-center', arrowDirection === 'down' && 'bg-gray-100')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('right')}
                    className={cn('flex items-center justify-center', arrowDirection === 'right' && 'bg-gray-100')}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('left')}
                    className={cn('flex items-center justify-center', arrowDirection === 'left' && 'bg-gray-100')}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setArrowDirection('up')}
                    className={cn('flex items-center justify-center', arrowDirection === 'up' && 'bg-gray-100')}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Vertical Line Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
                  >
                    {verticalLineStyle === 'solid' ? (
                      <div className="w-[2px] h-4 bg-gray-600" />
                    ) : (
                      <div className="flex flex-col gap-0.5 h-4 items-center">
                        <div className="w-0.5 h-1 bg-gray-600" />
                        <div className="w-0.5 h-1 bg-gray-600" />
                        <div className="w-0.5 h-1 bg-gray-600" />
                      </div>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => setVerticalLineStyle('solid')}
                    className={cn('flex items-center justify-center', verticalLineStyle === 'solid' && 'bg-gray-100')}
                  >
                    <div className="w-[2px] h-4 bg-gray-600" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setVerticalLineStyle('dotted')}
                    className={cn('flex items-center justify-center', verticalLineStyle === 'dotted' && 'bg-gray-100')}
                  >
                    <div className="flex flex-col gap-0.5 h-4 items-center">
                      <div className="w-0.5 h-1 bg-gray-600" />
                      <div className="w-0.5 h-1 bg-gray-600" />
                      <div className="w-0.5 h-1 bg-gray-600" />
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Curved vs Boxed Line Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
                  >
                    {lineStyle === 'curved' ? (
                      <div className="w-4 h-4 flex items-center justify-center">
                        <div className="w-3 h-3 border-l-2 border-b-2 border-gray-600 rounded-bl-full" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 flex items-center justify-center">
                        <div className="w-3 h-3 border-l-2 border-b-2 border-gray-600" />
                      </div>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    onClick={() => setLineStyle('curved')}
                    className={cn('flex items-center justify-center', lineStyle === 'curved' && 'bg-gray-100')}
                  >
                    <div className="w-4 h-4 flex items-center justify-center">
                      <div className="w-3 h-3 border-l-2 border-b-2 border-gray-600 rounded-bl-full" />
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLineStyle('boxed')}
                    className={cn('flex items-center justify-center', lineStyle === 'boxed' && 'bg-gray-100')}
                  >
                    <div className="w-4 h-4 flex items-center justify-center">
                      <div className="w-3 h-3 border-l-2 border-b-2 border-gray-600" />
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </>
      )}
      </div>
      {/* End of left section */}

      {/* More menu button - contains hidden items, left-aligned after collapsible items */}
      {hiddenItems.size > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
              title="More options"
              data-more-menu
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* Show hidden items in more menu */}
            {isItemHidden('lock') && reactFlowInstance && (
              <>
                <DropdownMenuItem onClick={handleToggleLock}>
                  {isLocked ? <Lock className="h-4 w-4 mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
                  {isLocked ? 'Unlock nodes' : 'Lock nodes'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('zoom') && reactFlowInstance && (
              <>
                <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                  Fit to view
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>50%</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>75%</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleZoomChange(1)}>100%</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>150%</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleZoomChange(2)}>200%</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('undoRedo') && editor && (
              <>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Undo
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                >
                  <Redo2 className="h-4 w-4 mr-2" />
                  Redo
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('paint') && editor && (
              <>
                <DropdownMenuItem onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
                  <Paintbrush className="h-4 w-4 mr-2" />
                  Clear formatting
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('heading') && editor && (
              <>
                <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
                  Paragraph
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('list') && editor && (
              <>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
                  <List className="h-4 w-4 mr-2" />
                  Bullet List
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                  Numbered List
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('formatting') && editor && (
              <>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleBold().run()}>
                  <span className="font-bold mr-2">B</span>
                  Bold
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <span className="italic mr-2">I</span>
                  Italic
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleStrike().run()}>
                  <span className="line-through mr-2">S</span>
                  Strikethrough
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}>
                  <Highlighter className="h-4 w-4 mr-2" />
                  Highlight
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('alignment') && editor && (
              <>
                <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('left').run()}>
                  <AlignLeft className="h-4 w-4 mr-2" />
                  Align Left
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('center').run()}>
                  <AlignCenter className="h-4 w-4 mr-2" />
                  Align Center
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editor.chain().focus().setTextAlign('right').run()}>
                  <AlignRight className="h-4 w-4 mr-2" />
                  Align Right
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('layout') && (
              <>
                <DropdownMenuItem onClick={() => setLayoutMode('auto')}>
                  Layout: Auto
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode('tree')}>
                  Layout: Tree
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode('cluster')}>
                  Layout: Cluster
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isItemHidden('arrows') && (
              <>
                <DropdownMenuItem onClick={() => setArrowDirection('down')}>
                  <ArrowDown className="h-4 w-4 mr-2" />
                  Arrow Down
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArrowDirection('right')}>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Arrow Right
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArrowDirection('left')}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Arrow Left
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setArrowDirection('up')}>
                  <ArrowUp className="h-4 w-4 mr-2" />
                  Arrow Up
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Divider between More menu and Component - only show if More menu is visible */}
      {hiddenItems.size > 0 && <div className="w-px h-6 bg-gray-300 mx-1" />}

      {/* Divider between branch dropdown and Component - only show if More menu is NOT visible */}
      {hiddenItems.size === 0 && <div className="w-px h-6 bg-gray-300 mx-1" />}

      {/* Component button - text hidden on shrink, + icon always visible, no border */}
      {conversationId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCreateComponent}
          className="h-7 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
          data-component-button
        >
          <Plus className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm ml-1 hidden md:inline whitespace-nowrap">Component</span>
        </Button>
      )}

      {/* Right Section - always visible, fixed position (Share and Edit Mode) */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-auto mr-4" data-right-section>
        {/* Share Button */}
        <div className="flex items-center px-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex-shrink-0"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Edit Mode Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2 text-gray-700 dark:text-gray-200 bg-blue-50 dark:bg-[#2a2a3a] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] data-[state=open]:bg-gray-300 dark:data-[state=open]:bg-[#2f2f2f] focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          >
            {editMode === 'editing' && <Pencil className="h-4 w-4" />}
            {editMode === 'suggesting' && <MessageSquare className="h-4 w-4" />}
            {editMode === 'viewing' && <Eye className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => setEditMode('editing')}
            className={cn(
              'flex items-center gap-3 p-3',
              editMode === 'editing' && 'bg-gray-200'
            )}
          >
            <Pencil className="h-5 w-5 text-gray-600" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Editing</span>
              <span className="text-xs text-gray-500">Edit document directly</span>
            </div>
            {editMode === 'editing' && (
              <div className="ml-auto">
                <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEditMode('suggesting')}
            className={cn(
              'flex items-center gap-3 p-3',
              editMode === 'suggesting' && 'bg-gray-200'
            )}
          >
            <MessageSquare className="h-5 w-5 text-gray-600" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Suggesting</span>
              <span className="text-xs text-gray-500">Edits become suggestions</span>
            </div>
            {editMode === 'suggesting' && (
              <div className="ml-auto">
                <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEditMode('viewing')}
            className={cn(
              'flex items-center gap-3 p-3',
              editMode === 'viewing' && 'bg-gray-200'
            )}
          >
            <Eye className="h-5 w-5 text-gray-600" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Viewing</span>
              <span className="text-xs text-gray-500">Read or print final document</span>
            </div>
            {editMode === 'viewing' && (
              <div className="ml-auto">
                <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

