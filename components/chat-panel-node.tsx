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
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Highlighter, RotateCcw, MoreHorizontal, MoreVertical, Trash2, Copy, Loader2, ChevronDown, ChevronUp, MessageSquare, X, Smile, PenSquare, Bookmark, SquarePen, ChevronRight } from 'lucide-react'

// Helper to check if content is effectively empty (handling HTML tags)
const isContentEmpty = (content: string | undefined | null) => {
  if (!content) return true
  if (content === '<p></p>' || content === '<p><br></p>') return true
  // Also strip all tags to be sure
  const stripped = content.replace(/<[^>]*>/g, '').trim()
  return stripped.length === 0
}

// Helper to blend a foreground hex color with a background hex color using opacity
const blendHexColors = (fgHex: string, bgHex: string, opacity: number): string => {
  // Simple hex parsing (assumes 6-digit hex)
  const parse = (hex: string) => {
    const clean = hex.replace('#', '')
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16)
    }
  }

  const fg = parse(fgHex)
  const bg = parse(bgHex)

  const blend = (c1: number, c2: number) => Math.round(c1 * opacity + c2 * (1 - opacity))

  const r = blend(fg.r, bg.r).toString(16).padStart(2, '0')
  const g = blend(fg.g, bg.g).toString(16).padStart(2, '0')
  const b = blend(fg.b, bg.b).toString(16).padStart(2, '0')

  return `#${r}${g}${b}`
}
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
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
import { useRouter } from 'next/navigation'
import { useEditorContext } from './editor-context'
import { useReactFlowContext } from './react-flow-context'
import { useTheme } from './theme-provider'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  metadata?: Record<string, any> // Optional metadata field
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

interface EmojiReaction {
  id: string
  selectedText: string
  from: number
  to: number
  section: 'prompt' | 'response'
  emoji: string
  count: number
  createdAt: string
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
  isResponseCollapsed?: boolean // Track if response is collapsed for position updates
  fillColor?: string // Panel fill color (optional, defaults to transparent)
  borderColor?: string // Panel border color (optional, defaults to theme-based)
  borderStyle?: string // Panel border style (solid, dashed, dotted)
  borderWeight?: string // Panel border thickness (1px, 2px, 4px)
}

interface ProjectBoardPanelNodeData {
  boardId: string
  boardTitle: string  // Used as "prompt"
  recentUserMessage?: Message  // Most recent user message as "response"
  projectId: string
  isResponseCollapsed?: boolean
  fillColor?: string // Panel fill color (optional, defaults to transparent)
  borderColor?: string // Panel border color (optional, defaults to theme-based)
  borderStyle?: string // Panel border style (solid, dashed, dotted)
  borderWeight?: string // Panel border thickness (1px, 2px, 4px)
}

// Union type for node data
type PanelNodeData = ChatPanelNodeData | ProjectBoardPanelNodeData

