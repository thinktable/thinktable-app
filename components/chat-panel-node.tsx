'use client'

// Custom React Flow node for chat panels (prompt + response)
import { NodeProps, Handle, Position } from 'reactflow'
import { cn } from '@/lib/utils'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Highlighter, RotateCcw, MoreHorizontal, MoreVertical, Trash2, Copy, Loader2, ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { useEditorContext } from './editor-context'
import { useReactFlowContext } from './react-flow-context'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface Comment {
  id: string
  selectedText: string
  from: number
  to: number
  section: 'prompt' | 'response'
  comment: string
  createdAt: string
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
  isResponseCollapsed?: boolean // Track if response is collapsed for position updates
}

// Default highlight color (yellow)
const DEFAULT_HIGHLIGHT_COLOR = '#fef08a'

// Format response content - if it's already HTML, return as-is (TipTap will render it)
// Only format plain text content
function formatResponseContent(content: string): string {
  if (!content) return content
  
  // Check if content is already HTML - if so, return it as-is (TipTap handles HTML directly)
  const isHTML = /<[a-z][\s\S]*>/i.test(content)
  
  if (isHTML) {
    // Content is already HTML - TipTap will render it directly, no need to reformat
    return content
  }
  
  // If it's plain text, convert to basic HTML structure
  // Split by double newlines (paragraph breaks) or single newlines if no double newlines
  const hasDoubleNewlines = /\n\s*\n/.test(content)
  const paragraphs = hasDoubleNewlines
    ? content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
    : content.split(/\n/).map(p => p.trim()).filter(p => p.length > 0)
  
  if (paragraphs.length <= 1) {
    // Single paragraph - wrap in <p> tag
    return `<p>${content}</p>`
  }
  
  // Convert paragraphs to HTML
  const htmlParagraphs = paragraphs
    .map(p => {
      // Check if it looks like a heading
      const isHeading = /^[A-Z][^.!?]*[:\-]$/.test(p) || (p.length < 100 && !p.includes('.'))
      if (isHeading) {
        return `<h2>${p}</h2>`
      }
      // Check if it's a list item
      const isListItem = /^[\d\-\*•]\s/.test(p) || /^\d+[\.\)]\s/.test(p)
      if (isListItem) {
        return `<li>${p.replace(/^[\d\-\*•]\s/, '').replace(/^\d+[\.\)]\s/, '')}</li>`
      }
      return `<p>${p}</p>`
    })
    .join('')
  
  return htmlParagraphs
}

