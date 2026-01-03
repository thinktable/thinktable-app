'use client'

// Custom React Flow node for chat panels (prompt + response)
import { NodeProps, Handle, Position, useReactFlow } from 'reactflow'
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
import { Highlighter, RotateCcw, MoreHorizontal, MoreVertical, Trash2, Copy, Loader2, ChevronDown, ChevronUp, MessageSquare, X, Smile, PenSquare, Bookmark, SquarePen, ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Plus } from 'lucide-react'

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
import { useQueryClient, useQuery } from '@tanstack/react-query'
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
  isFlashcard,
  placeholder,
  isPanelSelected,
  isLoading,
  onCommentPopupVisibilityChange,
  onBlur,
  onEditorActiveChange
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
  placeholder?: string
  isPanelSelected?: boolean
  isLoading?: boolean
  onCommentPopupVisibilityChange?: (isVisible: boolean) => void
  onBlur?: () => void
  onEditorActiveChange?: (isActive: boolean) => void // Called when editor is focused or has selection
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { setActiveEditor } = useEditorContext()

  // Build extensions array - only add Placeholder if placeholder text is provided
  // Use any[] type to allow Placeholder extension which has incompatible types
  const extensions: any[] = [
    StarterKit,
    Highlight.configure({
      multicolor: true,
    }),
    TextStyle,
    Color,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
  ]
  
  // Only add Placeholder extension if placeholder text is provided
  if (placeholder !== undefined && placeholder !== '') {
    extensions.push(Placeholder.configure({
      placeholder: placeholder,
      emptyNodeClass: 'is-editor-empty',
      emptyEditorClass: 'is-editor-empty',
    }))
  } else if (placeholder === undefined) {
    // Default placeholder behavior if placeholder prop is not provided
    extensions.push(Placeholder.configure({
      placeholder: section === 'prompt' ? 'What are you trying to remember?' : 'Explain it clearly or let AI help',
      emptyNodeClass: 'is-editor-empty',
      emptyEditorClass: 'is-editor-empty',
    }))
  }

  const editor = useEditor({
    extensions,
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
        paste: (view, event) => {
          // Handle paste to insert text on same line with wrapping, not new lines
          const clipboardData = (event as ClipboardEvent).clipboardData
          if (clipboardData) {
            // Get plain text from clipboard
            const pastedText = clipboardData.getData('text/plain')
            // Replace newlines and multiple spaces with single space to keep on same line
            const normalizedText = pastedText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
            if (normalizedText) {
              // Insert text at current cursor position
              const { state, dispatch } = view
              const { from, to } = state.selection
              // Insert the normalized text, replacing any selected text
              const transaction = state.tr.insertText(normalizedText, from, to)
              dispatch(transaction)
              // Prevent default paste behavior
              event.preventDefault()
              return true
            }
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
      // Notify parent that editor is active (focused or has selection)
      if (onEditorActiveChange) {
        onEditorActiveChange(true)
      }
    },
    onBlur: () => {
      // Clear active editor when blurred (optional - keep it active for toolbar)
      // setActiveEditor(null)
      // Call custom onBlur callback if provided
      if (onBlur) {
        onBlur()
      }
      // Check if editor still has selection even after blur
      if (editor && onEditorActiveChange) {
        const { from, to } = editor.state.selection
        const hasSelection = from !== to
        onEditorActiveChange(hasSelection)
      } else if (onEditorActiveChange) {
        onEditorActiveChange(false)
      }
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

  // Detect when editor is active (focused or has selection) and notify parent to auto-select panel
  useEffect(() => {
    if (!editor || !onEditorActiveChange) return

    const checkEditorActive = () => {
      try {
        const { from, to } = editor.state.selection
        const hasSelection = from !== to
        const isFocused = editor.view.dom === document.activeElement || editor.view.dom.contains(document.activeElement)
        const isActive = hasSelection || isFocused
        onEditorActiveChange(isActive)
      } catch (error) {
        // Ignore errors
      }
    }

    // Check on focus/blur
    editor.on('focus', checkEditorActive)
    editor.on('blur', checkEditorActive)
    // Check on selection changes
    editor.on('selectionUpdate', checkEditorActive)
    editor.on('update', checkEditorActive)

    // Initial check
    checkEditorActive()

    return () => {
      editor.off('focus', checkEditorActive)
      editor.off('blur', checkEditorActive)
      editor.off('selectionUpdate', checkEditorActive)
      editor.off('update', checkEditorActive)
    }
  }, [editor, onEditorActiveChange])

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
  // If panel is selected, allow single click to place I-bar; otherwise require double click
  // Also clears text selection when clicking on text by collapsing selection to cursor at click position
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (editor) {
      // If panel is not selected and it's a single click, allow propagation so panel can be selected
      if (!isPanelSelected && e.detail < 2) {
        // Single click on unselected panel - don't focus, don't stop propagation (let panel be selected)
        return
      }
      // Stop propagation when focusing editor (selected panel single click, or double click)
      e.stopPropagation()
      
      // Check if there's a text selection that needs to be cleared
      const { from, to } = editor.state.selection
      const hasSelection = from !== to
      
      // Focus editor on click (single if selected, double if not selected) to show cursor
      setTimeout(() => {
        if (!editor.isDestroyed) {
          // If there was a selection, clear it by placing cursor at click position
          if (hasSelection) {
            try {
              const view = editor.view
              // Get click position in editor coordinates
              const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })
              if (pos !== null && pos >= 0) {
                // Place cursor at click position to clear selection
                editor.commands.setTextSelection(pos)
                editor.commands.focus()
                return
              }
            } catch {
              // Fallback: collapse selection to start position
              editor.commands.setTextSelection(from)
              editor.commands.focus()
              return
            }
          }
          
          // No selection - normal focus behavior
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
  }, [editor, isPanelSelected])

  if (!editor) return null

  // Extract 'inline' from className if present to apply inline-block display
  const isInline = className?.includes('inline')
  const otherClasses = className?.replace(/\binline\b/g, '').trim()

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-visible', isFlashcard ? 'cursor-pointer' : 'cursor-text', isInline && 'inline-block', otherClasses)}
      onClick={(e) => {
        // If panel is not selected and it's a single click, don't handle - let React Flow select the panel
        if (!isPanelSelected && e.detail < 2) {
          // Don't call handleContainerClick, don't stop propagation - let click bubble to React Flow
          return
        }
        // Otherwise, handle the click (selected panel single click, or double click)
        handleContainerClick(e)
      }}
      onDoubleClick={(e) => {
        // Double click focuses the editor (for unselected panels) - handleContainerClick already handles this via e.detail check
        // This handler ensures double click works even if onClick didn't fire
        if (!isPanelSelected && editor) {
          e.stopPropagation()
          setTimeout(() => {
            if (!editor.isDestroyed) {
              editor.commands.focus()
              const isEmpty = !editor.getHTML() || editor.getHTML() === '<p></p>' || editor.getHTML() === '<p><br></p>'
              if (isEmpty) {
                editor.commands.setTextSelection(0)
              }
            }
          }, 0)
        }
      }}
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
          zIndex: 1000, // High z-index to ensure it's above prompt panel and not clipped
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
          onVisibilityChange={onCommentPopupVisibilityChange}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  )
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
    return Array.isArray(studySets) ? studySets : []
  } catch (error) {
    console.error('Error fetching study sets:', error)
    return []
  }
}

// Tag boxes component - displays study set tags for a flashcard
function TagBoxes({ responseMessageId }: { responseMessageId: string }) {
  const supabase = createClient()
  const { selectedTag, setSelectedTag } = useReactFlowContext() // Get selected tag state for filtering
  const [taggedStudySetIds, setTaggedStudySetIds] = useState<string[]>([])
  const [studySetNames, setStudySetNames] = useState<Map<string, string>>(new Map())

  // Fetch current study set IDs from message metadata
  const fetchTaggedStudySets = useCallback(async () => {
    if (!responseMessageId) return

    try {
      // Check if user is authenticated first (required for RLS)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // Not authenticated - can't fetch message metadata (expected for public homepage boards)
        return
      }

      const { data: message, error } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessageId)
        .single()

      if (error) {
        // RLS errors (like PGRST116) are expected for messages user doesn't own
        // Only log unexpected errors
        if (error.code !== 'PGRST116' && error.message !== 'JSON object requested, multiple (or no) rows returned') {
        console.error('Error fetching message metadata:', error)
        }
        return
      }

      const metadata = (message?.metadata as Record<string, any>) || {}
      const studySetIds = (metadata.studySetIds || []) as string[]
      setTaggedStudySetIds(studySetIds)
    } catch (error) {
      // Silently handle errors (expected for public boards)
      // Only log if it's an unexpected error type
      if (error instanceof Error && !error.message.includes('PGRST')) {
      console.error('Error fetching tagged study sets:', error)
      }
    }
  }, [responseMessageId, supabase])

  useEffect(() => {
    fetchTaggedStudySets()

    // Subscribe to message updates to refresh tags
    const channel = supabase
      .channel(`tag-boxes-${responseMessageId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `id=eq.${responseMessageId}`,
        },
        () => {
          fetchTaggedStudySets()
        }
      )
      .subscribe()

    // Listen for custom event when flashcard is tagged
    const handleTagged = (event: CustomEvent) => {
      if (event.detail?.messageId === responseMessageId) {
        fetchTaggedStudySets()
      }
    }
    window.addEventListener('flashcard-tagged', handleTagged as EventListener)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('flashcard-tagged', handleTagged as EventListener)
    }
  }, [responseMessageId, supabase, fetchTaggedStudySets])

  // Fetch study set names for the tagged IDs
  useEffect(() => {
    const fetchStudySetNames = async () => {
      if (taggedStudySetIds.length === 0) {
        setStudySetNames(new Map())
        return
      }

      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('metadata')
          .eq('id', user.id)
          .single()

        if (error) {
          console.error('Error fetching profile:', error)
          return
        }

        const studySets = ((profile?.metadata as Record<string, any>)?.studySets || []) as Array<{ id: string; name: string }>
        const namesMap = new Map<string, string>()
        
        taggedStudySetIds.forEach((id) => {
          const studySet = studySets.find((s) => s.id === id)
          if (studySet) {
            namesMap.set(id, studySet.name)
          }
        })

        setStudySetNames(namesMap)
      } catch (error) {
        console.error('Error fetching study set names:', error)
      }
    }

    fetchStudySetNames()
  }, [taggedStudySetIds, supabase])

  if (taggedStudySetIds.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {taggedStudySetIds.map((studySetId) => {
        const name = studySetNames.get(studySetId)
        if (!name) return null // Don't show if name not found yet

        const isSelected = selectedTag === studySetId

        return (
          <div
            key={studySetId}
            onClick={(e) => {
              e.stopPropagation() // Prevent panel selection when clicking tag
              setSelectedTag(studySetId) // Toggle tag selection
            }}
            className={cn(
              "px-2 py-0.5 text-xs rounded-md border cursor-pointer transition-colors",
              isSelected
                ? "bg-blue-600 dark:bg-blue-500 text-white border-blue-700 dark:border-blue-400"
                : "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
            )}
          >
            {name}
          </div>
        )
      })}
    </div>
  )
}

// Tag button component - reusable for both collapsed and expanded states
function TagButton({ responseMessageId }: { responseMessageId: string }) {
  const queryClient = useQueryClient()
  const supabase = createClient()
  const [newStudySetName, setNewStudySetName] = useState('')
  const [isCreatingStudySet, setIsCreatingStudySet] = useState(false)
  const [showNewStudySetInput, setShowNewStudySetInput] = useState(false)

  // Fetch study sets for the dropdown
  const { data: studySets = [] } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Handle tagging flashcard to study set
  const handleTagToStudySet = async (studySetId: string) => {
    if (!responseMessageId) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Get current message metadata
      const { data: message, error: fetchError } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', responseMessageId)
        .single()

      if (fetchError) throw new Error(fetchError.message || 'Failed to fetch message')

      const existingMetadata = (message?.metadata as Record<string, any>) || {}
      const studySetIds = (existingMetadata.studySetIds || []) as string[]

      // Add study set ID if not already present
      if (!studySetIds.includes(studySetId)) {
        const updatedStudySetIds = [...studySetIds, studySetId]

        // Update message metadata
        const { error } = await supabase
          .from('messages')
          .update({
            metadata: { ...existingMetadata, studySetIds: updatedStudySetIds },
          })
          .eq('id', responseMessageId)

        if (error) throw new Error(error.message || 'Failed to tag flashcard')

        // Invalidate queries to refresh study set views
        await queryClient.invalidateQueries({ queryKey: ['flashcards-for-study-set'] })
        await queryClient.invalidateQueries({ queryKey: ['studySets'] })
        
        // Trigger a custom event to refresh tag boxes
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flashcard-tagged', { detail: { messageId: responseMessageId } }))
        }
      }
    } catch (error: any) {
      console.error('Failed to tag flashcard:', error)
      alert(error.message || 'Failed to tag flashcard. Please try again.')
    }
  }

  // Handle creating new study set
  const handleCreateStudySet = async () => {
    if (!newStudySetName.trim() || isCreatingStudySet) return

    setIsCreatingStudySet(true)

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

      // Create new study set
      const newStudySetId = crypto.randomUUID()
      const newStudySet = { id: newStudySetId, name: newStudySetName.trim() }
      const updatedStudySets = [...studySets, newStudySet]

      // Update profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({
          metadata: { ...existingMetadata, studySets: updatedStudySets },
        })
        .eq('id', user.id)

      if (error) throw new Error(error.message || 'Failed to create study set')

      // Invalidate queries to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['studySets'] })

      // Tag the flashcard to the new study set
      if (responseMessageId) {
        await handleTagToStudySet(newStudySetId)
      }

      // Reset form
      setNewStudySetName('')
      setShowNewStudySetInput(false)
      
      // Trigger a custom event to refresh tag boxes
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flashcard-tagged', { detail: { messageId: responseMessageId } }))
      }
    } catch (error: any) {
      console.error('Failed to create study set:', error)
      alert(error.message || 'Failed to create study set. Please try again.')
    } finally {
      setIsCreatingStudySet(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={(e) => e.stopPropagation()}
          title="Tag to study set"
        >
          <Plus className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {/* New set button at the top */}
        {!showNewStudySetInput ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setShowNewStudySetInput(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New set
          </DropdownMenuItem>
        ) : (
          <div className="px-2 py-1.5">
            <input
              type="text"
              value={newStudySetName}
              onChange={(e) => setNewStudySetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newStudySetName.trim() && !isCreatingStudySet) {
                  handleCreateStudySet()
                } else if (e.key === 'Escape') {
                  setShowNewStudySetInput(false)
                  setNewStudySetName('')
                }
              }}
              placeholder="Study set name"
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex gap-1 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCreateStudySet()
                }}
                disabled={!newStudySetName.trim() || isCreatingStudySet}
              >
                {isCreatingStudySet ? 'Creating...' : 'Create'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewStudySetInput(false)
                  setNewStudySetName('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {studySets.length > 0 && (
          <>
            {showNewStudySetInput && (
              <div className="h-px bg-gray-200 dark:bg-gray-700 my-1 mx-1" />
            )}
            {studySets.map((studySet) => (
              <DropdownMenuItem
                key={studySet.id}
                onClick={(e) => {
                  e.stopPropagation()
                  handleTagToStudySet(studySet.id)
                }}
              >
                {studySet.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Separate comment button popup component - tracks selection and shows vertical pill on right edge
function CommentButtonPopup({
  editor,
  containerRef,
  onComment,
  onAddReaction,
  section,
  onVisibilityChange,
}: {
  editor: any
  containerRef: React.RefObject<HTMLDivElement>
  onComment: (selectedText: string, from: number, to: number) => void
  onAddReaction?: (selectedText: string, from: number, to: number, emoji: string, section: 'prompt' | 'response') => void
  section?: 'prompt' | 'response'
  onVisibilityChange?: (isVisible: boolean) => void
}) {
  const [showPopup, setShowPopup] = useState(false)
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 })
  const [zoom, setZoom] = useState(1)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false) // Track if emoji picker is open
  const [savedSelection, setSavedSelection] = useState<{ from: number; to: number } | null>(null) // Store selection to preserve it
  const popupRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null) // Ref for emoji picker popup
  const panelContainerRef = useRef<HTMLElement | null>(null)
  const userClearedSelectionRef = useRef(false) // Track if user just clicked to clear selection
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

      // Check if there's a valid selection - must have non-zero length
      if (from === to || from >= to) {
        setShowPopup(false)
        return
      }

      const selectedText = editor.state.doc.textBetween(from, to).trim()
      // Ensure there's actual text content (not just whitespace or empty)
      if (!selectedText || selectedText.length === 0) {
        setShowPopup(false)
        return
      }
      
      // Also verify with native selection to ensure consistency
      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        setShowPopup(false)
        return
      }
      
      const nativeRange = nativeSelection.getRangeAt(0)
      const nativeSelectedText = nativeRange.toString().trim()
      if (!nativeSelectedText || nativeSelectedText.length === 0) {
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

      // Also get the native selection for positioning (already validated above)
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        setShowPopup(false)
        return
      }

      const range = selection.getRangeAt(0)
      // Additional check: ensure range has valid dimensions
      const rangeRect = range.getBoundingClientRect()
      if (rangeRect.width === 0 && rangeRect.height === 0) {
        setShowPopup(false)
        return
      }

      // Get panel's viewport position
      const panelRect = panelElement.getBoundingClientRect()
      
      // Get TipTapContent container's position relative to panel
      // The popup will be positioned relative to containerRef, so we need to account for its offset
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) {
        setShowPopup(false)
        return
      }

      // Calculate selection center for vertical centering
      // Use range rect for accurate selection bounds (includes height)
      const rangeTopRelativeToPanel = rangeRect.top - panelRect.top
      const rangeBottomRelativeToPanel = rangeRect.bottom - panelRect.top
      const selectionHeight = rangeRect.height
      
      // Calculate center of selection (top + height/2) relative to panel
      const selectionCenterRelativeToPanel = rangeTopRelativeToPanel + (selectionHeight / 2)
      
      // Convert to position relative to TipTapContent container (where popup will be rendered)
      const containerTopRelativeToPanel = containerRect.top - panelRect.top
      const selectionCenterRelativeToContainer = selectionCenterRelativeToPanel - containerTopRelativeToPanel

      // Round to avoid sub-pixel issues
      const selectionCenterRounded = Math.round(selectionCenterRelativeToContainer)

      // Horizontal position: align with panel's right edge
      // Get panel's width from its style attribute (this is in panel's local coordinate system, before transform)
      // The panel's width is set via inline style, so it's in the panel's coordinate system
      const panelStyleWidth = panelElement.style.width
      const panelWidth = panelStyleWidth ? parseFloat(panelStyleWidth) : panelElement.offsetWidth
      
      // Get container's left position relative to panel in panel's local coordinate system
      // Since both panel and container are in the same transformed coordinate system,
      // we can use offsetLeft to get the container's position relative to the panel
      // But offsetLeft might not work if there are intermediate containers, so we calculate from viewport coords
      // Convert viewport coordinates to panel's local coordinate system by dividing by zoom
      const zoom = reactFlowInstance?.getViewport().zoom ?? 1
      const containerLeftRelativeToPanel = (containerRect.left - panelRect.left) / zoom
      
      // Calculate panel's right edge relative to container in panel's local coordinate system
      // panelWidth is the panel's width in its local coordinate system
      // containerLeftRelativeToPanel is the container's offset from panel's left edge (in local coords)
      // So: panelWidth - containerLeftRelativeToPanel = distance from container's left to panel's right edge
      const panelRightRelativeToContainer = panelWidth - containerLeftRelativeToPanel
      const horizontalOffset = 12 // 12px gap to the left of panel's right edge

      // Store panel element reference for rendering
      panelContainerRef.current = panelElement

      // Position popup centered vertically with selected text, aligned with panel's right edge
      // Round the position to ensure pixel-perfect alignment
      setPopupPosition({
        top: selectionCenterRounded, // Vertical: center of selection (rounded, relative to container)
        left: panelRightRelativeToContainer - horizontalOffset, // Horizontal: aligned with panel's right edge (relative to container)
      })
      
      // Save the selection to preserve it when popup appears
      setSavedSelection({ from, to })
      
      // Restore selection if it was lost (preserve text selection when popup appears)
      requestAnimationFrame(() => {
        const currentSelection = editor.state.selection
        if (currentSelection.from === currentSelection.to) {
          // Selection was lost, restore it
          editor.commands.setTextSelection({ from, to })
        }
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
  }, [editor, containerRef, reactFlowInstance, showPopup, showEmojiPicker, onVisibilityChange])

  // Notify parent when popup visibility changes
  useEffect(() => {
    onVisibilityChange?.(showPopup)
  }, [showPopup, onVisibilityChange])

  // Detect when user clicks on editor to clear selection
  useEffect(() => {
    if (!showPopup || !savedSelection || !editor) return

    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Check if click is on the editor itself (not on popup or emoji picker)
      const isInEditor = editor.view.dom.contains(target)
      const isInPopup = popupRef.current?.contains(target as Node)
      const isInEmojiPicker = emojiPickerRef.current?.contains(target as Node)
      
      if (isInEditor && !isInPopup && !isInEmojiPicker) {
        // User clicked on editor to clear selection - don't restore it
        userClearedSelectionRef.current = true
        setSavedSelection(null) // Clear saved selection so it won't be restored
        // Reset flag after a short delay
        setTimeout(() => {
          userClearedSelectionRef.current = false
        }, 200)
      }
    }

    // Listen for clicks on the editor
    const editorDom = editor.view.dom
    editorDom.addEventListener('mousedown', handleEditorClick, true)

    return () => {
      editorDom.removeEventListener('mousedown', handleEditorClick, true)
    }
  }, [showPopup, savedSelection, editor])

  // Preserve selection when popup is visible
  useEffect(() => {
    if (!showPopup || !savedSelection) return

    // Periodically check and restore selection if it was lost
    const checkSelection = () => {
      // Don't restore if user just clicked to clear selection
      if (userClearedSelectionRef.current) return
      
      const currentSelection = editor.state.selection
      // If selection was lost (collapsed to a single point), restore it
      if (currentSelection.from === currentSelection.to && savedSelection.from !== savedSelection.to) {
        editor.commands.setTextSelection({ from: savedSelection.from, to: savedSelection.to })
      }
    }

    // Check selection periodically while popup is open
    const interval = setInterval(checkSelection, 100)
    
    // Also check on selection changes
    const handleSelectionUpdate = () => {
      requestAnimationFrame(checkSelection)
    }
    
    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      clearInterval(interval)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [showPopup, savedSelection, editor])

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
        setSavedSelection(null) // Clear saved selection when popup closes
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

    // Use saved selection if current selection is lost
    const { from, to } = savedSelection && editor.state.selection.from === editor.state.selection.to
      ? savedSelection
      : editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)
    if (selectedText.trim()) {
      onComment(selectedText, from, to)
      // Clear selection after commenting
      editor.chain().blur().run()
      setShowPopup(false)
      setSavedSelection(null) // Clear saved selection
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

    // Use saved selection if current selection is lost
    const { from, to } = savedSelection && editor.state.selection.from === editor.state.selection.to
      ? savedSelection
      : editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to).trim()

    if (selectedText && onAddReaction && section) {
      onAddReaction(selectedText, from, to, emojiChar, section)
      // Clear selection after adding reaction
      editor.chain().blur().run()
      setShowPopup(false)
      setShowEmojiPicker(false)
      setSavedSelection(null) // Clear saved selection
    }
  }

  const handleSuggestEditClick = () => {
    // TODO: Implement suggest edit functionality
    console.log('Suggest edit button clicked')
  }

  if (!showPopup || !panelContainerRef.current) return null

  // Render inside panel container so it scales with zoom (like panels do)
  // Position relative to panel container, not viewport
  const relativeTop = popupPosition.top
  const relativeLeft = popupPosition.left

  // Render directly inside panel container (not via portal) so it's in the same stacking context as panel
  // This allows it to scale with React Flow's transform on the panel
  return (
    <div
      ref={popupRef}
      className="absolute pointer-events-auto z-[1000]"
      style={{
        top: `${relativeTop}px`,
        left: `${relativeLeft}px`,
        transform: 'translateY(-50%)', // Center vertically with selected text
      }}
    >
      {/* Vertical pill container with three buttons: comment, emoji, suggest edit */}
      {/* Match flashcard handle width (w-6 = 24px) and styling */}
      <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-0.5 flex flex-col gap-0.5 w-6 items-center justify-center">
        {/* Comment button - top */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCommentClick}
          className="h-6 w-6 p-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Add comment"
        >
          <MessageSquare className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
        </Button>

        {/* Emoji button - middle */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEmojiClick}
            className="h-6 w-6 p-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Add emoji"
          >
            <Smile className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
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
          className="h-6 w-6 p-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Suggest edit"
        >
          <PenSquare className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
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
  const { reactFlowInstance, panelWidth, getSetNodes, flashcardMode, setFlashcardMode, selectedTag } = useReactFlowContext() // Get zoom, panel width, setNodes function, flashcard study mode, and selected tag
  const { setNodes, getNodes } = useReactFlow() // Get setNodes and getNodes for NodeToolbar actions
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
  const [hasCommentPopupVisible, setHasCommentPopupVisible] = useState(false) // Track if comment popup is visible (to hide right handle)
  const panelRef = useRef<HTMLDivElement>(null) // Ref to panel container for positioning comment box
  const commentPanelsRef = useRef<HTMLDivElement>(null) // Ref to comment panels container for click-away detection
  const hasInitialShrunkRef = useRef<string | null>(null) // Track which panel ID we've done initial shrink for
  const [isInitialShrinkComplete, setIsInitialShrinkComplete] = useState(false) // Track if initial shrink is done (for hiding panel until ready)
  const promptEditorRef = useRef<any>(null) // Ref to prompt editor instance
  const responseEditorRef = useRef<any>(null) // Ref to response editor instance
  const newCommentTextareaRef = useRef<HTMLTextAreaElement>(null) // Ref for new comment textarea
  const replyTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({}) // Refs for reply textareas
  const hasAutoFocusedRef = useRef(false) // Track if note editor has been auto-focused
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
  // If fillColor is provided, convert to rgba with 0.15 opacity
  // If fillColor is empty/transparent, use fully transparent background
  const panelBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      return hexToRgba(data.fillColor, 0.15) // Maintain 15% opacity for transparency
    }
    return 'transparent' // Fully transparent when no fill color is set
  }, [data.fillColor, hexToRgba])

  // Calculate prompt/grey area background color
  // Dark mode: 10% opacity, Light mode: 15% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // If fillColor is empty/transparent, use fully transparent
  const promptAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 10% opacity, Light mode: 15% opacity
      const opacity = resolvedTheme === 'dark' ? 0.10 : 0.15
      return hexToRgba(data.fillColor, opacity)
    }
    return 'transparent' // Fully transparent when no fill color is set
  }, [data.fillColor, resolvedTheme, hexToRgba])

  // Calculate response/white area background color
  // Dark mode: 15% opacity, Light mode: 10% opacity
  // If fillColor is provided, use that color with theme-specific opacity
  // If fillColor is empty/transparent, use fully transparent
  const responseAreaBackgroundColor = useMemo(() => {
    if (data.fillColor) {
      // Dark mode: 15% opacity, Light mode: 10% opacity
      const opacity = resolvedTheme === 'dark' ? 0.15 : 0.10
      return hexToRgba(data.fillColor, opacity)
    }
    return 'transparent' // Fully transparent when no fill color is set
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

  // Calculate hover/active handle color - same as handleColor (matches panel background color)
  // Uses same calculation as handleColor to match prompt panel background (with transparency blended to solid)
  const handleHoverColor = useMemo(() => {
    // Use the same color as default handleColor - matches panel background color calculation
    // This ensures hover/click state uses the panel background color, not black
    return handleColor
  }, [handleColor])

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
    return resolvedTheme === 'dark' ? '#2f2f2f' : '#e5e7eb'
  }, [data.borderColor, resolvedTheme])

  // Check if panel is minimal (transparent fill + no border)
  // When minimal and not selected, handles should be hidden
  // Handle null/undefined/empty string for fillColor and null/undefined/'none' for borderStyle
  const isFillTransparent = !data.fillColor || data.fillColor === '' || data.fillColor === null
  const isBorderNone = !data.borderStyle || data.borderStyle === 'none' || data.borderStyle === null
  const isMinimalPanel = isFillTransparent && isBorderNone
  const shouldHideHandles = isMinimalPanel && !selected

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
  // Determine if this is a note (simple note node, not a full chat panel)
  // Check metadata.isNote flag, or if it's an empty user message with no response
  const isNote = promptMessage?.metadata?.isNote === true || 
    (promptMessage?.role === 'user' && 
     !responseMessage && 
     (!promptMessage?.content || promptMessage.content.trim() === '' || promptMessage.content === '<p></p>' || promptMessage.content === '<p><br></p>'))
  // Regular chat panels are those that are not flashcards and not notes
  const isRegularChatPanel = !isFlashcard && !isNote

  // NodeToolbar handler to toggle collapse state for this specific node
  // Uses useReactFlow's setNodes to update the node's data directly
  const handleToolbarCondense = useCallback(() => {
    const newCollapsedState = !isResponseCollapsed // Toggle the current collapse state
    setIsResponseCollapsed(newCollapsedState) // Update local state
    
    // Hide prompt more menu immediately when collapsing
    if (newCollapsedState) {
      setShowPromptMoreMenu(false)
    } else {
      // Show prompt more menu after 0.2s delay when expanding to prevent flash
      setTimeout(() => {
        setShowPromptMoreMenu(true)
      }, 200)
    }
    
    // Update the node's data in React Flow state
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, isResponseCollapsed: newCollapsedState } }
          : node
      )
    )
  }, [id, isResponseCollapsed, setNodes])

  // NodeToolbar handler to copy panel content to clipboard
  // Copies prompt content for notes, or prompt + response for other panels
  const handleToolbarCopy = useCallback(async () => {
    try {
      // For notes, only copy prompt content (they don't have responses)
      if (isNote) {
        await navigator.clipboard.writeText(promptContent || '')
      } else {
        // For chat panels, copy both prompt and response
        const textToCopy = `${promptContent || ''}\n\n${responseContent || ''}`.trim()
        await navigator.clipboard.writeText(textToCopy)
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }, [isNote, promptContent, responseContent])

  // Auto-select panel when editor is focused or has selection (text edit mode)
  const handleEditorActiveChange = useCallback((isActive: boolean) => {
    if (isActive && !selected) {
      // Editor is active (focused or has selection) but panel is not selected - auto-select it
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, selected: true }
            : node
        )
      )
    }
  }, [id, selected, setNodes])

  // Flashcard navigation - get all flashcards in the same board/project/study set
  // For regular boards that are part of a project, also enable cross-board navigation
  // Fetch project ID from board metadata if it's a regular board
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null)
  
  useEffect(() => {
    if (isProjectBoard || !conversationId || !isFlashcard) {
      setBoardProjectId(null)
      return
    }
    
    // Fetch conversation metadata to get project_id
    const fetchProjectId = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single()
      
      if (!error && data?.metadata) {
        const metadata = data.metadata as Record<string, any>
        const projectId = metadata.project_id
        if (projectId) {
          setBoardProjectId(projectId)
        } else {
          setBoardProjectId(null)
        }
      } else {
        setBoardProjectId(null)
      }
    }
    
    fetchProjectId()
  }, [conversationId, isProjectBoard, isFlashcard, supabase])
  
  // Fetch all boards in the project (if board is part of a project)
  const { data: projectBoards = [] } = useQuery({
    queryKey: ['project-boards-for-flashcards', boardProjectId],
    queryFn: async () => {
      if (!boardProjectId) return []
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, metadata')
        .eq('user_id', user.id)
        .contains('metadata', { project_id: boardProjectId })
      
      if (error) {
        console.error('Error fetching project boards:', error)
        return []
      }
      return (data || []) as Array<{ id: string; title: string; metadata: any }>
    },
    enabled: !!boardProjectId && !isProjectBoard,
  })
  
  // Fetch flashcards from all boards (project or all boards if tag selected) to check if there are flashcards in other boards
  const { data: projectFlashcards = [] } = useQuery({
    queryKey: ['project-flashcards', boardProjectId, projectBoards.map(b => b.id).join(','), selectedTag],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      
      let boardIds: string[] = []
      
      // If a tag is selected, search across ALL boards (not just project)
      if (selectedTag) {
        // Fetch all user's boards
        const { data: allBoards, error: boardsError } = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', user.id)
        
        if (boardsError) {
          console.error('Error fetching all boards:', boardsError)
          return []
        }
        
        boardIds = (allBoards || []).map(b => b.id)
      } else if (boardProjectId && projectBoards.length > 0) {
        // No tag selected, use project boards
        boardIds = projectBoards.map(b => b.id)
      } else {
        return []
      }
      
      if (boardIds.length === 0) return []
      
      // Fetch all messages from relevant boards
      const { data: allMessages, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at, metadata, conversation_id')
        .eq('user_id', user.id)
        .in('conversation_id', boardIds)
        .order('created_at', { ascending: true })
      
      if (error) {
        console.error('Error fetching flashcards:', error)
        return []
      }
      
      if (!allMessages || allMessages.length === 0) return []
      
      // Filter for flashcards (user messages with isFlashcard metadata)
      // If tag is selected, also filter by studySetIds in the response message
      const flashcards: Array<{ boardId: string; messageId: string }> = []
      for (let i = 0; i < allMessages.length; i++) {
        const message = allMessages[i]
        if (message.role === 'user') {
          const metadata = (message.metadata as Record<string, any>) || {}
          if (metadata.isFlashcard === true) {
            // If tag is selected, check if the response message has that tag
            if (selectedTag) {
              // Find the next assistant message (response) for this flashcard
              let hasTag = false
              for (let j = i + 1; j < allMessages.length && allMessages[j].conversation_id === message.conversation_id; j++) {
                if (allMessages[j].role === 'assistant') {
                  const responseMetadata = (allMessages[j].metadata as Record<string, any>) || {}
                  const studySetIds = (responseMetadata.studySetIds || []) as string[]
                  if (studySetIds.includes(selectedTag)) {
                    hasTag = true
                    break
                  }
                  // Only check the first response message for this flashcard
                  break
                }
              }
              if (!hasTag) {
                continue // Skip flashcards without the selected tag
              }
            }
            
            flashcards.push({
              boardId: message.conversation_id || '',
              messageId: message.id
            })
          }
        }
      }
      
      return flashcards
    },
    enabled: (!!boardProjectId && !isProjectBoard && projectBoards.length > 0) || (!!selectedTag && isFlashcard),
  })
  
  // Check if there are flashcards in other boards (project or all boards if tag selected)
  const hasFlashcardsInOtherBoards = useMemo(() => {
    if (!projectFlashcards.length) return false
    
    // If tag is selected, check all boards (not just project)
    // Otherwise, check project boards only
    if (selectedTag) {
      // With tag selected, check if there are flashcards in any other board
      const otherBoardsFlashcards = projectFlashcards.filter(f => f.boardId !== conversationId)
      return otherBoardsFlashcards.length > 0
    } else {
      // No tag selected - only check project boards
      if (!boardProjectId || !conversationId) return false
      const otherBoardsFlashcards = projectFlashcards.filter(f => f.boardId !== conversationId)
      return otherBoardsFlashcards.length > 0
    }
  }, [boardProjectId, conversationId, projectFlashcards, selectedTag])
  
  // Use state to track nodes and force recomputation when nodes change
  const [flashcardCount, setFlashcardCount] = useState(0)
  
  // Update flashcard count when nodes change (using effect to watch for node changes)
  useEffect(() => {
    if (!reactFlowInstance || !isFlashcard) {
      setFlashcardCount(0)
      return
    }
    
    // Function to compute and update flashcard count
    const updateFlashcardCount = () => {
      const allNodes = reactFlowInstance.getNodes() || []
      const count = allNodes.filter((node) => {
        const nodeData = node.data as ChatPanelNodeData
        const nodeIsFlashcard = nodeData.promptMessage?.metadata?.isFlashcard === true
        if (!nodeIsFlashcard) return false
        
        // For project boards, check projectId
        if (isProjectBoard && projectId) {
          const nodeIsProjectBoard = isProjectBoardData(node.data)
          return nodeIsProjectBoard && node.data.projectId === projectId
        }
        
        // For regular boards, check conversationId
        if (conversationId) {
          return nodeData.conversationId === conversationId
        }
        
        // For study sets, include all flashcards
        return true
      }).length
      
      setFlashcardCount(count)
    }
    
    // Check immediately
    updateFlashcardCount()
    
    // Set up interval to check for changes (since React Flow doesn't expose node change events directly)
    const interval = setInterval(updateFlashcardCount, 300) // Check every 300ms
    
    return () => clearInterval(interval)
  }, [reactFlowInstance, isFlashcard, conversationId, isProjectBoard, projectId])
  
  const flashcardNodes = useMemo(() => {
    if (!isFlashcard || !reactFlowInstance) return []
    const allNodes = reactFlowInstance.getNodes() || []
    // Filter for flashcards in the same context (board/project/study set)
    // If tag is selected, also filter by tag
    return allNodes.filter((node) => {
      const nodeData = node.data as ChatPanelNodeData
      const nodeIsFlashcard = nodeData.promptMessage?.metadata?.isFlashcard === true
      if (!nodeIsFlashcard) return false
      
      // If tag is selected, check if flashcard has that tag (check response message metadata)
      if (selectedTag) {
        const responseMessage = nodeData.responseMessage
        if (responseMessage?.metadata) {
          const metadata = responseMessage.metadata as Record<string, any>
          const studySetIds = (metadata.studySetIds || []) as string[]
          if (!studySetIds.includes(selectedTag)) {
            return false // Skip flashcards without the selected tag
          }
        } else {
          return false // No response message or metadata, can't have the tag
        }
      }
      
      // If tag is selected, include flashcards from all boards (not just current context)
      if (selectedTag) {
        return true // Include all flashcards with the selected tag, regardless of board
      }
      
      // No tag selected - use original context filtering
      // For project boards, check projectId
      if (isProjectBoard && projectId) {
        const nodeIsProjectBoard = isProjectBoardData(node.data)
        if (nodeIsProjectBoard && node.data.projectId === projectId) return true
        return false
      }
      
      // For regular boards, check conversationId
      if (conversationId) {
        if (nodeData.conversationId === conversationId) return true
        return false
      }
      
      // For study sets (no conversationId or projectId), include all flashcards
      return true
    })
  }, [isFlashcard, reactFlowInstance, conversationId, isProjectBoard, projectId, flashcardCount, selectedTag])

  const currentFlashcardIndex = useMemo(() => {
    if (!isFlashcard || flashcardNodes.length === 0) return -1
    return flashcardNodes.findIndex((node) => node.id === id)
  }, [isFlashcard, flashcardNodes, id])

  const hasMultipleFlashcards = flashcardNodes.length > 1
  
  // Check if we're at the last flashcard in the current board
  // If there's only one flashcard in the board, it's both first and last
  const isAtLastFlashcardInBoard = useMemo(() => {
    if (currentFlashcardIndex < 0 || flashcardNodes.length === 0) return false
    return currentFlashcardIndex === flashcardNodes.length - 1
  }, [currentFlashcardIndex, flashcardNodes.length])
  
  // Check if we're at the first flashcard in the current board
  // If there's only one flashcard in the board, it's both first and last
  const isAtFirstFlashcardInBoard = useMemo(() => {
    if (currentFlashcardIndex < 0) return false
    return currentFlashcardIndex === 0
  }, [currentFlashcardIndex])

  // Find the next board with flashcards (all boards if tag selected, otherwise project boards)
  const nextBoardWithFlashcards = useMemo(() => {
    if (!hasFlashcardsInOtherBoards || !conversationId) return null
    
    // If tag is selected, get all boards from projectFlashcards (which includes all boards)
    // Otherwise, use projectBoards
    let boardsToSearch: Array<{ id: string; title: string }> = []
    if (selectedTag) {
      // Get unique board IDs from projectFlashcards
      const uniqueBoardIds = [...new Set(projectFlashcards.map(f => f.boardId))]
      // Fetch board titles (we'll use IDs for now, titles aren't critical for navigation)
      boardsToSearch = uniqueBoardIds.map(id => ({ id, title: '' }))
    } else {
      boardsToSearch = projectBoards
    }
    
    if (!boardsToSearch.length) return null
    
    // Find current board index
    const currentBoardIndex = boardsToSearch.findIndex(b => b.id === conversationId)
    if (currentBoardIndex < 0) return null
    
    // Find next board that has flashcards (with selected tag if tag is selected)
    for (let i = 1; i < boardsToSearch.length; i++) {
      const nextBoardIndex = (currentBoardIndex + i) % boardsToSearch.length
      const nextBoard = boardsToSearch[nextBoardIndex]
      // Check if this board has flashcards (with selected tag if tag is selected)
      const hasFlashcards = projectFlashcards.some(f => f.boardId === nextBoard.id)
      if (hasFlashcards) {
        return nextBoard
      }
    }
    
    return null
  }, [hasFlashcardsInOtherBoards, conversationId, projectBoards, projectFlashcards, selectedTag])
  
  // Find the previous board with flashcards (all boards if tag selected, otherwise project boards)
  const previousBoardWithFlashcards = useMemo(() => {
    if (!hasFlashcardsInOtherBoards || !conversationId) return null
    
    // If tag is selected, get all boards from projectFlashcards (which includes all boards)
    // Otherwise, use projectBoards
    let boardsToSearch: Array<{ id: string; title: string }> = []
    if (selectedTag) {
      // Get unique board IDs from projectFlashcards
      const uniqueBoardIds = [...new Set(projectFlashcards.map(f => f.boardId))]
      boardsToSearch = uniqueBoardIds.map(id => ({ id, title: '' }))
    } else {
      boardsToSearch = projectBoards
    }
    
    if (!boardsToSearch.length) return null
    
    const currentBoardIndex = boardsToSearch.findIndex(b => b.id === conversationId)
    if (currentBoardIndex < 0) return null
    
    // Find previous board that has flashcards (with selected tag if tag is selected)
    for (let i = 1; i < boardsToSearch.length; i++) {
      const previousBoardIndex = currentBoardIndex === 0 
        ? boardsToSearch.length - i 
        : (currentBoardIndex - i + boardsToSearch.length) % boardsToSearch.length
      const previousBoard = boardsToSearch[previousBoardIndex]
      // Check if this board has flashcards (with selected tag if tag is selected)
      const hasFlashcards = projectFlashcards.some(f => f.boardId === previousBoard.id)
      if (hasFlashcards) {
        return previousBoard
      }
    }
    
    return null
  }, [hasFlashcardsInOtherBoards, conversationId, projectBoards, projectFlashcards, selectedTag])

  // Ref to track when navigation is in progress (prevents deselect effect from exiting nav mode)
  const isNavigatingRef = useRef(false)

  // Navigate to previous flashcard (loops to last if at first, or to previous board if available)
  const navigateToPreviousFlashcard = useCallback(() => {
    // Allow navigation even with single flashcard if there are flashcards in other boards
    // If there's only one flashcard in the board, this will just loop to itself (which is fine for the single arrow)
    if ((!hasMultipleFlashcards && !hasFlashcardsInOtherBoards) || !reactFlowInstance || !getSetNodes || currentFlashcardIndex < 0) return
    
    // Mark that we're navigating (prevents deselect effect from exiting nav mode)
    isNavigatingRef.current = true
    
    // Enable flashcard mode to blur non-flashcard content during navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    
    // Loop: if at first flashcard, go to last; otherwise go to previous
    // If there's only one flashcard, this will loop to itself (index 0 -> index 0)
    const previousIndex = currentFlashcardIndex === 0 
      ? flashcardNodes.length - 1 
      : currentFlashcardIndex - 1
    const previousNode = flashcardNodes[previousIndex]
    if (previousNode) {
      const setNodes = getSetNodes()
      if (setNodes) {
        // Get current state of the target node
        const allNodes = reactFlowInstance.getNodes()
        const targetNode = allNodes.find(n => n.id === previousNode.id)
        const isTargetExpanded = !targetNode?.data?.isResponseCollapsed
        
        // If target is expanded, collapse it
        if (isTargetExpanded) {
          setNodes((nds: any[]) =>
            nds.map((n: any) => {
              if (n.id === previousNode.id) {
                return { ...n, data: { ...n.data, isResponseCollapsed: true } }
              }
              return n
            })
          )
        }
        
        // Deselect all nodes and select target
        setNodes((nds: any[]) =>
          nds.map((n: any) => ({ ...n, selected: n.id === previousNode.id }))
        )
        // Scroll to the previous flashcard
        reactFlowInstance.fitView({ nodes: [{ id: previousNode.id }], padding: 0.2, duration: 300 })
        
        // Reset navigation flag after a short delay (allows React to process the selection change)
        setTimeout(() => {
          isNavigatingRef.current = false
        }, 100)
      }
    }
  }, [hasMultipleFlashcards, hasFlashcardsInOtherBoards, flashcardNodes, currentFlashcardIndex, reactFlowInstance, getSetNodes, flashcardMode, setFlashcardMode])

  // Navigate to next flashcard (loops to first if at last, or to next board if available)
  const navigateToNextFlashcard = useCallback(() => {
    // Allow navigation even with single flashcard if there are flashcards in other boards
    // If there's only one flashcard in the board, this will just loop to itself (which is fine for the single arrow)
    if ((!hasMultipleFlashcards && !hasFlashcardsInOtherBoards) || !reactFlowInstance || !getSetNodes || currentFlashcardIndex < 0) return
    
    // Mark that we're navigating (prevents deselect effect from exiting nav mode)
    isNavigatingRef.current = true
    
    // Enable flashcard mode to blur non-flashcard content during navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    
    // Loop: if at last flashcard, go to first; otherwise go to next
    // If there's only one flashcard, this will loop to itself (index 0 -> index 0)
    const nextIndex = currentFlashcardIndex === flashcardNodes.length - 1 
      ? 0 
      : currentFlashcardIndex + 1
    const nextNode = flashcardNodes[nextIndex]
    if (nextNode) {
      const setNodes = getSetNodes()
      if (setNodes) {
        // Get current state of the target node
        const allNodes = reactFlowInstance.getNodes()
        const targetNode = allNodes.find(n => n.id === nextNode.id)
        const isTargetExpanded = !targetNode?.data?.isResponseCollapsed
        
        // If target is expanded, collapse it
        if (isTargetExpanded) {
          setNodes((nds: any[]) =>
            nds.map((n) => {
              if (n.id === nextNode.id) {
                return { ...n, data: { ...n.data, isResponseCollapsed: true } }
              }
              return n
            })
          )
        }
        
        // Deselect all nodes and select target
        setNodes((nds: any[]) =>
          nds.map((n) => ({ ...n, selected: n.id === nextNode.id }))
        )
        // Scroll to the next flashcard
        reactFlowInstance.fitView({ nodes: [{ id: nextNode.id }], padding: 0.2, duration: 300 })
        
        // Reset navigation flag after a short delay (allows React to process the selection change)
        setTimeout(() => {
          isNavigatingRef.current = false
        }, 100)
      }
    }
  }, [hasMultipleFlashcards, hasFlashcardsInOtherBoards, flashcardNodes, currentFlashcardIndex, reactFlowInstance, getSetNodes, flashcardMode, setFlashcardMode])
  
  // Navigate to next board's first flashcard
  const navigateToNextBoard = useCallback(() => {
    if (!nextBoardWithFlashcards) return
    // Enable flashcard mode to blur non-flashcard content during navigation
    // Pass nav mode and selected tag via URL param to maintain it across board navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    // Include selected tag in URL if one is selected
    const tagParam = selectedTag ? `&tag=${selectedTag}` : ''
    router.push(`/board/${nextBoardWithFlashcards.id}?nav=flashcard${tagParam}`)
  }, [nextBoardWithFlashcards, router, flashcardMode, setFlashcardMode, selectedTag])
  
  // Navigate to previous board's last flashcard
  const navigateToPreviousBoard = useCallback(() => {
    if (!previousBoardWithFlashcards) return
    // Enable flashcard mode to blur non-flashcard content during navigation
    // Pass nav mode and selected tag via URL param to maintain it across board navigation
    if (flashcardMode !== 'flashcard') {
      setFlashcardMode('flashcard')
    }
    // Include selected tag in URL if one is selected
    const tagParam = selectedTag ? `&tag=${selectedTag}` : ''
    router.push(`/board/${previousBoardWithFlashcards.id}?nav=flashcard${tagParam}`)
  }, [previousBoardWithFlashcards, router, flashcardMode, setFlashcardMode, selectedTag])

  // Track previous selected state to detect deselection
  const prevSelectedRef = useRef(selected)
  
  // Track if selection is being restored from map click (to prevent nav mode exit)
  const isRestoringSelectionRef = useRef(false)
  
  // Listen for selection restoration events from board-flow
  useEffect(() => {
    const handleRestoring = () => {
      isRestoringSelectionRef.current = true
    }
    const handleRestored = () => {
      isRestoringSelectionRef.current = false
    }
    
    window.addEventListener('restoring-selection-from-map-click', handleRestoring)
    window.addEventListener('selection-restored-from-map-click', handleRestored)
    
    return () => {
      window.removeEventListener('restoring-selection-from-map-click', handleRestoring)
      window.removeEventListener('selection-restored-from-map-click', handleRestored)
    }
  }, [])
  
  // Exit nav mode when flashcard is deselected (user clicks elsewhere, not during arrow navigation or map click restoration)
  useEffect(() => {
    // Only handle deselection for flashcards when nav mode is active
    if (isFlashcard && flashcardMode !== null) {
      // Check if flashcard was selected and is now deselected
      if (prevSelectedRef.current && !selected) {
        // Skip if we're navigating between flashcards (arrow was clicked) or restoring selection from map click
        if (!isNavigatingRef.current && !isRestoringSelectionRef.current) {
          // User clicked elsewhere to deselect - exit nav mode
          setFlashcardMode(null)
        }
      }
    }
    // Update ref for next render
    prevSelectedRef.current = selected
  }, [selected, isFlashcard, flashcardMode, setFlashcardMode])

  // Get current zoom level and update panel width when zoom is 100% or less
  const [currentZoom, setCurrentZoom] = useState(reactFlowInstance?.getViewport().zoom ?? 1)
  // Check if this is a note panel (from + dropdown or inline double-click) - should use fit-content width
  const isNotePanel = promptMessage?.metadata?.isNote === true
  // Notes use fit-content width, flashcards and regular panels use fixed width
  const usesFitContent = isNotePanel
  // Regular chat panels start at max width (768), flashcards start at 600, notes use fit-content
  const initialWidth = isFlashcard ? 600 : (isRegularChatPanel ? 768 : 768) // Regular panels start at max, flashcards at 600
  const [panelWidthToUse, setPanelWidthToUse] = useState(initialWidth)
  // Ref to track current width (avoids stale closures in callbacks)
  const panelWidthRef = useRef(initialWidth)
  // Track maximum width panel has been (so it doesn't grow beyond current width)
  const [maxPanelWidth, setMaxPanelWidth] = useState(isFlashcard ? 600 : 768)
  // Track if panel has been manually shrunk (so zoom effect doesn't override it)
  const [isManuallyShrunk, setIsManuallyShrunk] = useState(false)
  // Track if note panel uses fit-content (to prevent zoom-based width updates)
  const noteInitializedRef = useRef(usesFitContent)

  // Continuously check zoom level and update panel width
  useEffect(() => {
    if (!reactFlowInstance) return

    const updateZoomAndWidth = () => {
      const zoom = reactFlowInstance.getViewport().zoom
      setCurrentZoom(zoom)

      const targetMaxWidth = isFlashcard ? 600 : 768

      // Don't override manually shrunk width - only update if not manually shrunk
      if (isManuallyShrunk) {
        return // Keep the manually set width
      }
      
      // Note panels use fit-content and should not be affected by zoom-based width updates
      // Let the content determine their width naturally
      if (noteInitializedRef.current) {
        return // Keep note panel at fit-content width
      }

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
  }, [reactFlowInstance, panelWidth, isManuallyShrunk])

  // Track zoom level when nav mode started (to detect zoom out)
  const navModeStartZoomRef = useRef<number | null>(null)
  const [isZoomedOutInNavMode, setIsZoomedOutInNavMode] = useState(false)
  
  // Track zoom changes in nav mode to detect zoom out
  useEffect(() => {
    if (!reactFlowInstance) return
    
    // Reset when nav mode is exited
    if (flashcardMode === null) {
      navModeStartZoomRef.current = null
      setIsZoomedOutInNavMode(false)
      return
    }
    
    // Reset zoom reference when board changes (conversationId changes)
    // This ensures zoom detection is recalculated for the new board
    // Wait a bit for fitView to complete (if called) before starting zoom tracking
    navModeStartZoomRef.current = null
    setIsZoomedOutInNavMode(false)
    
    let intervalId: NodeJS.Timeout | null = null
    
    // Delay before starting zoom tracking to allow fitView to complete
    // fitView duration is 300ms, so wait 400ms to be safe
    const startTrackingTimeout = setTimeout(() => {
      const checkZoomChange = () => {
        const currentZoomLevel = reactFlowInstance.getViewport().zoom
        
        // Store the zoom level when nav mode first started (or when board changed)
        if (navModeStartZoomRef.current === null) {
          navModeStartZoomRef.current = currentZoomLevel
          // Check initial zoom - if less than 200%, unblur non-flashcard content
          if (currentZoomLevel < 2.0) {
            setIsZoomedOutInNavMode(true)
          } else {
            setIsZoomedOutInNavMode(false)
          }
          return
        }
        
        // After board switch, unblur if zoom is less than 200% (2.0)
        // This allows users to see all flashcards when zoomed out
        if (currentZoomLevel < 2.0) {
          // Zoom is less than 200% - show all flashcards but keep non-flashcards blurred
          setIsZoomedOutInNavMode(true)
        } else {
          // Zoom is 200% or more - return to single flashcard focus
          setIsZoomedOutInNavMode(false)
        }
      }
      
      // Check zoom changes periodically
      intervalId = setInterval(checkZoomChange, 200)
    }, 400)
    
    return () => {
      clearTimeout(startTrackingTimeout)
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [reactFlowInstance, flashcardMode, conversationId])

  // Update max width when panel width increases (so it doesn't grow beyond current width)
  useEffect(() => {
    if (panelWidthToUse > maxPanelWidth) {
      setMaxPanelWidth(panelWidthToUse)
    }
    // Keep ref in sync with state
    panelWidthRef.current = panelWidthToUse
  }, [panelWidthToUse, maxPanelWidth])

  // Ensure DOM width stays in sync after any re-render (prevents wrapping on selection change)
  // Skip for fit-content panels - CSS handles their width automatically
  useEffect(() => {
    if (usesFitContent) return // Don't set width for fit-content panels
    
    if (panelRef.current && panelWidthRef.current) {
      panelRef.current.style.width = `${panelWidthRef.current}px`
    }
  })

  // Measure text content width as single line (before wrapping) to expand panel before text wraps
  const measureTextWidth = useCallback(() => {
    if (!panelRef.current) return null

    const panelElement = panelRef.current
    
    // Get all prose content elements (prompt and response)
    const proseElements = panelElement.querySelectorAll('.prose')
    if (proseElements.length === 0) {
      // Fallback: check for any text content in the panel
      const textContent = panelElement.textContent?.trim() || ''
      if (!textContent) return null
      // If there's text but no prose elements, measure using a temporary element
      const tempDiv = document.createElement('div')
      tempDiv.style.position = 'absolute'
      tempDiv.style.visibility = 'hidden'
      tempDiv.style.whiteSpace = 'nowrap' // Measure as single line (before wrapping)
      tempDiv.style.fontSize = window.getComputedStyle(panelElement).fontSize || '16px'
      tempDiv.style.fontFamily = window.getComputedStyle(panelElement).fontFamily || 'inherit'
      tempDiv.style.fontWeight = window.getComputedStyle(panelElement).fontWeight || 'normal'
      tempDiv.style.lineHeight = window.getComputedStyle(panelElement).lineHeight || 'normal'
      tempDiv.textContent = textContent
      document.body.appendChild(tempDiv)
      const textWidth = tempDiv.offsetWidth
      document.body.removeChild(tempDiv)
      return Math.max(200, Math.min(textWidth + 24 + 2, maxPanelWidth))
    }

    // Create a temporary element to measure text width with nowrap
    const tempMeasureDiv = document.createElement('div')
    tempMeasureDiv.style.position = 'absolute'
    tempMeasureDiv.style.visibility = 'hidden'
    tempMeasureDiv.style.whiteSpace = 'nowrap' // Measure as single line (before wrapping)
    tempMeasureDiv.style.fontSize = window.getComputedStyle(panelElement).fontSize || '16px'
    tempMeasureDiv.style.fontFamily = window.getComputedStyle(panelElement).fontFamily || 'inherit'
    tempMeasureDiv.style.fontWeight = window.getComputedStyle(panelElement).fontWeight || 'normal'
    tempMeasureDiv.style.lineHeight = window.getComputedStyle(panelElement).lineHeight || 'normal'
    document.body.appendChild(tempMeasureDiv)
    
    try {
      // Find the maximum width needed by measuring text as single-line (before wrapping)
      let maxContentWidth = 0
      
      proseElements.forEach((proseEl) => {
        const proseElement = proseEl as HTMLElement
        
        // Get all block-level text elements (p, h1-h6, li, blockquote)
        const blockElements = proseElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')
        
        if (blockElements.length > 0) {
          // Measure each block element's text as a single line
          blockElements.forEach((blockEl) => {
            const element = blockEl as HTMLElement
            // Get plain text content (without HTML tags)
            const textContent = element.textContent?.trim() || ''
            if (textContent) {
              // Set text content and measure width as single line
              tempMeasureDiv.textContent = textContent
              const contentWidth = tempMeasureDiv.offsetWidth
              maxContentWidth = Math.max(maxContentWidth, contentWidth)
            }
          })
        } else {
          // Fallback: measure the prose element's text content directly
          const textContent = proseElement.textContent?.trim() || ''
          if (textContent) {
            tempMeasureDiv.textContent = textContent
            const contentWidth = tempMeasureDiv.offsetWidth
            maxContentWidth = Math.max(maxContentWidth, contentWidth)
          }
        }
      })

      if (maxContentWidth === 0) return null

      // Add panel padding (px-3 = 12px on each side = 24px total) and border (1px each side = 2px total)
      const totalWidth = maxContentWidth + 24 + 2
      
      // Return minimum width (at least 200px for usability, but not more than max width)
      return Math.max(200, Math.min(totalWidth, maxPanelWidth))
    } finally {
      // Clean up temporary element
      document.body.removeChild(tempMeasureDiv)
    }
  }, [maxPanelWidth])

  // Measure text width directly from HTML content string (before rendering) - prevents wrapping
  const measureTextWidthFromContent = useCallback((content: string) => {
    if (!content || !panelRef.current) return null

    const panelElement = panelRef.current
    
    // Try to get styles from existing prose element (more accurate)
    const proseElement = panelElement.querySelector('.prose') as HTMLElement
    const stylesSource = proseElement || panelElement
    
    // Get computed styles from the element where text is actually rendered
    const computedStyle = window.getComputedStyle(stylesSource)
    
    // Create a temporary element to measure text width
    const tempDiv = document.createElement('div')
    tempDiv.style.position = 'absolute'
    tempDiv.style.visibility = 'hidden'
    tempDiv.style.whiteSpace = 'nowrap' // Measure as single line (before wrapping)
    tempDiv.style.fontSize = computedStyle.fontSize || '16px'
    tempDiv.style.fontFamily = computedStyle.fontFamily || 'inherit'
    tempDiv.style.fontWeight = computedStyle.fontWeight || 'normal'
    tempDiv.style.lineHeight = computedStyle.lineHeight || 'normal'
    tempDiv.style.letterSpacing = computedStyle.letterSpacing || 'normal'
    
    // Strip HTML tags to get plain text for measurement
    const tempTextDiv = document.createElement('div')
    tempTextDiv.innerHTML = content
    const plainText = tempTextDiv.textContent || tempTextDiv.innerText || ''
    
    if (!plainText.trim()) return null
    
    tempDiv.textContent = plainText
    document.body.appendChild(tempDiv)
    
    const textWidth = tempDiv.offsetWidth
    document.body.removeChild(tempDiv)
    
    // Add panel padding (px-3 = 12px on each side = 24px total), border (1px each side = 2px total),
    // and a small buffer (10px) to prevent edge-case wrapping due to font rendering differences
    const totalWidth = textWidth + 24 + 2 + 10
    
    // Return minimum width (at least 200px for usability, but not more than max width)
    return Math.max(200, Math.min(totalWidth, maxPanelWidth))
  }, [maxPanelWidth])

  // Expand or shrink panel width as text changes
  // Regular chat panels only expand (never shrink), flashcards can expand and shrink
  // Always measures both prompt and response to get the maximum width needed
  // Wrapping should not happen if panel is not at max width
  // CRITICAL: Sets DOM width directly (synchronously) to prevent wrapping before React re-renders
  const expandPanelWidth = useCallback((newContent?: string) => {
    // Skip for fit-content panels (notes) - CSS handles their width automatically
    if (usesFitContent) return
    
    // Always measure both prompt and response to get the maximum width needed
    // If newContent is provided (prompt change), use it; otherwise use current promptContent
    const promptToMeasure = newContent !== undefined ? newContent : promptContent
    const promptWidth = measureTextWidthFromContent(promptToMeasure) || 0
    const responseWidth = measureTextWidthFromContent(responseContent) || 0
    
    // Use the maximum of prompt and response widths
    const minWidth = isFlashcard ? 300 : 200
    const measuredTotalWidth = Math.max(promptWidth, responseWidth, minWidth)
    
    if (measuredTotalWidth) {
      // Use ref to get current width (avoids stale closure issues)
      const currentWidth = panelWidthRef.current
      
      // Regular chat panels: only expand (never shrink from max width)
      // Flashcards: expand or shrink to fit content
      if (isRegularChatPanel) {
        // Only expand if text is wider than current width
        if (measuredTotalWidth > currentWidth) {
          const newWidth = Math.min(measuredTotalWidth, maxPanelWidth)
          
          // CRITICAL: Set width on DOM element FIRST (synchronously) to prevent wrapping
          // React state update is async, so text would wrap before state is applied
          if (panelRef.current) {
            panelRef.current.style.width = `${newWidth}px`
          }
          
          // Update ref immediately (synchronous)
          panelWidthRef.current = newWidth
          
          // Then update state to keep it in sync (async, but DOM is already updated)
          setPanelWidthToUse(newWidth)
          setIsManuallyShrunk(true) // Mark as manually adjusted to prevent zoom effect from overriding
        }
      } else {
        // Flashcards: expand or shrink to fit content
        if (measuredTotalWidth !== currentWidth) {
          const newWidth = Math.min(measuredTotalWidth, maxPanelWidth)
          
          // CRITICAL: Set width on DOM element FIRST (synchronously) to prevent wrapping
          // React state update is async, so text would wrap before state is applied
          if (panelRef.current) {
            panelRef.current.style.width = `${newWidth}px`
          }
          
          // Update ref immediately (synchronous)
          panelWidthRef.current = newWidth
          
          // Then update state to keep it in sync (async, but DOM is already updated)
          setPanelWidthToUse(newWidth)
          setIsManuallyShrunk(true) // Mark as manually adjusted to prevent zoom effect from overriding
        }
      }
    }
  }, [measureTextWidthFromContent, maxPanelWidth, usesFitContent, isFlashcard, isRegularChatPanel, promptContent, responseContent])

  // Handle blur to shrink panel to fit text content
  // Regular chat panels don't shrink - they stay at max width
  const handleEditorBlur = useCallback(() => {
    // Skip fit-content panels - CSS handles their width automatically
    if (usesFitContent) return
    
    // Skip regular chat panels - they stay at max width and don't shrink
    if (isRegularChatPanel) return
    
    // Use setTimeout to ensure DOM has updated after blur
    setTimeout(() => {
      // Measure both prompt and response content as single-line (not from DOM which might be wrapped)
      const promptWidth = measureTextWidthFromContent(promptContent) || 0
      const responseWidth = measureTextWidthFromContent(responseContent) || 0
      // Min width: flashcards need 300px for placeholder
      const minWidth = isFlashcard ? 300 : 200
      const measuredWidth = Math.max(promptWidth, responseWidth, minWidth)
      
      const currentWidth = panelWidthRef.current
      
      // Only shrink if measured width is less than current width
      if (measuredWidth < currentWidth) {
        // Set DOM directly to avoid flicker
        if (panelRef.current) {
          panelRef.current.style.width = `${measuredWidth}px`
        }
        panelWidthRef.current = measuredWidth
        setPanelWidthToUse(measuredWidth)
        setIsManuallyShrunk(true) // Mark as manually shrunk to prevent zoom effect from overriding
      }
    }, 100) // Small delay to ensure content is measured after blur
  }, [measureTextWidthFromContent, promptContent, responseContent, usesFitContent, isFlashcard, isRegularChatPanel])

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
    // Reset auto-focus ref when prompt message changes (new note created)
    hasAutoFocusedRef.current = false
  }, [isProjectBoard, isProjectBoard ? data.boardTitle : promptMessage?.content, promptContent, promptHasChanges, data, promptMessage?.id])

  // Sync responseContent when responseMessage changes (e.g., when AI response loads)
  useEffect(() => {
    if (responseMessage && responseMessage.content) {
      const newContent = responseMessage.content
      // Always update if content changed, unless user has manually edited it
      if (newContent !== responseContent && !responseHasChanges) {
        // If content is already HTML, use it directly; otherwise format it
        const formattedContent = formatResponseContent(newContent)
        setResponseContent(formattedContent)
        
        // Trigger expansion to fit response width when response loads
        // Use a small delay to ensure content is set before measuring
        setTimeout(() => {
          if (!usesFitContent) {
            expandPanelWidth() // Measure both prompt and response to expand panel
          }
        }, 100)
      }
    } else if (!responseMessage) {
      // If responseMessage becomes undefined, clear content
      setResponseContent('')
    }
  }, [responseMessage?.id, responseMessage?.content, responseContent, responseHasChanges, usesFitContent, expandPanelWidth]) // Use responseMessage.id to detect when a new message is added

  // For fit-content panels (notes), show immediately - no shrinking needed
  useEffect(() => {
    if (usesFitContent) {
      setIsInitialShrinkComplete(true)
    }
  }, [usesFitContent])
  
  // Initial shrink on mount - ensures panels shrink to fit content when first created
  // This is especially important for flashcards which start at 600px
  // Regular chat panels stay at max width, only flashcards shrink
  // Panel is hidden until shrink is complete to prevent visual jump
  useEffect(() => {
    // Skip fit-content panels - CSS handles their width
    if (usesFitContent) return
    
    // Skip regular chat panels - they start at max width and don't shrink
    if (isRegularChatPanel) {
      setIsInitialShrinkComplete(true) // Show immediately, no shrinking needed
      return
    }
    
    // Get panel ID to track if we've shrunk this specific panel
    const panelId = promptMessage?.id || id
    
    // If already shrunk for this panel, show it immediately
    if (hasInitialShrunkRef.current === panelId) {
      setIsInitialShrinkComplete(true)
      return
    }
    
    // Wait for DOM to be ready and content to be available
    const timeoutId = setTimeout(() => {
      if (!panelRef.current) {
        setIsInitialShrinkComplete(true) // Show even if ref not ready
        return
      }
      
      // Measure both prompt and response content as single-line
      const promptWidth = measureTextWidthFromContent(promptContent) || 0
      const responseWidth = measureTextWidthFromContent(responseContent) || 0
      // Min width: flashcards need 300px for placeholder
      const minWidth = isFlashcard ? 300 : 200
      const measuredWidth = Math.max(promptWidth, responseWidth, minWidth)
      
      const currentWidth = panelWidthRef.current
      
      // Shrink if measured width is less than current width (or if empty, shrink to min)
      if (measuredWidth < currentWidth || (!promptContent && !responseContent)) {
        const targetWidth = (!promptContent && !responseContent) ? minWidth : measuredWidth
        // Set DOM directly to avoid flicker
        if (panelRef.current) {
          panelRef.current.style.width = `${targetWidth}px`
        }
        panelWidthRef.current = targetWidth
        setPanelWidthToUse(targetWidth)
        setIsManuallyShrunk(true) // Mark as adjusted to prevent zoom effect from overriding
        hasInitialShrunkRef.current = panelId
      } else {
        hasInitialShrunkRef.current = panelId
      }
      
      // Show panel after shrink is complete
      setIsInitialShrinkComplete(true)
    }, 300) // Longer delay on mount to ensure DOM is ready
    
    return () => clearTimeout(timeoutId)
  }, [promptContent, responseContent, measureTextWidthFromContent, usesFitContent, isFlashcard, isRegularChatPanel, promptMessage?.id, id]) // Include deps but use ref to prevent re-running
  
  // Auto-expand/shrink panel width when content changes (continuously)
  // Regular chat panels only expand (never shrink), flashcards can expand and shrink
  // Skip for fit-content panels (notes) - CSS handles their width automatically
  useEffect(() => {
    // Skip fit-content panels - CSS handles their width
    if (usesFitContent) return
    
    // Wait for content to be available
    if (!promptContent && !responseContent) return
    
    // Use a debounced timeout to adjust width after content changes
    const timeoutId = setTimeout(() => {
      // Measure both prompt and response content as single-line to get maximum width needed
      const promptWidth = measureTextWidthFromContent(promptContent) || 0
      const responseWidth = measureTextWidthFromContent(responseContent) || 0
      // Min width: flashcards need 300px for placeholder, others need 200px
      const minWidth = isFlashcard ? 300 : 200
      const measuredWidth = Math.max(promptWidth, responseWidth, minWidth)
      
      const currentWidth = panelWidthRef.current
      
      // Regular chat panels: only expand (never shrink from max width)
      // Flashcards: expand or shrink to fit content
      if (isRegularChatPanel) {
        // Only expand if content is wider than current width
        if (measuredWidth > currentWidth) {
          const newWidth = Math.min(measuredWidth, maxPanelWidth) // Cap at max width
          // Set DOM directly to avoid flicker
          if (panelRef.current) {
            panelRef.current.style.width = `${newWidth}px`
          }
          panelWidthRef.current = newWidth
          setPanelWidthToUse(newWidth)
          setIsManuallyShrunk(true) // Mark as adjusted to prevent zoom effect from overriding
        }
      } else {
        // Flashcards: expand or shrink to fit content
        if (measuredWidth !== currentWidth) {
          const newWidth = Math.min(measuredWidth, maxPanelWidth) // Cap at max width
          // Set DOM directly to avoid flicker
          if (panelRef.current) {
            panelRef.current.style.width = `${newWidth}px`
          }
          panelWidthRef.current = newWidth
          setPanelWidthToUse(newWidth)
          setIsManuallyShrunk(true) // Mark as adjusted to prevent zoom effect from overriding
        }
      }
    }, 150) // Debounce delay - shorter than blur delay for more responsive adjustment
    
    return () => clearTimeout(timeoutId)
  }, [promptContent, responseContent, measureTextWidthFromContent, usesFitContent, isFlashcard, isRegularChatPanel, maxPanelWidth])

  const handlePromptChange = async (newContent: string) => {
    // Expand panel width FIRST (before content update) to prevent wrapping
    // Wrapping should not happen if panel is not at max width
    expandPanelWidth(newContent)
    
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

    // Expand panel width FIRST (before content update) to prevent wrapping
    // Wrapping should not happen if panel is not at max width
    expandPanelWidth(newContent)
    
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

  // Determine if this is a component panel (empty prompt content OR a note) - check once at top level
  // Component panels should only show white editable area, no grey area, no loading spinner
  // UNLESS it's a flashcard - flashcards show grey area even if empty content
  // Notes are always component panels (simple note nodes)
  const promptContentValue = promptMessage?.content || ''
  const isComponentPanel = isNote || promptContentValue.trim().length === 0
  // const isFlashcard = promptMessage?.metadata?.isFlashcard === true // Already defined at top
  // Show grey area if: has content OR is a flashcard (even if empty) OR has response message (to show nested on response load, even if content is empty during streaming)
  // Notes never show grey area (they're simple note nodes)
  const shouldShowGreyArea = !isNote && (promptContentValue.trim().length > 0 || isFlashcard || !!responseMessage)
  // Calculate loading state: response is loading when responseMessage doesn't exist or has no content yet
  // Notes never show loading state (they don't have responses)
  const isLoading = !isNote && (!responseMessage || (responseMessage && !responseMessage.content))
  
  // Auto-focus note editor when first created (empty component panel or inline note with fadeIn flag)
  useEffect(() => {
    if (isComponentPanel && !isFlashcard && promptEditorRef.current && !hasAutoFocusedRef.current) {
      const isEmpty = !promptContent || promptContent === '' || promptContent === '<p></p>' || promptContent === '<p><br></p>'
      const isNewInlineNote = promptMessage?.metadata?.fadeIn === true // Inline note created via double-click
      
      if (isEmpty || isNewInlineNote) {
        // Small delay to ensure editor is ready
        setTimeout(() => {
          if (promptEditorRef.current && !promptEditorRef.current.isDestroyed) {
            promptEditorRef.current.commands.focus()
            // For inline notes with content, place cursor at end; otherwise at start
            if (isNewInlineNote && promptContent && promptContent.length > 0) {
              promptEditorRef.current.commands.focus('end') // Place cursor at end to continue typing
            } else {
              promptEditorRef.current.commands.setTextSelection(0)
            }
            hasAutoFocusedRef.current = true
          }
        }, 100)
      }
    }
  }, [isComponentPanel, isFlashcard, promptContent, promptEditorRef.current, promptMessage?.metadata?.fadeIn])

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

  // Determine if this panel should be blurred based on nav mode state
  // - Normal nav mode: only the focused/selected flashcard visible, everything else blurred
  // - Zoomed out nav mode: selected flashcard visible, other flashcards blurred, non-flashcards unblurred
  const shouldBlur = flashcardMode !== null && (
    isZoomedOutInNavMode 
      ? (isFlashcard && !selected)  // Zoomed out: blur non-selected flashcards, unblur everything else including selected flashcard
      : !(isFlashcard && selected)  // Normal: only unblur selected flashcard
  )

  // Comments should blur the same as non-flashcard map content:
  // - Blur during nav mode when not zoomed out
  // - Don't blur when zoomed out in nav mode
  // - Even focused flashcard comments should blur
  const shouldBlurComments = flashcardMode !== null && !isZoomedOutInNavMode

  return (
    <div
        ref={panelRef}
        data-panel-container="true" // Data attribute to help find panel container for comment popup
        className={cn(
          'group rounded-2xl border relative cursor-grab active:cursor-grabbing overflow-visible backdrop-blur-sm transition-all duration-300', // Transparent with backdrop blur for map panels - increased corner radius, group class for hover detection, smooth transition
          // Always show blue border when selected, otherwise use custom border color or default theme-based color
          selected ? 'border-blue-500 dark:border-blue-400' : (data.borderColor ? '' : 'border-gray-200 dark:border-[#2f2f2f]'),
          isBookmarked
            ? 'shadow-[0_0_8px_rgba(250,204,21,0.6)] dark:shadow-[0_0_8px_rgba(250,204,21,0.4)]'
            : (data.borderStyle === 'none' ? 'shadow-none' : 'shadow-sm'),
          // Blur non-flashcard panels when flashcard study mode is active
          shouldBlur && 'blur-sm opacity-40 pointer-events-none'
        )}
      style={{
        // Note panels use fit-content width (grows with text), others use fixed width
        width: usesFitContent ? 'fit-content' : `${panelWidthToUse}px`,
        // Min width: notes need ~200px for padding + buttons, flashcards need ~300px for placeholder
        minWidth: usesFitContent ? '200px' : (isFlashcard ? '300px' : undefined),
        maxWidth: usesFitContent ? '768px' : undefined, // Cap notes at standard panel width
        // Hide panel until initial shrink is complete (prevents visual jump)
        opacity: isInitialShrinkComplete ? 1 : 0,
        // Use calculated panel background color with transparency maintained
        backgroundColor: panelBackgroundColor,
        // Use custom border color only if not selected (selection takes priority)
        borderColor: selected ? undefined : (data.borderColor || undefined),
        // When selected, always show border (override 'none' style to show blue selection border)
        borderStyle: selected ? 'solid' : (data.borderStyle as any || undefined),
        // When selected, ensure border width is set (default to 1px if border was 'none')
        borderWidth: selected ? (data.borderWeight || '1px') : (data.borderWeight || undefined),
      }}
      onClick={(e) => {
        // For flashcards, expand on single click anywhere (except interactive elements)
        if (isFlashcard && isResponseCollapsed) {
          const target = e.target as HTMLElement
          // Don't expand if clicking on interactive elements
          if (!target.closest('button, a, [contenteditable="true"], input, textarea, select')) {
            e.stopPropagation()
            handleCollapseChange(false)
          }
        }
      }}
      onDoubleClick={(e) => {
        // Double-click anywhere on panel focuses the appropriate editor
        const target = e.target as HTMLElement
        // Don't interfere if clicking on interactive elements or already in an editor
        if (target.closest('button, a, [contenteditable="true"], input, textarea, select')) {
          return
        }
        e.stopPropagation()
        // Check if click is within prompt area (grey area) - focus prompt editor
        // Otherwise focus response editor (white area)
        const isInPromptArea = target.closest('[data-prompt-area="true"]')
        const editorToFocus = isInPromptArea 
          ? (promptEditorRef.current || responseEditorRef.current)
          : (responseEditorRef.current || promptEditorRef.current)
        if (editorToFocus && !editorToFocus.isDestroyed) {
          setTimeout(() => {
            editorToFocus.commands.focus()
            // Place cursor at end of content
            const docSize = editorToFocus.state.doc.content.size
            if (docSize > 1) {
              editorToFocus.commands.setTextSelection(docSize - 1)
            }
          }, 0)
        }
      }}
    >
      {/* Left handle with flashcard navigation */}
      {isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) && previousBoardWithFlashcards && isAtFirstFlashcardInBoard && selected ? (
        // Expanded pill with two buttons when cross-board navigation is available and flashcard is selected
        <div
          className={cn(
            'absolute left-0 top-1/2 z-20 flex items-center justify-center -translate-x-1/2 -translate-y-1/2'
          )}
          style={{ 
            width: '24px', 
            height: '48px',
            transition: 'height 300ms ease-in-out'
          }}
        >
          <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-0.5 flex flex-col gap-0.5 h-12 w-6 items-center justify-center transition-all duration-300 ease-in-out">
            {/* Single arrow button - cycles through current board */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToPreviousFlashcard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-all duration-300"
              title="Previous flashcard in this board"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
            {/* Double arrow button - navigates to previous board (only when selected) */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToPreviousBoard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center animate-fade-in"
              title="Previous board"
            >
              <ChevronsLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      ) : isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) ? (
        <div
          className={cn(
            'absolute left-0 top-1/2 z-20 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer'
          )}
          style={{ 
            width: '24px', 
            height: '24px',
            transition: 'height 300ms ease-in-out'
          }}
          onClick={(e) => {
            e.stopPropagation()
            navigateToPreviousFlashcard()
          }}
        >
          <Handle
            type="target"
            position={Position.Left}
            id="left"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default',
              'handle-dot-flashcard-large'
            )}
            style={{
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-30">
            <ChevronLeft className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
          </div>
        </div>
      ) : !shouldHideHandles ? (
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
            '--handle-color': handleColor,
            '--handle-hover-color': handleHoverColor,
          } as React.CSSProperties}
        />
      ) : null}

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
                isFlashcard={isFlashcard}
                isPanelSelected={selected}
                isLoading={isLoading}
                onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                onBlur={handleEditorBlur}
                onEditorActiveChange={handleEditorActiveChange}
              />
            </div>
          )
        }

        // For regular component panels (not flashcards) OR notes, show editable white area only (no grey prompt area, no loading spinner)
        // Component panels are just white text panels - no grey, no loading
        // Notes are always component panels
        // Check if this is a newly created inline note that should fade in
        const shouldFadeIn = promptMessage?.metadata?.fadeIn === true
        
        if ((isComponentPanel && !isFlashcard) || isNote) {
          return (
            <div
              className={cn(
                "p-1 backdrop-blur-sm rounded-2xl relative transition-all duration-500 overflow-visible",
                shouldFadeIn && "animate-note-fade-in" // Smooth fade-in for inline notes
              )}
              style={{
                lineHeight: '1.7',
                // Use calculated response area background color - same as panel background
                backgroundColor: responseAreaBackgroundColor,
              }}
            >
              {/* Note text - px-3 py-3 inner padding + p-1 outer = same as prompt panel py-4 */}
              <div className="px-3 py-3">
                <TipTapContent
                content={promptContent || promptMessage?.content || ''}
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
                  placeholder=""
                isPanelSelected={selected}
                isLoading={isLoading}
                onBlur={handleEditorBlur}
                onEditorActiveChange={handleEditorActiveChange}
                />
              </div>
              
            </div>
          )
        }

        // For regular panels with response content (NOT component panels)
        // Also include flashcards - they should render like regular prompt+response panels even when empty
        // Flashcards with response message should always render nested prompt+response structure
        // Show nested structure when responseMessage exists (even if content is empty during streaming) - prompt panel should show nested on response load
        if ((isProjectBoard && responseMessage) ||
          (!isProjectBoard && responseMessage) ||
          (isFlashcard && responseMessage)) {
          return (
            <div
              className={cn(
                "p-1 backdrop-blur-sm rounded-2xl relative transition-all duration-500 overflow-visible", // Transparent for map panels - background set via inline style, rounded-2xl for all corners, p-1 padding (4px) for background and content spacing, slower collapse/expand animation
                // When collapsed, response content is hidden but container remains for prompt expansion
                isResponseCollapsed && "overflow-hidden"
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
                  data-prompt-area="true"
                  className={cn(
                    "relative z-10 overflow-visible group/prompt transition-all duration-500 ease-in-out cursor-text", // Transparent grey area - background set via inline style, slower collapse/expand animation with synchronized easing, named group for prompt panel hover
                    // When expanded: no margin - prompt area is inside response padding (p-1 = 4px), so it starts at response padding position
                    // When collapsed: negative margin (-m-1 = -4px) to extend beyond response padding and fill entire response area
                    isResponseCollapsed ? "-m-1 rounded-2xl" : "m-0 rounded-xl",
                    // Shadow to layer above response content
                    "shadow-sm",
                    // 12px padding (px-3) for prompt text - aligns with response text which also has 12px padding (4px more than before)
                    // When collapsed, use full padding to fill space while keeping text in place
                    isResponseCollapsed ? "p-4" : "px-3 py-4"
                  )}
                  style={{
                    // Use calculated prompt area background color - darker than panel background
                    backgroundColor: promptAreaBackgroundColor,
                  }}
                  onClick={(e) => {
                    // If panel is selected, allow single click to focus; otherwise require double click
                    if (!selected && e.detail < 2) {
                      return // Single click on unselected panel - don't focus
                    }
                    // If panel is selected, single click focuses the editor
                    if (selected && promptEditorRef.current) {
                      const target = e.target as HTMLElement
                      if (!target.closest('button') && !target.closest('a')) {
                        promptEditorRef.current?.commands.focus()
                      }
                    }
                  }}
                  onDoubleClick={(e) => {
                    // Double click focuses the editor (for unselected panels)
                    if (!selected && promptEditorRef.current) {
                      e.stopPropagation()
                      setTimeout(() => {
                        promptEditorRef.current?.commands.focus()
                        const isEmpty = !promptEditorRef.current?.getHTML() || promptEditorRef.current?.getHTML() === '<p></p>' || promptEditorRef.current?.getHTML() === '<p><br></p>'
                        if (isEmpty) {
                          promptEditorRef.current?.commands.setTextSelection(0)
                        }
                      }, 0)
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
                        isPanelSelected={selected}
                        isLoading={isLoading}
                        onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                        onBlur={handleEditorBlur}
                        onEditorActiveChange={handleEditorActiveChange}
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
                    <div className="relative inline-block">
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
                        isFlashcard={isFlashcard}
                        isPanelSelected={selected}
                        isLoading={isLoading}
                        onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                        onBlur={handleEditorBlur}
                        onEditorActiveChange={handleEditorActiveChange}
                      />
                    </div>
                  )}

                </div>
              )}

              {/* Response content - appears below prompt area with spacing */}
              {/* When collapsed, response content is hidden behind prompt */}
              {/* Separate div for response text with 8px padding to align with prompt text */}
              <div
                className={cn(
                  // Add top margin when prompt area is visible to create gap between prompt and response (increased gap)
                  shouldShowGreyArea && !isResponseCollapsed && "mt-4",
                  // Collapse response content with top as anchor (smooth transition)
                  // Use overflow-visible to allow BubbleMenu to escape, but wrap content for collapse animation
                  "transition-all duration-500 ease-in-out",
                  isResponseCollapsed && "opacity-0 overflow-hidden"
                )}
                style={{
                  // Use max-height for smooth collapse from top anchor (large value allows any content height)
                  // Only apply max-height when collapsed to allow popups to escape
                  maxHeight: isResponseCollapsed ? '0px' : 'none',
                }}
              >
                {/* Separate div for response text with 12px horizontal padding and 16px bottom padding (same as note panel) */}
                <div className="px-3 pb-4 group overflow-visible">
                  <div className="inline-flex items-center gap-1">
                    <TipTapContent
                      key={`response-${responseMessage.id}`} // Force re-render when message ID changes
                      content={responseContent || responseMessage.content || ''}
                      className="text-gray-700 dark:text-gray-100 inline"
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
                      isPanelSelected={selected}
                      onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                      onBlur={handleEditorBlur}
                      onEditorActiveChange={handleEditorActiveChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        }

        // Loading state - show nested structure with prompt panel and loading spinner in response area
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
                isPanelSelected={selected}
                isLoading={isLoading}
                onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                onEditorActiveChange={handleEditorActiveChange}
              />
            </div>
          )
        }

        // Regular panel loading state (NOT component panel) - show nested structure with prompt panel and loading spinner
        // Prompt panel should show nested on response load, even during loading
        // No bottom padding during loading - buttons space only appears after response loads
        return (
          <div
            className={cn(
              "p-1 backdrop-blur-sm rounded-2xl relative transition-all duration-500 overflow-visible" // Transparent for map panels - background set via inline style, rounded-2xl for all corners, p-1 padding (4px) for background and content spacing, slower collapse/expand animation
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
                )}
                style={{
                  // Use calculated prompt area background color - darker than panel background
                  backgroundColor: promptAreaBackgroundColor,
                }}
                onClick={(e) => {
                  // If panel is selected, allow single click to focus; otherwise require double click
                  if (!selected && e.detail < 2) {
                    return // Single click on unselected panel - don't focus
                  }
                  // If panel is selected, single click focuses the editor
                  if (selected && promptEditorRef.current) {
                    const target = e.target as HTMLElement
                    if (!target.closest('button') && !target.closest('a')) {
                      promptEditorRef.current?.commands.focus()
                    }
                  }
                }}
                onDoubleClick={(e) => {
                  // Double click focuses the editor (for unselected panels)
                  if (!selected && promptEditorRef.current) {
                    e.stopPropagation()
                    setTimeout(() => {
                      promptEditorRef.current?.commands.focus()
                      const isEmpty = !promptEditorRef.current?.getHTML() || promptEditorRef.current?.getHTML() === '<p></p>' || promptEditorRef.current?.getHTML() === '<p><br></p>'
                      if (isEmpty) {
                        promptEditorRef.current?.commands.setTextSelection(0)
                      }
                    }, 0)
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
                      isPanelSelected={selected}
                      isLoading={isLoading}
                      onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                      onBlur={handleEditorBlur}
                      onEditorActiveChange={handleEditorActiveChange}
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
                  <div className="relative inline-block">
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
                      isFlashcard={isFlashcard}
                      isPanelSelected={selected}
                      isLoading={isLoading}
                      onCommentPopupVisibilityChange={setHasCommentPopupVisible}
                        onBlur={handleEditorBlur}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Response content area - show loading spinner when no response yet (but not for notes) */}
            {!isNote && (
            <div
              className={cn(
                // Add top margin when prompt area is visible to create gap between prompt and response (increased gap)
                shouldShowGreyArea && !isResponseCollapsed && "mt-4",
                // Collapse response content with top as anchor (smooth transition)
                // Use overflow-visible to allow BubbleMenu to escape, but wrap content for collapse animation
                "transition-all duration-500 ease-in-out",
                isResponseCollapsed && "opacity-0 overflow-hidden"
              )}
              style={{
                // Use max-height for smooth collapse from top anchor (large value allows any content height)
                // Only apply max-height when collapsed to allow popups to escape
                maxHeight: isResponseCollapsed ? '0px' : 'none',
              }}
            >
                {/* Loading spinner in response area - only show if loading and not a note */}
                {isLoading && (
              <div className="px-3 pb-0 flex items-center justify-center min-h-[100px]">
                <Loader2 className="h-6 w-6 text-gray-400 dark:text-gray-500 animate-spin" />
              </div>
                )}
            </div>
            )}
          </div>
        )
      })()}

      {/* Right handle with flashcard navigation */}
      {/* Hide handle when comment popup is visible */}
      {!hasCommentPopupVisible && isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) && nextBoardWithFlashcards && isAtLastFlashcardInBoard && selected ? (
        // Expanded pill with two buttons when cross-board navigation is available and flashcard is selected
        <div
          className={cn(
            'absolute right-0 top-1/2 z-20 flex items-center justify-center translate-x-1/2 -translate-y-1/2'
          )}
          style={{ 
            width: '24px', 
            height: '48px',
            transition: 'height 300ms ease-in-out'
          }}
        >
          <div className="bg-white dark:bg-[#1f1f1f] rounded-full shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-0.5 flex flex-col gap-0.5 h-12 w-6 items-center justify-center transition-all duration-300 ease-in-out">
            {/* Single arrow button - cycles through current board */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToNextFlashcard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-all duration-300"
              title="Next flashcard in this board"
            >
              <ChevronRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
            {/* Double arrow button - navigates to next board (only when selected) */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateToNextBoard()
              }}
              className="h-6 w-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center animate-fade-in"
              title="Next board"
            >
              <ChevronsRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      ) : !hasCommentPopupVisible && isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) ? (
        <div
          className={cn(
            'absolute right-0 top-1/2 z-20 flex items-center justify-center translate-x-1/2 -translate-y-1/2 cursor-pointer'
          )}
          style={{ 
            width: '24px', 
            height: '24px',
            transition: 'height 300ms ease-in-out'
          }}
          onClick={(e) => {
            e.stopPropagation()
            navigateToNextFlashcard()
          }}
        >
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default',
              'handle-dot-flashcard-large'
            )}
            style={{
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-30">
            <ChevronRight className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" />
          </div>
        </div>
      ) : !hasCommentPopupVisible && !shouldHideHandles ? (
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
            '--handle-color': handleColor,
            '--handle-hover-color': handleHoverColor,
          } as React.CSSProperties}
        />
      ) : null}

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
        <div 
          ref={commentPanelsRef}
          className={cn(
            // Comments blur the same as non-flashcard map content during nav mode
            shouldBlurComments && 'blur-sm opacity-40 pointer-events-none'
          )}
        >
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
      
      {/* Panel toolbar - positioned at bottom left, outside the panel but part of the node DOM so it scales with zoom */}
      {/* Rendered inside the panel div so it naturally scales as a map object */}
      {selected && (
        <div 
          className="absolute left-0 flex gap-1 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 z-50 pointer-events-auto"
          style={{
            bottom: '-44px', // Position below the panel
          }}
          onClick={(e) => e.stopPropagation()} // Prevent clicks from propagating to panel
        >
          {/* Collapse/Expand caret - far left, only show if panel has response message (can be collapsed) */}
          {(responseMessage || isResponseCollapsed) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleToolbarCondense}
              title={isResponseCollapsed ? "Expand" : "Collapse"}
            >
              {isResponseCollapsed ? (
                <ChevronUp className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              )}
            </Button>
          )}
          
          {/* Copy button - for notes shows "Copy note", for others shows "Copy" */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleToolbarCopy}
            title={isNote ? "Copy note" : "Copy"}
          >
            <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </Button>
          
          {/* More menu with Bookmark and Delete options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="More options"
              >
                <MoreHorizontal className="h-4 w-4 text-gray-600 dark:text-gray-300" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => setIsBookmarked(!isBookmarked)}
              >
                <Bookmark className={cn("h-4 w-4 mr-2", isBookmarked && "fill-yellow-400 text-yellow-400")} />
                {isBookmarked ? "Remove bookmark" : "Bookmark"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDeletePanel}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Tag to study set button - only for flashcards with response message */}
          {isFlashcard && responseMessage?.id && (
            <TagButton responseMessageId={responseMessage.id} />
          )}
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