// Type guard to check if data is ProjectBoardPanelNodeData
function isProjectBoardData(data: PanelNodeData): data is ProjectBoardPanelNodeData {
  return 'boardId' in data && 'boardTitle' in data
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
  onCommentClick,
  onAddReaction,
  section,
  isFlashcard
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
  onAddReaction?: (selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => void
  section?: 'prompt' | 'response'
  isFlashcard?: boolean
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
      Placeholder.configure({
        placeholder: section === 'prompt' ? 'What are you trying to remember?' : 'Explain it clearly or let AI help',
        emptyNodeClass: 'is-editor-empty',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content,
    editable: true, // Fully editable
    immediatelyRender: false, // Prevent SSR hydration mismatches
    editorProps: {
      attributes: {
        class: cn(
          'prose max-w-none focus:outline-none min-h-[20px] cursor-text',
          isFlashcard && 'text-xl' // Increase font size for flashcards
        ),
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          // Prevent React Flow from handling drag when clicking on editor
          event.stopPropagation()
          // Focus editor on click to show cursor - access editor from view
          const editorInstance = view.state.doc ? (view as any).editor : null
          if (editorInstance && !editorInstance.isDestroyed) {
            setTimeout(() => {
              editorInstance.commands.focus()
              // Ensure cursor is visible by setting selection if empty
              const isEmpty = !editorInstance.getHTML() || editorInstance.getHTML() === '<p></p>' || editorInstance.getHTML() === '<p><br></p>'
              if (isEmpty) {
                editorInstance.commands.setTextSelection(0)
              }
            }, 0)
          }
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
      // Use empty paragraph to ensure cursor is always visible
      if (currentContent !== content) {
        editor.commands.setContent(content || '<p></p>')
        // Ensure cursor is visible by focusing if editor is empty
        if (!content || content.trim() === '' || content === '<p></p>') {
          // Set cursor position to start to show cursor
          setTimeout(() => {
            editor.commands.setTextSelection(0)
          }, 0)
        }
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

  // Focus editor when container is clicked to ensure cursor is visible
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (editor) {
      // Always focus editor on click to show cursor
      setTimeout(() => {
        if (!editor.isDestroyed) {
          editor.commands.focus()
          // If editor is empty or clicking on empty area, place cursor at end or appropriate position
          const isEmpty = !editor.getHTML() || editor.getHTML() === '<p></p>' || editor.getHTML() === '<p><br></p>'
          if (isEmpty) {
            // Place cursor at the start
            editor.commands.setTextSelection(0)
          } else {
            // Try to place cursor at click position, or at end if that fails
            try {
              const { from } = editor.state.selection
              // If selection is at start and editor has content, move to end
              if (from === 0 && editor.state.doc.content.size > 1) {
                editor.commands.setTextSelection(editor.state.doc.content.size - 1)
              }
            } catch {
              // Fallback: place cursor at end
              editor.commands.setTextSelection(editor.state.doc.content.size - 1)
            }
          }
        }
      }, 0)
    }
  }, [editor])

  if (!editor) return null

  // Extract 'inline' from className if present to apply inline-block display
  const isInline = className?.includes('inline')
  const otherClasses = className?.replace(/\binline\b/g, '').trim()

  return (
    <div
      ref={containerRef}
      className={cn('relative cursor-text', isInline && 'inline-block', otherClasses)}
      onMouseDown={handleContainerClick}
      onClick={handleContainerClick}
    >
      {/* BubbleMenu for highlighter only - keeps existing TipTap popup */}
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state }) => {
          const { from, to } = state.selection
          return from !== to && editor.state.doc.textBetween(from, to).trim().length > 0
        }}
        options={{
          placement: 'top',
          offset: [0, 8] as [number, number],
          zIndex: 20, // Ensure it's above prompt panel (z-10)
        } as any}
      >
        <div className="bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2 flex items-center gap-1 z-20 relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run()}
            className="h-8 w-8 p-0"
            title="Highlight"
          >
            <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
        </div>
      </BubbleMenu>

      {/* Comment button popup - separate vertical pill on right edge, rendered by app */}
      {onComment && (
        <CommentButtonPopup
          editor={editor}
          containerRef={containerRef}
          onComment={onComment}
          onAddReaction={onAddReaction}
          section={section}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

// Response panel buttons when collapsed - positioned at bottom-left of prompt panel (same as response panel)
function ResponseButtonsWhenCollapsed({
  promptContent,
  responseContent,
  onDelete,
  isDeleting,
  onExpand,
  onBookmark,
  isBookmarked,
  isProjectBoard,
  boardId,
}: {
  promptContent: string
  responseContent: string
  onDelete: () => void
  isDeleting: boolean
  onExpand: () => void
  onBookmark: () => void
  isBookmarked: boolean
  isProjectBoard?: boolean
  boardId?: string
}) {
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(false)

  // Fade in buttons when component mounts
  useEffect(() => {
    // Small delay to ensure smooth fade-in after collapse animation starts
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={cn(
      "absolute bottom-2 left-4 flex items-center gap-2 z-10 transition-opacity duration-500",
      isVisible ? "opacity-100" : "opacity-0"
    )}>
      {/* Copy button - copies prompt content when collapsed */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={(e) => {
          e.stopPropagation()
          // Copy prompt content when panel is collapsed
          navigator.clipboard.writeText(promptContent || '')
        }}
        title="Copy prompt"
      >
        <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
      </Button>

      {/* More menu button - moved from response panel when collapsed - show for all panels */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded hover:bg-white dark:hover:bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              // Copy the full panel content (prompt + response)
              const fullContent = `${promptContent}\n\n${responseContent || ''}`.trim()
              navigator.clipboard.writeText(fullContent)
            }}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy panel
          </DropdownMenuItem>
          {!isProjectBoard && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onBookmark()
              }}
            >
              <Bookmark className={cn("h-4 w-4 mr-2", isBookmarked && "fill-yellow-400 text-yellow-400")} />
              Bookmark
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            disabled={isDeleting}
            className="text-red-600 focus:text-red-600 focus:bg-red-50"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Expand caret button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
        title="Show response"
      >
        <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-300" />
      </Button>

      {/* Forward icon button - only for project boards, positioned to the right of karot */}
      {isProjectBoard && boardId && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={(e) => {
            e.stopPropagation()
            // Navigate to the board
            router.push(`/board/${boardId}`)
          }}
          title="Open board"
        >
          <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </Button>
      )}
    </div>
  )
}

// Separate comment button popup component - tracks selection and shows vertical pill on right edge
function CommentButtonPopup({
  editor,
  containerRef,
  onComment,
  onAddReaction,
  section,
}: {
  editor: any
  containerRef: React.RefObject<HTMLDivElement>
  onComment: (selectedText: string, from: number, to: number) => void
  onAddReaction?: (selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => void
  section?: 'prompt' | 'response'
}) {
  const [showPopup, setShowPopup] = useState(false)
  const [popupPosition, setPopupPosition] = useState({ top: 0, right: 0 })
  const [zoom, setZoom] = useState(1)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false) // Track if emoji picker is open
  const popupRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null) // Ref for emoji picker popup
  const panelContainerRef = useRef<HTMLElement | null>(null)
  const { reactFlowInstance } = useReactFlowContext()

  useEffect(() => {
    if (!editor || !containerRef.current) return

    const updatePopupPosition = () => {
      // If emoji picker is open, keep popup open even if selection changes
      // This prevents the popup from closing when clicking in the emoji picker search bar
      if (showEmojiPicker && showPopup) {
        return // Don't update position or close if emoji picker is open
      }

      // Check if there's a valid selection (don't require focus - show popup whenever text is selected)
      const { from, to } = editor.state.selection

      // Check if there's a valid selection
      if (from === to) {
        setShowPopup(false)
        return
      }

      const selectedText = editor.state.doc.textBetween(from, to).trim()
      if (!selectedText) {
        setShowPopup(false)
        return
      }

      // CRITICAL: Only show popup if this editor is focused OR if there's a valid selection
      // This allows the popup to show when text is selected, even if editor doesn't have focus
      // But prefer the focused editor if multiple editors have selections
      const isFocused = editor.view.hasFocus()
      if (!isFocused) {
        // If not focused, check if there's another editor with focus that has a selection
        // If so, don't show this popup (let the focused one show)
        // Otherwise, show this popup even without focus
        const allEditors = document.querySelectorAll('.ProseMirror')
        let hasFocusedEditorWithSelection = false
        for (const editorEl of allEditors) {
          if (editorEl === editor.view.dom) continue // Skip this editor
          // Check if this editor element is focused
          if (editorEl === document.activeElement || editorEl.contains(document.activeElement)) {
            // This editor is focused - check if it has a selection
            const selection = window.getSelection()
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0)
              if (range.toString().trim().length > 0) {
                hasFocusedEditorWithSelection = true
                break
              }
            }
          }
        }
        // If another editor has focus with selection, don't show this popup
        if (hasFocusedEditorWithSelection) {
          setShowPopup(false)
          return
        }
      }

      // Find the panel container (the actual React Flow node) - use data attribute for reliable matching
      const panelElement = containerRef.current?.closest('[data-panel-container="true"]') as HTMLElement ||
        containerRef.current?.closest('[class*="bg-white"][class*="rounded-xl"]') as HTMLElement ||
        containerRef.current?.closest('.bg-white.rounded-xl') as HTMLElement ||
        containerRef.current?.closest('[class*="backdrop-blur"]') as HTMLElement

      if (!panelElement || !containerRef.current) {
        setShowPopup(false)
        return
      }

      // Use TipTap's coordinate system for accurate text positioning
      const coords = editor.view.coordsAtPos(from)

      // Also get the native selection for fallback
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        setShowPopup(false)
        return
      }

      const range = selection.getRangeAt(0)
      const rangeRect = range.getBoundingClientRect()

      // Get panel's viewport position
      const panelRect = panelElement.getBoundingClientRect()

      // Try using TipTap's coords which are designed for text positioning
      // coords.top gives us the exact top of the text line
      let selectionTopRelativeToPanel = coords.top - panelRect.top

      // Also calculate using range rect as a sanity check
      const rangeTopRelativeToPanel = rangeRect.top - panelRect.top

      // Use TipTap's coords as primary (more accurate for text), but verify with range
      // If they're very different, there might be an issue
      const difference = Math.abs(selectionTopRelativeToPanel - rangeTopRelativeToPanel)
      if (difference > 5) {
        // If there's a significant difference, use the range rect (visual position)
        selectionTopRelativeToPanel = rangeTopRelativeToPanel
      }

      // Round to avoid sub-pixel issues
      selectionTopRelativeToPanel = Math.round(selectionTopRelativeToPanel)

      // Horizontal position: from panel's right edge (already working, so keep as is)
      const horizontalOffset = 40 // 40px to the right of panel's right edge

      // Store panel element reference for rendering
      panelContainerRef.current = panelElement

      // Position popup top-aligned with selected text, relative to panel
      // Round the position to ensure pixel-perfect alignment
      setPopupPosition({
        top: selectionTopRelativeToPanel, // Vertical: top-aligned with selection (rounded)
        right: -horizontalOffset, // Horizontal: relative to panel right edge
      })
      setShowPopup(true)
    }

    // Listen to editor selection updates
    const handleEditorUpdate = () => {
      requestAnimationFrame(updatePopupPosition)
    }

    editor.on('selectionUpdate', handleEditorUpdate)
    editor.on('update', handleEditorUpdate)

    // Also listen for native selection changes (for cases where TipTap doesn't fire)
    const handleSelectionChange = () => {
      requestAnimationFrame(updatePopupPosition)
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    // Listen to React Flow viewport changes (zoom, pan) to update position dynamically
    const handleViewportChange = () => {
      requestAnimationFrame(updatePopupPosition)
    }

    // Use ResizeObserver to detect panel position/size changes (handles zoom/pan) - use data attribute for reliable matching
    const panelElementForObserver = containerRef.current?.closest('[data-panel-container="true"]') as HTMLElement ||
      containerRef.current?.closest('[class*="bg-white"][class*="rounded-xl"]') as HTMLElement ||
      containerRef.current?.closest('.bg-white.rounded-xl') as HTMLElement ||
      containerRef.current?.closest('[class*="backdrop-blur"]') as HTMLElement
    let resizeObserver: ResizeObserver | null = null
    if (panelElementForObserver) {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(updatePopupPosition)
      })
      resizeObserver.observe(panelElementForObserver)
    }

    // Listen to React Flow wheel events (zoom) and window resize
    const reactFlowElement = document.querySelector('.react-flow')
    if (reactFlowElement) {
      // Listen to wheel for zoom
      reactFlowElement.addEventListener('wheel', handleViewportChange, { passive: true })
      // Also listen to touch events for pinch zoom
      reactFlowElement.addEventListener('touchmove', handleViewportChange, { passive: true })
    }
    window.addEventListener('resize', handleViewportChange)

    // Only update position on selection/viewport changes, not continuously
    // The continuous loop was causing timing issues during zoom
    // Instead, rely on event-driven updates which are more stable

    // Initial check
    updatePopupPosition()

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      editor.off('selectionUpdate', handleEditorUpdate)
      editor.off('update', handleEditorUpdate)
      window.removeEventListener('resize', handleViewportChange)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      if (reactFlowElement) {
        reactFlowElement.removeEventListener('wheel', handleViewportChange)
        reactFlowElement.removeEventListener('touchmove', handleViewportChange)
      }
    }
  }, [editor, containerRef, reactFlowInstance, showPopup, showEmojiPicker])

  // Hide popup when clicking outside
  useEffect(() => {
    // Don't attach click-away handler if emoji picker is open
    // This prevents any accidental closes when interacting with the emoji picker
    if (!showPopup || showEmojiPicker) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Check if clicking inside emoji picker container
      const isInEmojiPicker = emojiPickerRef.current?.contains(target as Node)

      // Check if clicking inside main popup or editor
      const isInPopup = popupRef.current?.contains(target as Node)
      const isInEditor = editor.view.dom.contains(target as Node)

      // Only close if clicking outside all of these
      if (!isInPopup && !isInEditor && !isInEmojiPicker) {
        setShowPopup(false)
        setShowEmojiPicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPopup, editor, showEmojiPicker])

  // Attach native wheel event listener directly to emoji picker element (runs first)
  // Also ensure clicks work on shadow DOM elements (category tabs)
  useEffect(() => {
    if (!showEmojiPicker || !emojiPickerRef.current) return

    const emojiPickerElement = emojiPickerRef.current

    // Allow clicks to work on shadow DOM elements (category tabs)
    // The emoji picker uses shadow DOM, so we need to ensure clicks propagate
    const handleClick = (e: MouseEvent) => {
      // Don't prevent default or stop propagation - let all clicks work normally
      // This allows category tabs in shadow DOM to work
    }

    // Attach click handler to allow shadow DOM clicks
    emojiPickerElement.addEventListener('click', handleClick, { capture: true })

    return () => {
      emojiPickerElement.removeEventListener('click', handleClick, { capture: true })
    }
  }, [showEmojiPicker])

  // Attach native wheel event listener directly to emoji picker element (runs first)
  useEffect(() => {
    if (!showEmojiPicker || !emojiPickerRef.current) return

    const emojiPickerElement = emojiPickerRef.current

    // Function to find the scrollable container - try multiple strategies
    const findScrollableContainer = (): HTMLElement | null => {
      // Strategy 1: Try to find the emoji picker web component and access shadow DOM
      const emojiPickerComponent = emojiPickerElement.querySelector('em-emoji-picker') as HTMLElement & { shadowRoot?: ShadowRoot }
      if (emojiPickerComponent) {
        // Try to access shadow root (if it exists)
        const shadowRoot = emojiPickerComponent.shadowRoot
        if (shadowRoot) {
          // Look for scrollable containers in shadow DOM - try multiple selectors
          const selectors = [
            '[style*="overflow"]',
            '[class*="scroll"]',
            'section',
            'div[role="listbox"]',
            'div[role="grid"]',
            'div',
          ]
          for (const selector of selectors) {
            const scrollable = shadowRoot.querySelector(selector) as HTMLElement
            if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
              return scrollable
            }
          }
        }
      }

      // Strategy 2: Look for any element with scrollable content in light DOM
      const allElements = emojiPickerElement.querySelectorAll('*')
      for (const el of allElements) {
        const htmlEl = el as HTMLElement
        if (htmlEl.scrollHeight > htmlEl.clientHeight && htmlEl.scrollHeight > 0) {
          return htmlEl
        }
      }

      // Strategy 3: Check the emoji picker component itself
      if (emojiPickerComponent && emojiPickerComponent.scrollHeight > emojiPickerComponent.clientHeight) {
        return emojiPickerComponent
      }

      // Strategy 4: Fallback to wrapper
      return emojiPickerElement
    }

    // Attach native wheel event listener directly to the element
    // This runs in capture phase before React Flow can handle it
    const handleWheel = (e: WheelEvent) => {
      // Only handle if the event is within the emoji picker bounds
      const pickerRect = emojiPickerElement.getBoundingClientRect()
      const isWithinPicker =
        e.clientX >= pickerRect.left &&
        e.clientX <= pickerRect.right &&
        e.clientY >= pickerRect.top &&
        e.clientY <= pickerRect.bottom

      if (!isWithinPicker) return

      // Stop propagation to React Flow, but allow default scroll behavior
      // This lets the browser handle scrolling naturally, which will update the scrollbar
      e.stopPropagation()
      e.stopImmediatePropagation()
      // Don't prevent default - let the browser scroll the element with overflow-y: auto
    }

    // Attach listener immediately and also to window for maximum priority
    emojiPickerElement.addEventListener('wheel', handleWheel, { capture: true, passive: false })

    // Also attach to window in capture phase to catch events before anything else
    const handleWindowWheel = (e: WheelEvent) => {
      if (emojiPickerElement.contains(e.target as Node)) {
        handleWheel(e)
      }
    }
    window.addEventListener('wheel', handleWindowWheel, { capture: true, passive: false })

    return () => {
      emojiPickerElement.removeEventListener('wheel', handleWheel, { capture: true })
      window.removeEventListener('wheel', handleWindowWheel, { capture: true })
    }
  }, [showEmojiPicker])

  // Prevent React Flow from capturing scroll events on emoji picker
  useEffect(() => {
    if (!showEmojiPicker || !emojiPickerRef.current) return

    const emojiPickerElement = emojiPickerRef.current

    // Find the scrollable container inside the emoji picker
    // emoji-mart uses a web component, so we need to find the shadow DOM root or internal scrollable area
    const findScrollableContainer = (): HTMLElement | null => {
      // Try to find the emoji picker web component
      const emojiPickerComponent = emojiPickerElement.querySelector('em-emoji-picker')
      if (!emojiPickerComponent) return null

      // Try to access shadow root (if it exists)
      const shadowRoot = emojiPickerComponent.shadowRoot
      if (shadowRoot) {
        // Look for scrollable containers in shadow DOM
        const scrollable = shadowRoot.querySelector('[style*="overflow"], [class*="scroll"], section, div[role="listbox"]') as HTMLElement
        if (scrollable) return scrollable
      }

      // Fallback: look for scrollable containers in light DOM
      const scrollable = emojiPickerElement.querySelector('[style*="overflow"], [class*="scroll"], section, div[role="listbox"]') as HTMLElement
      return scrollable || emojiPickerElement
    }

    // Attach listeners on the document with capture phase to catch events before React Flow
    const handleDocumentWheel = (e: WheelEvent) => {
      // Get emoji picker's bounding box
      const pickerRect = emojiPickerElement.getBoundingClientRect()

      // Check if mouse coordinates are within the emoji picker bounds
      const isWithinPicker =
        e.clientX >= pickerRect.left &&
        e.clientX <= pickerRect.right &&
        e.clientY >= pickerRect.top &&
        e.clientY <= pickerRect.bottom

      // Also check if the event target is within the emoji picker (for shadow DOM cases)
      const isTargetWithinPicker = emojiPickerElement.contains(e.target as Node) ||
        emojiPickerElement.contains(e.composedPath()[0] as Node)

      if (isWithinPicker || isTargetWithinPicker) {
        // Stop propagation to React Flow, but allow default scroll behavior
        // This lets the browser handle scrolling naturally, which will update the scrollbar
        e.stopPropagation()
        e.stopImmediatePropagation()
        // Don't prevent default - let the browser scroll the element with overflow-y: auto
      }
    }

    const handleDocumentTouchMove = (e: TouchEvent) => {
      // CRITICAL: Always allow pinch zoom (multiple touches) to pass through to React Flow
      // Prevent browser's default pinch zoom behavior, but let React Flow handle it
      if (e.touches.length > 1) {
        // This is a pinch zoom - prevent browser's default zoom, but let React Flow handle it
        e.preventDefault() // Prevent browser's default pinch zoom
        // Don't stop propagation - let React Flow receive the event
        return
      }

      // Only handle single-touch events (scrolling within emoji picker)
      // Get emoji picker's bounding box
      const pickerRect = emojiPickerElement.getBoundingClientRect()

      // Check if touch coordinates are within the emoji picker bounds
      if (e.touches.length > 0) {
        const touch = e.touches[0]
        const isWithinPicker =
          touch.clientX >= pickerRect.left &&
          touch.clientX <= pickerRect.right &&
          touch.clientY >= pickerRect.top &&
          touch.clientY <= pickerRect.bottom

        // Also check if the event target is within the emoji picker
        const isTargetWithinPicker = emojiPickerElement.contains(e.target as Node) ||
          emojiPickerElement.contains(e.composedPath()[0] as Node)

        if (isWithinPicker || isTargetWithinPicker) {
          e.stopPropagation() // Stop event from reaching React Flow
          e.stopImmediatePropagation() // Also stop other listeners
          // Allow default touch scrolling within the picker
        }
      }
    }

    // Also attach listeners directly to the React Flow element to catch events before React Flow handles them
    const reactFlowElement = document.querySelector('.react-flow') as HTMLElement
    if (reactFlowElement) {
      reactFlowElement.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
      reactFlowElement.addEventListener('touchmove', handleDocumentTouchMove, { capture: true, passive: false })
    }

    // Use capture phase on document to catch events before React Flow
    // For touchmove, we check for pinch zoom first and let it pass through completely
    document.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
    document.addEventListener('touchmove', handleDocumentTouchMove, { capture: true, passive: false })

    return () => {
      document.removeEventListener('wheel', handleDocumentWheel, { capture: true })
      document.removeEventListener('touchmove', handleDocumentTouchMove, { capture: true })
      if (reactFlowElement) {
        reactFlowElement.removeEventListener('wheel', handleDocumentWheel, { capture: true })
        reactFlowElement.removeEventListener('touchmove', handleDocumentTouchMove, { capture: true })
      }
    }
  }, [showEmojiPicker])

  const handleCommentClick = () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)
    if (selectedText.trim()) {
      onComment(selectedText, from, to)
      // Clear selection after commenting
      editor.chain().blur().run()
      setShowPopup(false)
    }
  }

  const handleEmojiClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent closing the main popup
    setShowEmojiPicker(!showEmojiPicker) // Toggle emoji picker
  }

  const handleEmojiSelect = (emoji: any) => {
    // emoji-mart returns an object with native (emoji character) and other properties
    const emojiChar = emoji.native || emoji

    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to).trim()

    if (selectedText && onAddReaction && section) {
      onAddReaction(selectedText, from, to, emojiChar, section)
      // Clear selection after adding reaction
      editor.chain().blur().run()
      setShowPopup(false)
      setShowEmojiPicker(false)
    }
  }

  const handleSuggestEditClick = () => {
    // TODO: Implement suggest edit functionality
    console.log('Suggest edit button clicked')
  }

  if (!showPopup || !panelContainerRef.current) return null

  // Render directly inside panel container (not via portal) so it's in the same stacking context as panel
  // Panel is at z-0, minimap is at z-1, so pill will be below minimap but above panel content
  // No need to scale the pill - React Flow's transform on the panel will scale it automatically
  const relativeTop = popupPosition.top
  const relativeRight = popupPosition.right

  return (
    <div
      ref={popupRef}
      className="absolute pointer-events-auto z-[100]"
      style={{
        top: `${relativeTop}px`,
        right: `${relativeRight}px`, // Positioned relative to panel's right edge
        // No transform needed - panel's transform will scale this automatically
      }}
    >
      {/* Vertical pill container with three buttons: comment, emoji, suggest edit */}
      <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-2 flex flex-col gap-1">
        {/* Comment button - top */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCommentClick}
          className="h-8 w-8 p-0 rounded-full"
          title="Add comment"
        >
          <MessageSquare className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </Button>

        {/* Emoji button - middle */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEmojiClick}
            className="h-8 w-8 p-0 rounded-full"
            title="Add emoji"
          >
            <Smile className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>

          {/* Emoji picker popup - appears to the right of the button */}
          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="absolute left-full ml-2 top-0 z-[200] bg-white rounded-lg shadow-lg"
              style={{
                pointerEvents: 'auto',
                height: '400px',
                maxHeight: '400px'
              }} // Ensure pointer events work
              onClick={(e) => {
                // Don't stop propagation - let all clicks work normally inside the emoji picker
                // The click-away handler will check if the click is outside the picker
              }} // Allow all clicks to work normally
              onMouseDown={(e) => {
                // Don't stop propagation - let all clicks work normally inside the emoji picker
                // The click-away handler will check if the click is outside the picker
              }} // Allow all clicks to work normally
              onMouseUp={(e) => {
                e.stopPropagation()
                // Don't prevent default - allow clicks to work
              }} // Prevent closing on mouseup
              onFocus={(e) => {
                e.stopPropagation()
              }} // Prevent closing on focus
              onTouchMove={(e) => {
                // Allow pinch zoom (multiple touches) to pass through to React Flow
                if (e.touches.length > 1) {
                  // This is a pinch zoom - let it pass through to React Flow
                  return
                }
                e.stopPropagation() // Prevent React Flow from panning on single touch scroll
                // Don't prevent default - allow scrolling
              }} // Prevent map pan on touch scroll, but allow pinch zoom
            >
              <div
                className="emoji-picker-wrapper"
                onWheel={(e) => {
                  e.stopPropagation() // Prevent React Flow from panning/zooming when scrolling emoji list
                  // Don't prevent default - allow scrolling
                }} // Prevent map pan/zoom on scroll
                onTouchMove={(e) => {
                  // Allow pinch zoom (multiple touches) to pass through to React Flow
                  if (e.touches.length > 1) {
                    // This is a pinch zoom - let it pass through to React Flow
                    return
                  }
                  e.stopPropagation() // Prevent React Flow from panning on single touch scroll
                  // Don't prevent default - allow scrolling
                }} // Prevent map pan on single touch scroll, but allow pinch zoom
              >
                <Picker
                  data={data}
                  onEmojiSelect={handleEmojiSelect}
                  theme="light"
                  previewPosition="none"
                  skinTonePosition="none"
                  locale="en"
                />
              </div>
            </div>
          )}
        </div>

        {/* Suggest edit button - bottom */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSuggestEditClick}
          className="h-8 w-8 p-0 rounded-full"
          title="Suggest edit"
        >
          <PenSquare className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </Button>
      </div>
    </div>
  )
}