function TipTapContent({ 
  content, 
  className, 
  originalContent,
  onContentChange,
  onHasChangesChange,
  onComment,
  comments = [],
  editorRef,
  onCommentHover,
  onCommentClick
}: { 
  content: string
  className?: string
  originalContent: string
  onContentChange?: (newContent: string) => void
  onHasChangesChange?: (hasChanges: boolean) => void
  onComment?: (selectedText: string, from: number, to: number) => void
  comments?: Comment[]
  editorRef?: React.MutableRefObject<any>
  onCommentHover?: (commentId: string | null) => void
  onCommentClick?: (commentId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setActiveEditor } = useEditorContext()
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({
        multicolor: true,
      }),
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content,
    editable: true, // Fully editable
    immediatelyRender: false, // Prevent SSR hydration mismatches
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none min-h-[20px]',
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          // Prevent React Flow from handling drag when clicking on editor
          event.stopPropagation()
          return false
        },
      },
    },
    onUpdate: ({ editor }) => {
      const newContent = editor.getHTML()
      const hasChanged = newContent !== originalContent
      if (onHasChangesChange) {
        onHasChangesChange(hasChanged)
      }
      if (onContentChange) {
        onContentChange(newContent)
      }
    },
    onFocus: () => {
      // Register this editor as active when focused
      if (editor) {
        setActiveEditor(editor)
      }
    },
    onBlur: () => {
      // Clear active editor when blurred (optional - keep it active for toolbar)
      // setActiveEditor(null)
    },
  })

  // Register editor on mount and cleanup on unmount
  useEffect(() => {
    if (editor) {
      setActiveEditor(editor)
      if (editorRef) {
        editorRef.current = editor
      }
      return () => {
        setActiveEditor(null)
        if (editorRef) {
          editorRef.current = null
        }
      }
    }
  }, [editor, setActiveEditor, editorRef])

  // Apply blue highlights to commented text when comments change
  useEffect(() => {
    if (!editor || comments.length === 0) return

    // Apply blue highlight to all commented text ranges using transaction
    const tr = editor.state.tr
    
    comments.forEach((comment) => {
      try {
        const { from, to } = comment
        if (from >= 0 && to <= editor.state.doc.content.size && from < to) {
          // Remove all existing highlight marks (including yellow) and apply blue highlight
          tr.removeMark(from, to, editor.schema.marks.highlight)
          const blueHighlight = editor.schema.marks.highlight.create({ color: '#dbeafe' }) // blue-100 - slightly darker than blue-50
          tr.addMark(from, to, blueHighlight)
          // Debug: log to verify the mark attributes
          console.log('Blue highlight mark attributes:', blueHighlight.attrs)
        }
      } catch (error) {
        console.error('Error applying comment highlight:', error)
      }
    })
    
    // Dispatch the transaction if there are any changes
    if (tr.steps.length > 0) {
      editor.view.dispatch(tr)
    }
  }, [editor, comments]) // Only depend on editor and comments, not content (content sync handles it)

  // Detect when cursor is inside commented text and show/select comment
  // Only works when comments are already visible (showComments is true)
  useEffect(() => {
    if (!editor || !onCommentHover || comments.length === 0) return

    const handleSelectionUpdate = () => {
      try {
        const { from } = editor.state.selection
        
        // Check if cursor is within any comment's range
        const commentAtCursor = comments.find(comment => {
          try {
            return from >= comment.from && from <= comment.to
          } catch (error) {
            return false
          }
        })
        
        if (commentAtCursor) {
          onCommentHover(commentAtCursor.id)
        } else {
          onCommentHover(null)
        }
      } catch (error) {
        // Ignore errors in selection handling
      }
    }

    // Listen to selection changes - use 'update' event which fires on any editor change including selection
    editor.on('update', handleSelectionUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)
    
    // Also check on mount and when editor becomes available
    handleSelectionUpdate()

    return () => {
      editor.off('update', handleSelectionUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, comments, onCommentHover])

  // Handle clicks on commented text to show/select comment
  useEffect(() => {
    if (!editor || comments.length === 0 || !onCommentClick) return

    const handleClick = (event: MouseEvent) => {
      try {
        const { from } = editor.state.selection
        
        // Check if click is within any comment's range
        const commentAtClick = comments.find(comment => {
          try {
            return from >= comment.from && from <= comment.to
          } catch (error) {
            return false
          }
        })
        
        if (commentAtClick && onCommentClick) {
          // Show comments if hidden, and select the clicked comment
          onCommentClick(commentAtClick.id)
        }
      } catch (error) {
        // Ignore errors
      }
    }

    // Listen to clicks on the editor
    const editorDom = editor.view.dom
    editorDom.addEventListener('click', handleClick)

    return () => {
      editorDom.removeEventListener('click', handleClick)
    }
  }, [editor, comments, onCommentClick])

  useEffect(() => {
    if (editor) {
      const currentContent = editor.getHTML()
      // Always sync content, even if empty (to clear editor when content is removed)
      if (currentContent !== content) {
        editor.commands.setContent(content || '<p></p>')
        // Re-apply comment highlights after content is set
        if (comments.length > 0) {
          setTimeout(() => {
            const tr = editor.state.tr
            comments.forEach((comment) => {
              try {
                const { from, to } = comment
                if (from >= 0 && to <= editor.state.doc.content.size && from < to) {
                  // Remove all existing highlight marks (including yellow) and apply blue highlight
                  tr.removeMark(from, to, editor.schema.marks.highlight)
                  tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' })) // blue-100 - slightly darker than blue-50
                }
              } catch (error) {
                console.error('Error applying comment highlight:', error)
              }
            })
            // Dispatch the transaction if there are any changes
            if (tr.steps.length > 0) {
              editor.view.dispatch(tr)
            }
          }, 0)
        }
      }
    }
  }, [editor, content, comments])

  // Reposition extension UI elements (like Grammarly) when panel moves
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new MutationObserver(() => {
      // Find and reposition extension UI elements
      const extensionElements = containerRef.current?.querySelectorAll('[data-grammarly-shadow-root], [id^="grammarly-"], [class*="grammarly"]')
      extensionElements?.forEach((el) => {
        const htmlEl = el as HTMLElement
        // Extension elements are typically positioned absolutely or fixed
        // We can't directly control them, but we can ensure the container is positioned correctly
      })
    })

    if (containerRef.current) {
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      })
    }

    return () => observer.disconnect()
  }, [containerRef])

  if (!editor) return null

  return (
    <div 
      ref={containerRef} 
      className={cn('relative cursor-text', className)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state }) => {
          const { from, to } = state.selection
          return from !== to && editor.state.doc.textBetween(from, to).trim().length > 0
        }}
        options={{
          placement: 'right',
          offset: [12, 0], // 12px offset to the right, 0 vertical offset (centered)
          getReferenceClientRect: () => {
            // Get the selection's bounding rect
            const { from, to } = editor.state.selection
            const coords = editor.view.coordsAtPos(from)
            const coordsEnd = editor.view.coordsAtPos(to)
            
            // Find the panel container (parent with panel styling)
            const panelElement = containerRef.current?.closest('.bg-white.rounded-xl') as HTMLElement
            if (!panelElement) {
              // Fallback: use selection end position if panel not found
              const centerY = (coords.top + coordsEnd.bottom) / 2
              return {
                top: centerY - 16,
                bottom: centerY + 16,
                left: coordsEnd.right,
                right: coordsEnd.right,
                width: 0,
                height: 32,
                x: coordsEnd.right,
                y: centerY - 16,
              } as DOMRect
            }
            
            // Get panel's right edge
            const panelRect = panelElement.getBoundingClientRect()
            const panelRight = panelRect.right
            
            // Calculate the center Y of the selection
            const centerY = (coords.top + coordsEnd.bottom) / 2
            
            // Return a rect positioned at the panel's right edge, centered on selection
            return {
              top: centerY - 16, // Center the popup (popup is ~32px tall)
              bottom: centerY + 16,
              left: panelRight,
              right: panelRight,
              width: 0,
              height: 32,
              x: panelRight,
              y: centerY - 16,
            } as DOMRect
          },
        }}
      >
        <div className="bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run()}
            className="h-8 w-8 p-0"
            title="Highlight"
          >
            <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
          {onComment && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const { from, to } = editor.state.selection
                const selectedText = editor.state.doc.textBetween(from, to)
                if (selectedText.trim()) {
                  onComment(selectedText, from, to)
                }
              }}
              className="h-8 w-8 p-0"
              title="Add comment"
            >
              <MessageSquare className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </Button>
          )}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  )
}