export function ChatPanelNode({ data, selected, id }: NodeProps<PanelNodeData>) {
  // Handle both ChatPanelNodeData and ProjectBoardPanelNodeData
  const isProjectBoard = isProjectBoardData(data)

  // Extract data based on type
  const promptMessage: Message | null = isProjectBoard
    ? { id: data.boardId, role: 'user' as const, content: data.boardTitle, created_at: '' }
    : data.promptMessage
  const responseMessage: Message | undefined = isProjectBoard
    ? data.recentUserMessage
    : data.responseMessage
  const conversationId = isProjectBoard ? data.boardId : data.conversationId
  const projectId = isProjectBoard ? data.projectId : undefined
  const dataCollapsed = data.isResponseCollapsed || false
  const supabase = createClient()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { reactFlowInstance, panelWidth, getSetNodes } = useReactFlowContext() // Get zoom, panel width, and setNodes function
  const [promptHasChanges, setPromptHasChanges] = useState(false)
  const [responseHasChanges, setResponseHasChanges] = useState(false)
  const [promptContent, setPromptContent] = useState(promptMessage?.content || '')
  const [responseContent, setResponseContent] = useState(responseMessage?.content || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isResponseCollapsed, setIsResponseCollapsed] = useState(dataCollapsed || false) // Track if response is collapsed
  const [showPromptMoreMenu, setShowPromptMoreMenu] = useState(!dataCollapsed) // Track if prompt more menu should be visible (with delay)
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
  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([]) // Store all emoji reactions for this panel
  const [isBookmarked, setIsBookmarked] = useState(false) // Track if panel is bookmarked
  const panelRef = useRef<HTMLDivElement>(null) // Ref to panel container for positioning comment box
  const commentPanelsRef = useRef<HTMLDivElement>(null) // Ref to comment panels container for click-away detection
  const promptEditorRef = useRef<any>(null) // Ref to prompt editor instance
  const responseEditorRef = useRef<any>(null) // Ref to response editor instance
  const newCommentTextareaRef = useRef<HTMLTextAreaElement>(null) // Ref for new comment textarea
  const replyTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({}) // Refs for reply textareas
  const { resolvedTheme } = useTheme() // Get theme to set transparent background color

  // Helper function to convert hex color to rgba with opacity
  // Maintains transparency by converting hex to rgba with specified opacity
  const hexToRgba = useCallback((hex: string, opacity: number): string => {
    // Remove # if present
    const cleanHex = hex.replace('#', '')

    // Parse RGB values
    const r = parseInt(cleanHex.substring(0, 2), 16)
    const g = parseInt(cleanHex.substring(2, 4), 16)
    const b = parseInt(cleanHex.substring(4, 6), 16)

    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }, [])

  // Calculate panel background color with transparency
  // If fillColor is provided, convert to rgba with 0.15 opacity, otherwise use default
  const panelBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return hexToRgba(data.fillColor, 0.15) // Maintain 15% opacity for transparency
    }
    return resolvedTheme === 'dark'
      ? 'rgba(23, 23, 23, 0.15)' // Default: 15% opacity dark background for dark mode
      : 'rgba(255, 255, 255, 0.15)' // Default: 15% opacity white for light mode
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Calculate prompt/grey area background color
  // Dark mode: 10% opacity, Light mode: 15% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // Otherwise use default colors
  const promptAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 10% opacity, Light mode: 15% opacity
      const opacity = resolvedTheme === 'dark' ? 0.10 : 0.15
      return hexToRgba(data.fillColor, opacity)
    }
    return resolvedTheme === 'dark'
      ? 'rgba(31, 31, 31, 0.10)' // Default: 10% opacity dark grey for dark mode
      : 'rgba(249, 250, 251, 0.15)' // Default: 15% opacity grey-50 for light mode
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Calculate response/white area background color
  // Dark mode: 15% opacity, Light mode: 10% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // Otherwise use default colors
  const responseAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 15% opacity, Light mode: 10% opacity
      const opacity = resolvedTheme === 'dark' ? 0.15 : 0.10
      return hexToRgba(data.fillColor, opacity)
    }
    return resolvedTheme === 'dark'
      ? 'rgba(23, 23, 23, 0.15)' // Default: 15% opacity dark background for dark mode
      : 'rgba(255, 255, 255, 0.10)' // Default: 10% opacity white for light mode
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Calculate handle dot color to match panel fill color
  // Calculate handle dot color to match panel fill color
  const handleColor = useMemo(() => {
    // Determine foreground color and opacity (same logic as responseAreaBackgroundColor)
    let fgColor, opacity, bgColor

    if (data.fillColor) {
      fgColor = data.fillColor
      opacity = resolvedTheme === 'dark' ? 0.35 : 0.35 // Adjusted opacity for balanced visibility (between 0.20 "too light" and 0.60 "too dark")
    } else {
      fgColor = resolvedTheme === 'dark' ? '#171717' : '#ffffff'
      opacity = resolvedTheme === 'dark' ? 0.35 : 0.35
    }

    // Map background color (from globals.css)
    // dark: #0f0f0f, light: #ffffff
    bgColor = resolvedTheme === 'dark' ? '#0f0f0f' : '#ffffff'

    // Return the solid blended color
    return blendHexColors(fgColor, bgColor, opacity)
  }, [data.fillColor, resolvedTheme])

  // Calculate handle border color to match panel border
  // Always use default theme border, ignore selection (dot should not turn blue) and custom colors
  const handleBorderColor = useMemo(() => {
    // If custom border color is set, use it
    if (data.borderColor) {
      return data.borderColor
    }

    // Default border color based on theme
    // light: border-gray-200 (#e5e7eb)
    // dark: border-[#2f2f2f] (#2f2f2f)
    // dark: border-[#2f2f2f] (#2f2f2f)
    return resolvedTheme === 'dark' ? '#2f2f2f' : '#e5e7eb'
  }, [data.borderColor, resolvedTheme])

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
      // Update prompt more menu visibility based on initial state
      if (dataCollapsed) {
        setShowPromptMoreMenu(false)
      } else {
        setShowPromptMoreMenu(true)
      }
    }
  }, [dataCollapsed])

  // Load bookmark state from message metadata (only for regular panels, not project boards)
  useEffect(() => {
    if (isProjectBoard) return // Project boards don't have bookmarks

    const checkBookmark = async () => {
      if (!responseMessage) return

      const { data: message } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessage.id)
        .single()

      if (message?.metadata && typeof message.metadata === 'object') {
        setIsBookmarked((message.metadata as any).bookmarked === true)
      }
    }

    checkBookmark()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectBoard, responseMessage?.id]) // Only depend on responseMessage.id to avoid unnecessary re-runs

  // Handle bookmark toggle (only for regular panels, not project boards)
  const handleBookmark = async () => {
    if (isProjectBoard || !responseMessage) return

    const newBookmarkState = !isBookmarked
    setIsBookmarked(newBookmarkState)

    // Get existing metadata
    const { data: message } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', responseMessage.id)
      .single()

    const existingMetadata = (message?.metadata as Record<string, any>) || {}
    const updatedMetadata = { ...existingMetadata, bookmarked: newBookmarkState }

    // Update message metadata
    await supabase
      .from('messages')
      .update({ metadata: updatedMetadata })
      .eq('id', responseMessage.id)
  }

  // Update node data when collapse state changes
  const handleCollapseChange = useCallback((collapsed: boolean) => {
    setIsResponseCollapsed(collapsed)

    // Hide prompt more menu immediately when collapsing
    if (collapsed) {
      setShowPromptMoreMenu(false)
    } else {
      // Show prompt more menu after 0.2s delay when expanding to prevent flash
      setTimeout(() => {
        setShowPromptMoreMenu(true)
      }, 200)
    }
    const setNodes = getSetNodes()
    if (setNodes && reactFlowInstance) {
      setNodes((nodes: any[]) =>
        nodes.map((node: any) =>
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

  // Handle adding emoji reaction
  const handleAddReaction = useCallback((selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => {
    // Get the appropriate editor (prompt or response)
    const editor = section === 'prompt' ? promptEditorRef.current : responseEditorRef.current

    // Apply blue highlight to the selected text (same as comments)
    if (editor) {
      try {
        // Use transaction to remove all highlight marks and apply blue
        const tr = editor.state.tr
        // Remove all highlight marks in the range
        tr.removeMark(from, to, editor.schema.marks.highlight)
        // Add blue highlight mark using blue-100 - slightly darker than blue-50
        tr.addMark(from, to, editor.schema.marks.highlight.create({ color: '#dbeafe' }))
        editor.view.dispatch(tr)
      } catch (error) {
        console.error('Error applying blue highlight to reacted text:', error)
      }
    }

    // Check if there's already a reaction for this exact text range
    const existingReaction = emojiReactions.find(
      reaction => reaction.from === from && reaction.to === to && reaction.section === section && reaction.emoji === emoji
    )

    if (existingReaction) {
      // Increment count if same emoji on same range
      setEmojiReactions(prev =>
        prev.map(reaction =>
          reaction.id === existingReaction.id
            ? { ...reaction, count: reaction.count + 1 }
            : reaction
        )
      )
    } else {
      // Create new reaction
      const newReaction: EmojiReaction = {
        id: `reaction-${Date.now()}-${Math.random()}`,
        selectedText,
        from,
        to,
        section,
        emoji,
        count: 1,
        createdAt: new Date().toISOString(),
      }
      setEmojiReactions(prev => [...prev, newReaction])
    }
  }, [emojiReactions])

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

  // Determine if this is a flashcard - move definition up to use in hooks
  const isFlashcard = promptMessage?.metadata?.isFlashcard === true

  // Get current zoom level and update panel width when zoom is 100% or less
  const [currentZoom, setCurrentZoom] = useState(reactFlowInstance?.getViewport().zoom ?? 1)
  const [panelWidthToUse, setPanelWidthToUse] = useState(isFlashcard ? 600 : 768)

  // Continuously check zoom level and update panel width
  useEffect(() => {
    if (!reactFlowInstance) return

    const updateZoomAndWidth = () => {
      const zoom = reactFlowInstance.getViewport().zoom
      setCurrentZoom(zoom)

      const targetMaxWidth = isFlashcard ? 600 : 768

      // Use dynamic width when:
      // 1. Zoom is 100% or less (<= 1.0)
      // 2. AND panel width (from context) is >= prompt box width (so panels can shrink with prompt box)
      // This allows panels to shrink with prompt box when zoomed out or at 100%
      if (zoom <= 1.0 && panelWidth > 0) {
        // Use the smaller of panelWidth (from prompt box) or targetMaxWidth
        // This ensures panels shrink when prompt box shrinks, but don't exceed targetMaxWidth
        setPanelWidthToUse(Math.min(panelWidth, targetMaxWidth))
      } else {
        setPanelWidthToUse(targetMaxWidth)
      }
    }

    // Initial update
    updateZoomAndWidth()

    // Update periodically to catch zoom changes
    const interval = setInterval(updateZoomAndWidth, 100)

    return () => clearInterval(interval)
  }, [reactFlowInstance, panelWidth])

  // Sync promptContent when promptMessage changes (or boardTitle for project boards)
  useEffect(() => {
    if (isProjectBoard) {
      // For project boards, sync from boardTitle
      if (data.boardTitle !== promptContent && !promptHasChanges) {
        setPromptContent(data.boardTitle)
      }
    } else {
      // For regular panels, sync from promptMessage
      if (promptMessage && promptMessage.content !== promptContent && !promptHasChanges) {
        setPromptContent(promptMessage.content)
      }
    }
  }, [isProjectBoard, isProjectBoard ? data.boardTitle : promptMessage?.content, promptContent, promptHasChanges, data])

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

    if (isProjectBoard) {
      // For project boards, update board title
      const { error } = await supabase
        .from('conversations')
        .update({ title: newContent })
        .eq('id', data.boardId)

      if (error) {
        console.error('Error updating board title:', error)
      } else {
        // Invalidate project boards query to refresh
        queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
      }
    } else {
      // For regular panels, update message in database
      if (promptMessage) {
        const { error } = await supabase
          .from('messages')
          .update({ content: newContent })
          .eq('id', promptMessage.id)

        if (error) {
          console.error('Error updating prompt:', error)
        }
      }
    }
  }

  const handlePromptRevert = async () => {
    // Revert to original content
    if (isProjectBoard) {
      setPromptContent(data.boardTitle)
      setPromptHasChanges(false)

      const { error } = await supabase
        .from('conversations')
        .update({ title: data.boardTitle })
        .eq('id', data.boardId)

      if (error) {
        console.error('Error reverting board title:', error)
      } else {
        queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
      }
    } else {
      if (promptMessage) {
        setPromptContent(promptMessage.content)
        setPromptHasChanges(false)

        const { error } = await supabase
          .from('messages')
          .update({ content: promptMessage.content })
          .eq('id', promptMessage.id)

        if (error) {
          console.error('Error reverting prompt:', error)
        }
      }
    }
  }

  const handleResponseChange = async (newContent: string) => {
    if (isProjectBoard || !responseMessage) return // Project boards: read-only

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
    if (isProjectBoard || !responseMessage) return // Project boards: read-only

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
      if (isProjectBoard) {
        // For project boards, remove board from project (set project_id to null)
        const { data: conversation } = await supabase
          .from('conversations')
          .select('metadata')
          .eq('id', data.boardId)
          .single()

        if (conversation?.metadata) {
          const { project_id: _, ...updatedMetadata } = conversation.metadata as Record<string, any>
          const finalMetadata = Object.keys(updatedMetadata).length > 0 ? updatedMetadata : {}

          const { error } = await supabase
            .from('conversations')
            .update({ metadata: finalMetadata })
            .eq('id', data.boardId)

          if (error) {
            throw new Error(error.message || 'Failed to remove board from project')
          }

          // Invalidate project boards query
          await queryClient.invalidateQueries({ queryKey: ['project-boards', projectId] })
        }
      } else {
        // For regular panels, delete messages
        if (!promptMessage) return

        const messageIds = [promptMessage.id]
        if (responseMessage) {
          messageIds.push(responseMessage.id)
        }

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
      }
    } catch (error: any) {
      console.error('Failed to delete panel:', error)
      alert(error.message || 'Failed to delete panel. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // Determine if this is a component panel (empty prompt content) - check once at top level
  // Component panels should only show white editable area, no grey area, no loading spinner
  // UNLESS it's a flashcard - flashcards show grey area even if empty content
  const promptContentValue = promptMessage?.content || ''
  const isComponentPanel = promptContentValue.trim().length === 0
  // const isFlashcard = promptMessage?.metadata?.isFlashcard === true // Already defined at top
  // Show grey area if: has content OR is a flashcard (even if empty)
  const shouldShowGreyArea = promptContentValue.trim().length > 0 || isFlashcard

  // Debug logging for flashcard conversion
  if (isComponentPanel && promptMessage?.id) {
    console.log('🔍 Component panel check:', {
      panelId: id,
      messageId: promptMessage.id,
      hasContent: promptContentValue.trim().length > 0,
      isFlashcard,
      metadata: promptMessage.metadata,
      shouldShowGreyArea
    })
  }

  return (
    <div
      ref={panelRef}
      data-panel-container="true" // Data attribute to help find panel container for comment popup
      className={cn(
        'rounded-2xl border relative cursor-grab active:cursor-grabbing overflow-visible backdrop-blur-sm', // Transparent with backdrop blur for map panels - increased corner radius
        // Always show blue border when selected, otherwise use custom border color or default theme-based color
        selected ? 'border-blue-500 dark:border-blue-400' : (data.borderColor ? '' : 'border-gray-200 dark:border-[#2f2f2f]'),
        isBookmarked
          ? 'shadow-[0_0_8px_rgba(250,204,21,0.6)] dark:shadow-[0_0_8px_rgba(250,204,21,0.4)]'
          : (data.borderStyle === 'none' ? 'shadow-none' : 'shadow-sm')
      )}
      style={{
        width: `${panelWidthToUse}px`,
        // Use calculated panel background color with transparency maintained
        backgroundColor: panelBackgroundColor,
        // Use custom border color only if not selected (selection takes priority)
        borderColor: selected ? undefined : (data.borderColor || undefined),
        borderStyle: data.borderStyle as any || undefined,
        borderWidth: data.borderWeight || undefined,
      }}
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
          backgroundColor: handleColor,
          border: `1px solid ${handleBorderColor}`,
        }}
      />

      {/* Response section - wraps prompt area for nested structure */}
      {/* For component panels (empty prompt), show white editable area only (no grey prompt, no loading spinner) */}
      {/* For project boards, show recent user message; for regular panels, show response message */}
      {/* Use the top-level isComponentPanel check for consistency */}
      {(() => {

        // For flashcards (component panels with flashcard flag) WITHOUT response message, show collapsible white area (like response area)
        // Flashcards WITH response message should render like regular prompt+response panels (handled below)
        if (isFlashcard && isComponentPanel && !responseMessage) {
          return (
            <div
              className={cn(
                "p-1 backdrop-blur-sm rounded-b-2xl pb-12 relative transition-all duration-500 overflow-visible", // Transparent for map panels - background set via inline style, 4px padding, increased corner radius, slower collapse/expand animation
                isResponseCollapsed && "h-0 p-0 opacity-0" // Collapsible like response area
              )}
              style={{
                lineHeight: '1.7',
                // Use calculated response area background color - same as panel background
                backgroundColor: responseAreaBackgroundColor,
              }}
            >
              <TipTapContent
                content={promptContent || ''}
                className="text-gray-900 dark:text-gray-100"
                originalContent={promptContentValue || ''}
                onContentChange={handlePromptChange}
                onHasChangesChange={setPromptHasChanges}
                onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
                comments={comments.filter(c => c.section === 'prompt')}
                editorRef={promptEditorRef}
                onCommentHover={(commentId) => {
                  if (commentId) {
                    if (showComments) {
                      setSelectedCommentId(commentId)
                    } else {
                      setSelectedCommentId(null)
                    }
                  }
                }}
                onCommentClick={(commentId) => {
                  if (commentId) {
                    setShowComments(true)
                    setSelectedCommentId(commentId)
                  }
                }}
                onAddReaction={handleAddReaction}
                section="prompt"
              />
              {promptHasChanges && !isFlashcard && (
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
            </div>
          )
        }

        // For regular component panels (not flashcards), show editable white area only (no grey prompt area, no loading spinner)
        // Component panels are just white text panels - no grey, no loading
        if (isComponentPanel && !isFlashcard) {
          return (
            <div
              className="p-1 backdrop-blur-sm rounded-2xl pb-12 relative transition-all duration-500 overflow-visible" // Transparent for map panels - background set via inline style, 4px padding, increased corner radius, slower collapse/expand animation
              style={{
                lineHeight: '1.7',
                // Use calculated response area background color - same as panel background
                backgroundColor: responseAreaBackgroundColor,
              }}
            >
              <TipTapContent
                content={promptContent || ''}
                className="text-gray-900 dark:text-gray-100"
                originalContent={promptMessage?.content || ''}
                onContentChange={handlePromptChange}
                onHasChangesChange={setPromptHasChanges}
                onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
                comments={comments.filter(c => c.section === 'prompt')}
                editorRef={promptEditorRef}
                onCommentHover={(commentId) => {
                  if (commentId) {
                    if (showComments) {
                      setSelectedCommentId(commentId)
                    } else {
                      setSelectedCommentId(null)
                    }
                  }
                }}
                onCommentClick={(commentId) => {
                  if (commentId) {
                    setShowComments(true)
                    setSelectedCommentId(commentId)
                  }
                }}
                onAddReaction={handleAddReaction}
                section="prompt"
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
            </div>
          )
        }

        // For regular panels with response content (NOT component panels)
        // Also include flashcards - they should render like regular prompt+response panels even when empty
        // Flashcards with response message should always render nested prompt+response structure
        if ((isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
          (!isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
          (isFlashcard && responseMessage)) {
          return (
            <div
              className={cn(
                "p-1 backdrop-blur-sm rounded-2xl relative transition-all duration-500 overflow-visible", // Transparent for map panels - background set via inline style, rounded-2xl for all corners, p-1 padding (4px) for background and content spacing, slower collapse/expand animation
                // When collapsed, response content is hidden but container remains for prompt expansion
                isResponseCollapsed && "overflow-hidden",
                // Add bottom padding for buttons area when not collapsed
                !isResponseCollapsed && "pb-12"
              )}
              style={{
                lineHeight: '1.7',
                // Use calculated response area background color - same as panel background
                backgroundColor: responseAreaBackgroundColor,
              }}
            >
              {/* Prompt section - nested inside response area, affected by response panel padding */}
              {shouldShowGreyArea && (
                <div
                  className={cn(
                    "relative z-10 overflow-visible group transition-all duration-500 ease-in-out cursor-text", // Transparent grey area - background set via inline style, slower collapse/expand animation with synchronized easing
                    // When expanded: no margin - prompt area is inside response padding (p-1 = 4px), so it starts at response padding position
                    // When collapsed: negative margin (-m-1 = -4px) to extend beyond response padding and fill entire response area
                    isResponseCollapsed ? "-m-1 rounded-2xl" : "m-0 rounded-xl",
                    // Shadow to layer above response content
                    "shadow-sm",
                    // 12px padding (px-3) for prompt text - aligns with response text which also has 12px padding (4px more than before)
                    // When collapsed, use full padding to fill space while keeping text in place
                    isResponseCollapsed ? "p-4" : "px-3 py-4",
                    // Add bottom padding when response is collapsed to account for buttons below text
                    isResponseCollapsed && (((isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
                      (!isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim())) ||
                      isFlashcard) && "pb-16"
                  )}
                  style={{
                    // Use calculated prompt area background color - darker than panel background
                    backgroundColor: promptAreaBackgroundColor,
                  }}
                  onClick={(e) => {
                    // Focus the editor when clicking anywhere in the grey area
                    // Check if we're not clicking on a button or interactive element
                    const target = e.target as HTMLElement
                    if (!target.closest('button') && !target.closest('a')) {
                      promptEditorRef.current?.commands.focus()
                    }
                  }}
                >
                  {/* For project boards, show board title with open board button inline */}
                  {isProjectBoard ? (
                    <div className="inline-flex items-center gap-1.5">
                      <TipTapContent
                        content={promptContent}
                        className="text-gray-900 dark:text-gray-100 inline"
                        originalContent={data.boardTitle}
                        onContentChange={handlePromptChange}
                        onHasChangesChange={setPromptHasChanges}
                        onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
                        comments={comments.filter(c => c.section === 'prompt')}
                        editorRef={promptEditorRef}
                        onCommentHover={(commentId) => {
                          if (commentId) {
                            if (showComments) {
                              setSelectedCommentId(commentId)
                            } else {
                              setSelectedCommentId(null)
                            }
                          }
                        }}
                        onCommentClick={(commentId) => {
                          if (commentId) {
                            setShowComments(true)
                            setSelectedCommentId(commentId)
                          }
                        }}
                        onAddReaction={handleAddReaction}
                        section="prompt"
                      />
                      {/* Open board button - appears inline after title text */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 flex-shrink-0 hover:bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/board/${data.boardId}`)
                        }}
                        title="Open board"
                      >
                        <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                      </Button>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5">
                      <TipTapContent
                        content={promptContent}
                        className="text-gray-900 dark:text-gray-100 inline"
                        originalContent={promptMessage?.content || ''}
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
                        onAddReaction={handleAddReaction}
                        section="prompt"
                      />
                      {/* Copy button - appears inline after text, shows on hover - only show if there is text in prompt/question */}
                      {showPromptMoreMenu && !isResponseCollapsed && !isProjectBoard && shouldShowGreyArea && !isContentEmpty(promptContent) && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(promptContent)
                            }}
                            title={isFlashcard ? "Copy question" : "Copy prompt"}
                          >
                            <Copy className="h-3 w-3 text-gray-600 dark:text-gray-300" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {promptHasChanges && !isFlashcard && (
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

                  {/* Collapse/Expand caret button and response panel buttons - shown in prompt area when response is collapsed, same position as response panel */}
                  {/* Show for regular panels with response OR flashcards (flashcards can collapse white area) */}
                  {isResponseCollapsed && (
                    ((isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
                      (!isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim())) ||
                    (isFlashcard && responseMessage) // Flashcards with response message can collapse
                  ) && (
                      <ResponseButtonsWhenCollapsed
                        promptContent={promptContent}
                        responseContent={responseContent || ''} // For flashcards, responseContent is empty but we still show buttons
                        onDelete={handleDeletePanel}
                        isDeleting={isDeleting}
                        onExpand={() => handleCollapseChange(false)}
                        onBookmark={handleBookmark}
                        isBookmarked={isBookmarked}
                        isProjectBoard={isProjectBoard}
                        boardId={isProjectBoard ? data.boardId : undefined}
                      />
                    )}
                </div>
              )}

              {/* Response content - appears below prompt area with spacing */}
              {/* When collapsed, response content is hidden behind prompt */}
              {/* Separate div for response text with 8px padding to align with prompt text */}
              <div
                className={cn(
                  // Add top margin when prompt area is visible to create gap between prompt and response (8px gap)
                  shouldShowGreyArea && !isResponseCollapsed && "mt-2",
                  // Collapse response content with top as anchor (smooth transition)
                  "transition-all duration-500 ease-in-out overflow-hidden",
                  isResponseCollapsed && "opacity-0"
                )}
                style={{
                  // Use max-height for smooth collapse from top anchor (large value allows any content height)
                  maxHeight: isResponseCollapsed ? '0px' : '2000px',
                }}
              >
                {/* Separate div for response text with 12px horizontal padding to align with prompt text (4px more than before), 0px bottom padding */}
                <div className="px-3 pb-0">
                  <TipTapContent
                    key={`response-${responseMessage.id}`} // Force re-render when message ID changes
                    content={responseContent || responseMessage.content || ''}
                    className="text-gray-700 dark:text-gray-100"
                    originalContent={responseMessage.content || ''}
                    onContentChange={isProjectBoard ? undefined : handleResponseChange} // Project boards: read-only
                    onHasChangesChange={isProjectBoard ? undefined : setResponseHasChanges} // Project boards: read-only
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
                    onAddReaction={handleAddReaction}
                    section="response"
                    isFlashcard={isFlashcard}
                  />
                  {responseHasChanges && !isFlashcard && (
                    <div className="mt-2 ml-3 flex justify-end">
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
              </div>
            </div>
          )
        }

        // Loading state - show spinner while waiting for AI response
        // ONLY for regular panels (NOT component panels - they already returned above)
        // Show when: no responseMessage, or responseMessage exists but has no content yet
        // Component panels never reach here because they return early above
        // IMPORTANT: Also check if this is a component panel here as a safety check
        // Use the top-level isComponentPanel variable for consistency
        // UNLESS it's a flashcard - flashcards show grey area even if empty
        if (isComponentPanel && !isFlashcard) {
          // This is a component panel - show white editable area (should have been caught above, but safety check)
          return (
            <div
              className="p-1 backdrop-blur-sm rounded-2xl pb-12 relative transition-all duration-500 overflow-visible" // Transparent for map panels - background set via inline style, 4px padding, increased corner radius, slower collapse/expand animation
              style={{
                lineHeight: '1.7',
                // Use calculated response area background color - same as panel background
                backgroundColor: responseAreaBackgroundColor,
              }}
            >
              <TipTapContent
                content={promptContent || ''}
                className="text-gray-900 dark:text-gray-100"
                originalContent={promptContentValue || ''}
                onContentChange={handlePromptChange}
                onHasChangesChange={setPromptHasChanges}
                onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
                comments={comments.filter(c => c.section === 'prompt')}
                editorRef={promptEditorRef}
                onCommentHover={(commentId) => {
                  if (commentId) {
                    if (showComments) {
                      setSelectedCommentId(commentId)
                    } else {
                      setSelectedCommentId(null)
                    }
                  }
                }}
                onCommentClick={(commentId) => {
                  if (commentId) {
                    setShowComments(true)
                    setSelectedCommentId(commentId)
                  }
                }}
                onAddReaction={handleAddReaction}
                section="prompt"
                isFlashcard={isFlashcard}
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
            </div>
          )
        }

        // Regular panel loading state (NOT component panel)
        return (
          <div
            className="p-1 backdrop-blur-sm rounded-2xl flex items-center justify-center min-h-[100px]"
            style={{
              // Use calculated response area background color - same as panel background
              backgroundColor: responseAreaBackgroundColor,
            }}
          >
            <Loader2 className="h-6 w-6 text-gray-400 dark:text-gray-500 animate-spin" />
          </div>
        )
      })()}

      {/* Bottom action buttons - More menu at bottom left - only show when response is loaded and not collapsed */}
      {/* For project boards, show if recent message exists; for regular panels, show if response exists */}
      {/* For flashcards, show more menu when white area is expanded (flashcards don't have response but have collapsible white area) */}
      {((isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
        (!isProjectBoard && responseMessage && responseMessage.content && responseMessage.content.trim()) ||
        (isFlashcard && responseMessage)) && !isResponseCollapsed && (
          <div className="absolute bottom-2 left-4 flex items-center gap-2 z-10">
            {/* Copy button - copies response content when expanded */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={(e) => {
                e.stopPropagation()
                // Copy response content when panel is expanded
                navigator.clipboard.writeText(responseContent || '')
              }}
              title="Copy response"
            >
              <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </Button>

            {/* More menu button - vertical ellipsis - show for all panels (history panels and project history panels) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded hover:bg-transparent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    // Copy the full panel content (prompt + response)
                    const fullContent = `${promptContent}\n\n${responseContent || ''}`.trim()
                    navigator.clipboard.writeText(fullContent)
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy panel
                </DropdownMenuItem>
                {!isProjectBoard && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBookmark()
                    }}
                  >
                    <Bookmark className={cn("h-4 w-4 mr-2", isBookmarked && "fill-yellow-400 text-yellow-400")} />
                    Bookmark
                  </DropdownMenuItem>
                )}
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
          backgroundColor: handleColor,
          border: `1px solid ${handleBorderColor}`,
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
              data-comment-input="true"
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

      {/* Emoji reaction pills - appear to the right, vertically aligned with selected text */}
      {emojiReactions.length > 0 && (
        <div>
          {emojiReactions.map((reaction) => {
            // Calculate vertical position based on text position in editor
            const editor = reaction.section === 'prompt' ? promptEditorRef.current : responseEditorRef.current
            let topPosition = 0

            if (editor && panelRef.current) {
              try {
                const coords = editor.view.coordsAtPos(reaction.from)
                const panelRect = panelRef.current.getBoundingClientRect()
                if (panelRect && coords) {
                  // Calculate position relative to panel top - align with top of selection
                  topPosition = coords.top - panelRect.top
                }
              } catch (error) {
                console.error('Error calculating emoji reaction position:', error)
              }
            }

            return (
              <EmojiReactionPill
                key={reaction.id}
                reaction={reaction}
                topPosition={topPosition}
                onAddReaction={() => {
                  // When clicking the pill, increment the count
                  setEmojiReactions(prev =>
                    prev.map(r =>
                      r.id === reaction.id
                        ? { ...r, count: r.count + 1 }
                        : r
                    )
                  )
                }}
              />
            )
          })}
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

// Separate component for emoji reaction pill
function EmojiReactionPill({
  reaction,
  topPosition,
  onAddReaction,
}: {
  reaction: EmojiReaction
  topPosition: number
  onAddReaction: () => void
}) {
  return (
    <div
      className="absolute pointer-events-auto z-[100]"
      style={{
        top: `${topPosition}px`,
        right: '-48px', // Position to the right of panel, similar to comment button popup
      }}
    >
      <button
        onClick={onAddReaction}
        className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-md border border-gray-200 dark:border-[#2f2f2f] px-2 py-1 flex items-center gap-1.5 hover:shadow-lg transition-shadow"
        title="Click to add reaction"
      >
        <span className="text-base">{reaction.emoji}</span>
        <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">{reaction.count}</span>
      </button>
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
                  <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
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
              data-comment-input="true"
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