export function ChatPanelNode({ data, selected, id }: NodeProps<ChatPanelNodeData>) {
  const { promptMessage, responseMessage, conversationId, isResponseCollapsed: dataCollapsed } = data
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { reactFlowInstance, panelWidth, getSetNodes } = useReactFlowContext() // Get zoom, panel width, and setNodes function
  const [promptHasChanges, setPromptHasChanges] = useState(false)
  const [responseHasChanges, setResponseHasChanges] = useState(false)
  const [promptContent, setPromptContent] = useState(promptMessage.content)
  const [responseContent, setResponseContent] = useState(responseMessage?.content || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isResponseCollapsed, setIsResponseCollapsed] = useState(dataCollapsed || false) // Track if response is collapsed
  const [comments, setComments] = useState<Comment[]>([]) // Store all comments for this panel
  const [showComments, setShowComments] = useState(false) // Toggle comment panels visibility
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null) // Track which comment is selected
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({}) // Reply input text per comment
  const [newCommentData, setNewCommentData] = useState<{
    selectedText: string
    from: number
    to: number
    section: 'prompt' | 'response'
  } | null>(null) // Track new comment data (selected text and position)
  const [newCommentText, setNewCommentText] = useState('') // New comment input text
  const panelRef = useRef<HTMLDivElement>(null) // Ref to panel container for positioning comment box
  const commentPanelsRef = useRef<HTMLDivElement>(null) // Ref to comment panels container for click-away detection
  const promptEditorRef = useRef<any>(null) // Ref to prompt editor instance
  const responseEditorRef = useRef<any>(null) // Ref to response editor instance
  const newCommentTextareaRef = useRef<HTMLTextAreaElement>(null) // Ref for new comment textarea
  const replyTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({}) // Refs for reply textareas
  
  // Handle click away from comment panels to deselect
  useEffect(() => {
    if (!showComments || !selectedCommentId) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      
      // Don't deselect if clicking on comment panels
      if (commentPanelsRef.current && commentPanelsRef.current.contains(target)) {
        return
      }
      
      // Check if clicking on highlighted commented text in editors
      const promptEditor = promptEditorRef.current
      const responseEditor = responseEditorRef.current
      
      let isClickOnCommentedText = false
      
      if (promptEditor && promptEditor.view.dom.contains(target)) {
        try {
          const pos = promptEditor.view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (pos) {
            isClickOnCommentedText = comments.some(c => c.section === 'prompt' && pos.pos >= c.from && pos.pos <= c.to)
          }
        } catch {
          // Ignore errors
        }
      }
      
      if (!isClickOnCommentedText && responseEditor && responseEditor.view.dom.contains(target)) {
        try {
          const pos = responseEditor.view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (pos) {
            isClickOnCommentedText = comments.some(c => c.section === 'response' && pos.pos >= c.from && pos.pos <= c.to)
          }
        } catch {
          // Ignore errors
        }
      }
      
      // If clicking on commented text, don't deselect
      if (isClickOnCommentedText) {
        return
      }
      
      // Otherwise, deselect immediately (clicking anywhere else - outside comment panels and not on commented text)
      setTimeout(() => { setSelectedCommentId(null) }, 0)
    }

    // Use capture phase and add immediately (no timeout)
    document.addEventListener('mousedown', handleClickOutside, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [showComments, selectedCommentId, comments])
  
  // Sync with data prop
  useEffect(() => {
    if (dataCollapsed !== undefined) {
      setIsResponseCollapsed(dataCollapsed)
    }
  }, [dataCollapsed])
  
  // Update node data when collapse state changes
  const handleCollapseChange = useCallback((collapsed: boolean) => {
    setIsResponseCollapsed(collapsed)
    const setNodes = getSetNodes()
    if (setNodes && reactFlowInstance) {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, isResponseCollapsed: collapsed } }
            : node
        )
      )
    }
  }, [id, getSetNodes, reactFlowInstance])

  // Handle comment creation from text selection
  const handleComment = useCallback((selectedText: string, from: number, to: number, section: 'prompt' | 'response') => {
    setNewCommentData({ selectedText, from, to, section })
    setNewCommentText('') // Reset comment text
  }, [])

  // Save new comment
  const handleSaveComment = useCallback(() => {
    if (!newCommentData || !newCommentText.trim()) return
    
    // Get the appropriate editor (prompt or response)
    const editor = newCommentData.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current
    
    // Remove any existing highlight (yellow) and apply blue highlight
    if (editor) {
      try {
        const { from, to } = newCommentData
        // Use transaction to remove all highlight marks and apply blue
        const tr = editor.state.tr
        // Remove all highlight marks in the range
        tr.removeMark(from, to, editor.schema.marks.highlight)
        // Add blue highlight mark using blue-100 - slightly darker than blue-50
        tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' }))
        editor.view.dispatch(tr)
      } catch (error) {
        console.error('Error applying blue highlight to commented text:', error)
      }
    }
    
    const newComment: Comment = {
      id: `comment-${Date.now()}-${Math.random()}`,
      selectedText: newCommentData.selectedText,
      from: newCommentData.from,
      to: newCommentData.to,
      section: newCommentData.section,
      comment: newCommentText.trim(),
      createdAt: new Date().toISOString(),
    }
    
    setComments(prev => [...prev, newComment])
    setNewCommentData(null)
    setNewCommentText('')
    setShowComments(true) // Show comments after creating one
  }, [newCommentData, newCommentText])

  // Get comment count
  const commentCount = comments.length

  // Auto-resize new comment textarea to maintain pill shape
  useEffect(() => {
    if (newCommentTextareaRef.current) {
      // Reset to base state for measurement
      newCommentTextareaRef.current.style.height = '52px'
      newCommentTextareaRef.current.style.lineHeight = '52px'
      newCommentTextareaRef.current.style.paddingTop = '0px'
      newCommentTextareaRef.current.style.paddingBottom = '0px'
      
      // Check if content fits in one line (pill shape)
      const scrollHeight = newCommentTextareaRef.current.scrollHeight
      const fitsInOneLine = scrollHeight <= 52
      
      if (fitsInOneLine) {
        // Content fits in one line - keep pill shape
        newCommentTextareaRef.current.style.height = '52px'
        newCommentTextareaRef.current.style.lineHeight = '52px' // Match height exactly for perfect pill
        newCommentTextareaRef.current.style.paddingTop = '0px' // No padding to maintain pill shape
        newCommentTextareaRef.current.style.paddingBottom = '0px' // No padding to maintain pill shape
        newCommentTextareaRef.current.style.overflow = 'hidden'
      } else {
        // Content needs multiple lines - expand naturally
        newCommentTextareaRef.current.style.height = 'auto'
        newCommentTextareaRef.current.style.lineHeight = '1.4'
        newCommentTextareaRef.current.style.paddingTop = '13px' // Add padding when expanded
        newCommentTextareaRef.current.style.paddingBottom = '13px' // Add padding when expanded
        const expandedHeight = newCommentTextareaRef.current.scrollHeight
        newCommentTextareaRef.current.style.height = `${expandedHeight}px`
        newCommentTextareaRef.current.style.overflow = 'auto'
      }
    }
  }, [newCommentText])

  // Auto-resize reply textareas to maintain pill shape
  useEffect(() => {
    Object.entries(replyTextareaRefs.current).forEach(([commentId, textarea]) => {
      if (textarea) {
        // Reset to base state for measurement
        textarea.style.height = '52px'
        textarea.style.lineHeight = '52px'
        textarea.style.paddingTop = '0px'
        textarea.style.paddingBottom = '0px'
        
        // Check if content fits in one line (pill shape)
        const scrollHeight = textarea.scrollHeight
        const fitsInOneLine = scrollHeight <= 52
        
        if (fitsInOneLine) {
          // Content fits in one line - keep pill shape
          textarea.style.height = '52px'
          textarea.style.lineHeight = '52px' // Match height exactly for perfect pill
          textarea.style.paddingTop = '0px' // No padding to maintain pill shape
          textarea.style.paddingBottom = '0px' // No padding to maintain pill shape
          textarea.style.overflow = 'hidden'
        } else {
          // Content needs multiple lines - expand naturally
          textarea.style.height = 'auto'
          textarea.style.lineHeight = '1.4'
          textarea.style.paddingTop = '13px' // Add padding when expanded
          textarea.style.paddingBottom = '13px' // Add padding when expanded
          const expandedHeight = textarea.scrollHeight
          textarea.style.height = `${expandedHeight}px`
          textarea.style.overflow = 'auto'
        }
      }
    })
  }, [replyTexts])
  
  // Get current zoom level and update panel width when zoom is 100% or less
  const [currentZoom, setCurrentZoom] = useState(reactFlowInstance?.getViewport().zoom ?? 1)
  const [panelWidthToUse, setPanelWidthToUse] = useState(768)
  
  // Continuously check zoom level and update panel width
  useEffect(() => {
    if (!reactFlowInstance) return
    
    const updateZoomAndWidth = () => {
      const zoom = reactFlowInstance.getViewport().zoom
      setCurrentZoom(zoom)
      
      // Use dynamic width when:
      // 1. Zoom is 100% or less (<= 1.0)
      // 2. AND panel width (768px) is >= prompt box width (so panels can shrink with prompt box)
      // This allows panels to shrink with prompt box when zoomed out or at 100%
      if (zoom <= 1.0 && panelWidth > 0) {
        // Use the smaller of panelWidth (from prompt box) or 768 (default)
        // This ensures panels shrink when prompt box shrinks, but don't exceed 768px
        setPanelWidthToUse(Math.min(panelWidth, 768))
      } else {
        setPanelWidthToUse(768)
      }
    }
    
    // Initial update
    updateZoomAndWidth()
    
    // Update periodically to catch zoom changes
    const interval = setInterval(updateZoomAndWidth, 100)
    
    return () => clearInterval(interval)
  }, [reactFlowInstance, panelWidth])

  // Sync promptContent when promptMessage changes
  useEffect(() => {
    if (promptMessage.content !== promptContent && !promptHasChanges) {
      setPromptContent(promptMessage.content)
    }
  }, [promptMessage.content, promptContent, promptHasChanges])

  // Sync responseContent when responseMessage changes (e.g., when AI response loads)
  useEffect(() => {
    if (responseMessage && responseMessage.content) {
      const newContent = responseMessage.content
      // Always update if content changed, unless user has manually edited it
      if (newContent !== responseContent && !responseHasChanges) {
        // If content is already HTML, use it directly; otherwise format it
        const formattedContent = formatResponseContent(newContent)
        setResponseContent(formattedContent)
      }
    } else if (!responseMessage) {
      // If responseMessage becomes undefined, clear content
      setResponseContent('')
    }
  }, [responseMessage?.id, responseMessage?.content, responseContent, responseHasChanges]) // Use responseMessage.id to detect when a new message is added

  const handlePromptChange = async (newContent: string) => {
    setPromptContent(newContent)
    // Update message in database
    const { error } = await supabase
      .from('messages')
      .update({ content: newContent })
      .eq('id', promptMessage.id)

    if (error) {
      console.error('Error updating prompt:', error)
    }
  }

  const handlePromptRevert = async () => {
    // Revert to original content
    setPromptContent(promptMessage.content)
    setPromptHasChanges(false)
    
    // Update in database
    const { error } = await supabase
      .from('messages')
      .update({ content: promptMessage.content })
      .eq('id', promptMessage.id)

    if (error) {
      console.error('Error reverting prompt:', error)
    }
  }

  const handleResponseChange = async (newContent: string) => {
    if (!responseMessage) return
    
    setResponseContent(newContent)
    // Update message in database
    const { error } = await supabase
      .from('messages')
      .update({ content: newContent })
      .eq('id', responseMessage.id)

    if (error) {
      console.error('Error updating response:', error)
    }
  }

  const handleResponseRevert = async () => {
    if (!responseMessage) return
    
    // Revert to original content
    setResponseContent(responseMessage.content)
    setResponseHasChanges(false)
    
    // Update in database
    const { error } = await supabase
      .from('messages')
      .update({ content: responseMessage.content })
      .eq('id', responseMessage.id)

    if (error) {
      console.error('Error reverting response:', error)
    }
  }

  const handleDeletePanel = async () => {
    if (isDeleting) return
    
    setIsDeleting(true)
    try {
      // Delete both prompt and response messages if they exist
      const messageIds = [promptMessage.id]
      if (responseMessage) {
        messageIds.push(responseMessage.id)
      }

      // Delete messages from database
      const { error } = await supabase
        .from('messages')
        .delete()
        .in('id', messageIds)

      if (error) {
        throw new Error(error.message || 'Failed to delete panel')
      }

      // Invalidate queries to refresh the board
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      
      // Trigger refetch
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', conversationId] })
      }, 200)
    } catch (error: any) {
      console.error('Failed to delete panel:', error)
      alert(error.message || 'Failed to delete panel. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        'bg-white dark:bg-[#171717] rounded-xl shadow-sm border relative cursor-grab active:cursor-grabbing',
        selected ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-[#2f2f2f]'
      )}
      style={{ width: `${panelWidthToUse}px` }}
    >
      <Handle 
        type="target" 
        position={Position.Left}
        id="left"
        isConnectable={true}
        className={cn(
          'handle-dot',
          selected ? 'handle-dot-selected' : 'handle-dot-default'
        )}
        style={{
          width: '8px',
          height: '8px',
          background: selected ? '#9ca3af' : '#e5e7eb',
          border: '1px solid white',
        }}
      />
      
      {/* Prompt section at top */}
      {/* Show border and shadow whenever there's a response section (loading or loaded) */}
      <div 
        className={cn(
          "p-4 bg-gray-50 dark:bg-[#1f1f1f] pb-12 relative",
          // Always show border and shadow when response section is rendered (always rendered, either loading or with content)
          "rounded-t-xl",
          // Show bottom border and shadow when response is expanded (not collapsed)
          !isResponseCollapsed && "border-b border-gray-200 dark:border-[#2f2f2f] shadow-sm",
          // When response is collapsed, show rounded bottom corners
          isResponseCollapsed && "rounded-b-xl"
        )}
      >
        <TipTapContent 
          content={promptContent}
          className="text-gray-900 dark:text-gray-100"
          originalContent={promptMessage.content}
          onContentChange={handlePromptChange}
          onHasChangesChange={setPromptHasChanges}
          onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
          comments={comments.filter(c => c.section === 'prompt')}
          editorRef={promptEditorRef}
          onCommentHover={(commentId) => {
            if (commentId) {
              // Only auto-select if comments are already visible
              // Comments should be shown by clicking on commented text, not by cursor movement
              if (showComments) {
                setSelectedCommentId(commentId)
              } else {
                // If comments are hidden, clear selection
                setSelectedCommentId(null)
              }
            } else {
              // Cursor moved away from commented text - don't deselect automatically
              // Only deselect on click away or toggle button
            }
          }}
          onCommentClick={(commentId) => {
            // When commented text is clicked, show comments and select the comment
            if (commentId) {
              setShowComments(true)
              setSelectedCommentId(commentId)
            }
          }}
        />
        {promptHasChanges && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePromptRevert}
              className="text-xs h-7"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Revert to original
            </Button>
          </div>
        )}
        
        {/* Prompt action buttons - Copy and More menu at bottom left, Comment icon at bottom right */}
        <div className="absolute bottom-2 left-2 flex items-center gap-2 z-10">
          {/* Copy button - two overlapping squares */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              // Copy just the prompt content
              navigator.clipboard.writeText(promptContent)
            }}
            title="Copy prompt"
          >
            <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
          
          {/* More menu button - horizontal ellipsis */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeletePanel()
                }}
                disabled={isDeleting}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Collapse/Expand caret button - shown in prompt area when response is collapsed */}
          {isResponseCollapsed && responseMessage && responseMessage.content && responseMessage.content.trim() && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              handleCollapseChange(false)
            }}
            title="Show response"
          >
            <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
          )}
        </div>

        {/* Comment icon button - far right of prompt area */}
        <div className="absolute bottom-2 right-2 z-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 relative"
            onClick={(e) => {
              e.stopPropagation()
              // Always hide comments when toggle is clicked, regardless of cursor position
              if (showComments) {
                setShowComments(false)
                setSelectedCommentId(null) // Deselect any selected comment
              } else {
                setShowComments(true)
              }
            }}
            title={showComments ? 'Hide comments' : 'Show comments'}
          >
            <MessageSquare className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            {commentCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-white dark:bg-[#171717] text-gray-600 dark:text-gray-300 text-xs rounded-full h-5 w-5 flex items-center justify-center border border-gray-200 dark:border-[#2f2f2f]">
                {commentCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Response section below - always show when there's a prompt */}
      {responseMessage && responseMessage.content && responseMessage.content.trim() ? (
        <div 
          className={cn(
            "p-4 bg-white dark:bg-[#171717] rounded-b-xl pb-12 relative transition-all duration-200 overflow-hidden",
            isResponseCollapsed && "h-0 p-0 opacity-0"
          )}
          style={{ lineHeight: '1.7' }}
        >
          <TipTapContent 
            key={`response-${responseMessage.id}`} // Force re-render when message ID changes
            content={responseContent || responseMessage.content || ''}
            className="text-gray-700 dark:text-gray-100"
            originalContent={responseMessage.content || ''}
            onContentChange={handleResponseChange}
            onHasChangesChange={setResponseHasChanges}
            onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'response')}
            comments={comments.filter(c => c.section === 'response')}
            editorRef={responseEditorRef}
            onCommentHover={(commentId) => {
              if (commentId) {
                // Only auto-select if comments are already visible
                // Comments should be shown by clicking on commented text, not by cursor movement
                if (showComments) {
                  setSelectedCommentId(commentId)
                } else {
                  // If comments are hidden, clear selection
                  setSelectedCommentId(null)
                }
              } else {
                // Cursor moved away from commented text - don't deselect automatically
                // Only deselect on click away or toggle button
              }
            }}
            onCommentClick={(commentId) => {
              // When commented text is clicked, show comments and select the comment
              if (commentId) {
                setShowComments(true)
                setSelectedCommentId(commentId)
              }
            }}
          />
          {responseHasChanges && (
            <div className="mt-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResponseRevert}
                className="text-xs h-7"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert to original
              </Button>
            </div>
          )}
        </div>
      ) : (
        // Loading state - show spinner while waiting for AI response
        // Show when: no responseMessage, or responseMessage exists but has no content yet
        <div className="p-4 bg-white dark:bg-[#171717] rounded-b-xl flex items-center justify-center min-h-[100px]">
          <Loader2 className="h-6 w-6 text-gray-400 dark:text-gray-500 animate-spin" />
        </div>
      )}

      {/* Bottom action buttons - Copy and More menu at bottom left - only show when response is loaded and not collapsed */}
      {responseMessage && responseMessage.content && responseMessage.content.trim() && !isResponseCollapsed && (
        <div className="absolute bottom-2 left-2 flex items-center gap-2 z-10">
          {/* Copy button - two overlapping squares */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              // Copy the full panel content (prompt + response)
              const fullContent = `${promptContent}\n\n${responseContent || ''}`.trim()
              navigator.clipboard.writeText(fullContent)
            }}
            title="Copy panel content"
          >
            <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
          
          {/* More menu button - horizontal ellipsis */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeletePanel()
                }}
                disabled={isDeleting}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Collapse caret button - shown in response area when expanded */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              handleCollapseChange(true)
            }}
            title="Hide response"
          >
            <ChevronUp className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
        </div>
      )}

      <Handle 
        type="source" 
        position={Position.Right}
        id="right"
        className={cn(
          'handle-dot',
          selected ? 'handle-dot-selected' : 'handle-dot-default'
        )}
        style={{
          width: '8px',
          height: '8px',
          background: selected ? '#9ca3af' : '#e5e7eb',
          border: '1px solid white',
        }}
      />

      {/* New comment box - appears to the right when creating a comment */}
      {newCommentData && (
        <div
          className="absolute left-full ml-4 top-0 w-64 bg-white dark:bg-[#171717] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] z-30"
        >
          <div className="p-3 flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setNewCommentData(null)}
            >
              <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </Button>
          </div>
          <div className="p-3 pt-0">
            <Textarea
              ref={newCommentTextareaRef}
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="text-sm resize-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
              style={{
                borderRadius: '26px', // Always pill shape - fully rounded sides
                minHeight: '52px', // Minimum height (2x corner radius) - ensures fully rounded sides at default
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '0px', // No top padding to maintain pill shape (will be adjusted by useEffect)
                paddingBottom: '0px', // No bottom padding to maintain pill shape (will be adjusted by useEffect)
                boxSizing: 'border-box',
                // Height and padding will be adjusted by useEffect to maintain pill shape
              }}
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNewCommentData(null)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveComment}
                disabled={!newCommentText.trim()}
                className="text-xs rounded-full"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Comment panels - appear to the right, vertically aligned with highlighted text */}
      {showComments && comments.length > 0 && (
        <div ref={commentPanelsRef}>
          {comments.map((comment) => {
            // Calculate vertical position based on text position in editor
            const editor = comment.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current
            let topPosition = 0
            
            if (editor && panelRef.current) {
              try {
                const coords = editor.view.coordsAtPos(comment.from)
                const panelRect = panelRef.current.getBoundingClientRect()
                if (panelRect && coords) {
                  // Calculate position relative to panel top
                  topPosition = coords.top - panelRect.top + (coords.bottom - coords.top) / 2 // Center of selection
                }
              } catch (error) {
                console.error('Error calculating comment position:', error)
              }
            }
            
            const isSelected = selectedCommentId === comment.id
            
            return (
              <CommentPanel
                key={comment.id}
                comment={comment}
                isSelected={isSelected}
                topPosition={topPosition}
                onSelect={() => {
                  const newSelectedId = isSelected ? null : comment.id
                  setSelectedCommentId(newSelectedId)
                  // Clear reply text when deselecting
                  if (!newSelectedId && replyTexts[comment.id]) {
                    setReplyTexts(prev => {
                      const updated = { ...prev }
                      delete updated[comment.id]
                      return updated
                    })
                  }
                }}
                onDelete={() => {
                  setComments(prev => prev.filter(c => c.id !== comment.id))
                  if (selectedCommentId === comment.id) {
                    setSelectedCommentId(null)
                  }
                }}
                replyText={replyTexts[comment.id] || ''}
                onReplyChange={(text) => setReplyTexts(prev => ({ ...prev, [comment.id]: text }))}
                replyTextareaRef={(el) => {
                  if (el) {
                    replyTextareaRefs.current[comment.id] = el
                  } else {
                    delete replyTextareaRefs.current[comment.id]
                  }
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// Separate component for comment panel to manage hover state
function CommentPanel({
  comment,
  isSelected,
  topPosition,
  onSelect,
  onDelete,
  replyText,
  onReplyChange,
  replyTextareaRef
}: {
  comment: Comment
  isSelected: boolean
  topPosition: number
  onSelect: () => void
  onDelete: () => void
  replyText: string
  onReplyChange: (text: string) => void
  replyTextareaRef: (el: HTMLTextAreaElement | null) => void
}) {
  const [isHovering, setIsHovering] = useState(false)
  
  return (
    <div
      className={cn(
        "absolute left-full ml-4 w-64 rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] z-30 cursor-pointer transition-colors",
        isSelected 
          ? "bg-white dark:bg-[#171717]" 
          : "bg-blue-50 dark:bg-[#2a2a3a]"
      )}
      style={{
        top: `${topPosition}px`,
        transform: 'translateY(-50%)', // Center vertically with highlighted text
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={(e) => {
        // Stop propagation to prevent click-away from firing when clicking on the panel
        e.stopPropagation()
        // Only handle clicks on the panel itself, not on child elements
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.p-3')) {
          onSelect()
        }
      }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 text-sm text-gray-700 dark:text-gray-300 break-words min-w-0">
            {comment.comment}
          </div>
          {/* More menu button - only show on hover when not selected (condensed version), always show when selected */}
          {((!isSelected && isHovering) || isSelected) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
                  
        {/* Reply input box - only shown when comment is selected */}
        {isSelected && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#2f2f2f]">
            <Textarea
              ref={replyTextareaRef}
              value={replyText}
              onChange={(e) => onReplyChange(e.target.value)}
              placeholder="Reply or add others with @"
              className="w-full text-sm resize-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
              style={{
                borderRadius: '26px', // Always pill shape - fully rounded sides
                minHeight: '52px', // Minimum height (2x corner radius) - ensures fully rounded sides at default
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '0px', // No top padding to maintain pill shape (will be adjusted by useEffect)
                paddingBottom: '0px', // No bottom padding to maintain pill shape (will be adjusted by useEffect)
                boxSizing: 'border-box',
                // Height and padding will be adjusted by useEffect to maintain pill shape
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  )
}

