'use client'

// Custom React Flow node for chat panels (prompt + response)
import { NodeProps, Handle, Position, useReactFlow, NodeResizeControl } from 'reactflow' // RF node primitives + corner resize controls
import { cn, generateUUID } from '@/lib/utils'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import { Haze } from '@/lib/tiptap/haze' // Hide-text mark (frosted until click-reveal)
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MoreHorizontal, Trash2, Loader2, X, ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Plus, RotateCw } from 'lucide-react' // RotateCw = bottom-left rotation affordance

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
import { SelectionFormatPopupAnchor } from './selection-format-popup' // Notion-style selection menu (stable edge anchor)
import { ItemTitleEdge } from './item-title-edge' // Edge title chip; titled items promote to pages
import { NestedBoardPreview, prefetchPageEmbed } from './nested-board-preview' // Page-within-page board preview
import { deleteLinkedPageForItem, isItemMeta, isPageBodyMeta } from '@/lib/items' // Item detection + delete sync

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

// Plain-merge legacy prompt + response HTML into one page-item body (no auto-haze)
function mergePanelHtml(prompt?: string, response?: string): string {
  const empty = (s?: string) => !s?.trim() || s === '<p></p>' || s === '<p><br></p>' // TipTap empty docs
  const a = empty(prompt) ? '' : (prompt as string) // Prompt / primary body
  const b = empty(response) ? '' : (response as string) // Former response section
  if (a && b) return `${a}${b}` // Concatenate HTML fragments
  return a || b || '' // Whichever side has content
}

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
  onBlur,
  onEditorActiveChange,
  fontScale
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
  onBlur?: () => void
  onEditorActiveChange?: (isActive: boolean) => void // Called when editor is focused or has selection
  fontScale?: number // Font scale factor for resized panels (defaults to 1)
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
    Haze, // Hide-text frost mark (selection menu + click-to-reveal)
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

          // Temporary reveal: click a hazed span to clear blur until click-away / blur
          const hazeTarget = (event.target as HTMLElement | null)?.closest?.('[data-haze="true"]') as HTMLElement | null
          view.dom.querySelectorAll('.tt-haze-revealed').forEach((el) => {
            if (el !== hazeTarget) el.classList.remove('tt-haze-revealed') // Hide previously revealed spans
          })
          if (hazeTarget) {
            hazeTarget.classList.add('tt-haze-revealed') // Reveal this hazed block temporarily
          }

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
        blur: (view) => {
          // Re-haze any temporarily revealed spans when the editor loses focus
          view.dom.querySelectorAll('.tt-haze-revealed').forEach((el) => {
            el.classList.remove('tt-haze-revealed')
          })
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

  // Apply font scale to editor's DOM element when fontScale changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    
    const scale = fontScale ?? 1
    const editorDOM = editor.view.dom as HTMLElement
    
    if (editorDOM) {
      // Apply font size directly to the editor's DOM element
      // This will affect all content in the editor
      editorDOM.style.fontSize = `${scale}em`
    }
  }, [editor, fontScale])

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
              // Get click position in editor coordinates - posAtCoords returns { pos, inside } object
              const posResult = view.posAtCoords({ left: e.clientX, top: e.clientY })
              if (posResult !== null && posResult.pos >= 0) {
                // Place cursor at click position to clear selection
                editor.commands.setTextSelection(posResult.pos)
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
      {/* Notion-style format popup — outside highlight edge, stays open with selection */}
      <SelectionFormatPopupAnchor editor={editor} containerRef={containerRef} />

      {/* Apply shimmer animation to prompt text when response is loading (not for flashcards) */}
      <div className={cn(isLoading && !isFlashcard && 'shimmer')}>
        <EditorContent editor={editor} />
      </div>
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

// Hook to check if flashcard tags are loaded and get tag IDs
// Uses React Query to ensure study sets are cached and ready
function useFlashcardTagsLoaded(responseMessageId: string | undefined): { isReady: boolean; tagIds: string[] } {
  const supabase = createClient()
  const [taggedStudySetIds, setTaggedStudySetIds] = useState<string[]>([])
  const [messageLoaded, setMessageLoaded] = useState(false)
  
  // Use React Query for study sets (same as TagBoxes) to ensure cache is ready
  const { data: studySets = [], isLoading: studySetsLoading } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Fetch message metadata to get tag IDs
  useEffect(() => {
    if (!responseMessageId) {
      setMessageLoaded(true)
      return
    }

    const fetchMessage = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setMessageLoaded(true)
          return
        }

        const { data: message, error } = await supabase
          .from('messages')
          .select('metadata')
          .eq('id', responseMessageId)
          .single()

        if (error) {
          if (error.code !== 'PGRST116' && error.message !== 'JSON object requested, multiple (or no) rows returned') {
            console.error('Error fetching message metadata:', error)
          }
          setMessageLoaded(true)
          return
        }

        const metadata = (message?.metadata as Record<string, any>) || {}
        const studySetIds = (metadata.studySetIds || []) as string[]
        setTaggedStudySetIds(studySetIds)
        setMessageLoaded(true)
      } catch (error) {
        if (error instanceof Error && !error.message.includes('PGRST')) {
          console.error('Error fetching message metadata:', error)
        }
        setMessageLoaded(true)
      }
    }

    fetchMessage()
  }, [responseMessageId, supabase])

  // Return true only when:
  // 1. Message is loaded (or no message ID)
  // 2. Study sets are loaded (or no tags)
  // 3. If there are tags, verify all have names in study sets
  const isReady = messageLoaded && !studySetsLoading && (
    taggedStudySetIds.length === 0 || 
    taggedStudySetIds.every(id => studySets.some(s => s.id === id))
  )

  return { isReady, tagIds: taggedStudySetIds }
}

// Tag boxes component - displays study set tags for a flashcard
function TagBoxes({ responseMessageId, initialTagIds }: { responseMessageId: string; initialTagIds?: string[] }) {
  const supabase = createClient()
  const { selectedTag, setSelectedTag } = useReactFlowContext() // Get selected tag state for filtering
  const [taggedStudySetIds, setTaggedStudySetIds] = useState<string[]>(initialTagIds || [])
  const [studySetNames, setStudySetNames] = useState<Map<string, string>>(new Map())
  const [hasInitialLoad, setHasInitialLoad] = useState(!!initialTagIds) // If initialTagIds provided, skip initial fetch

  // Update tag IDs when initialTagIds prop changes
  useEffect(() => {
    if (initialTagIds) {
      setTaggedStudySetIds(initialTagIds)
      setHasInitialLoad(true)
    }
  }, [initialTagIds])

  // Fetch current study set IDs from message metadata (only if not provided initially)
  const fetchTaggedStudySets = useCallback(async () => {
    if (!responseMessageId) {
      setHasInitialLoad(true)
      return
    }

    try {
      // Check if user is authenticated first (required for RLS)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // Not authenticated - can't fetch message metadata (expected for public homepage boards)
        setHasInitialLoad(true)
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
        setHasInitialLoad(true)
        return
      }

      const metadata = (message?.metadata as Record<string, any>) || {}
      const studySetIds = (metadata.studySetIds || []) as string[]
      setTaggedStudySetIds(studySetIds)
      setHasInitialLoad(true)
    } catch (error) {
      // Silently handle errors (expected for public boards)
      // Only log if it's an unexpected error type
      if (error instanceof Error && !error.message.includes('PGRST')) {
      console.error('Error fetching tagged study sets:', error)
      }
      setHasInitialLoad(true)
    }
  }, [responseMessageId, supabase])

  useEffect(() => {
    // Skip initial fetch if tag IDs were provided
    if (!initialTagIds) {
      fetchTaggedStudySets()
    }

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
  }, [responseMessageId, supabase, fetchTaggedStudySets, initialTagIds])

  // Fetch study sets using React Query (same cache as TagButton for instant access)
  const { data: studySets = [] } = useQuery({
    queryKey: ['studySets'],
    queryFn: fetchStudySets,
  })

  // Update study set names map only when content actually changes
  // Use ref to track previous key and avoid infinite loops
  const prevMapKeyRef = useRef<string>('')
  
  useEffect(() => {
    // Create stable key from current values
    const taggedIdsKey = taggedStudySetIds.join(',')
    const studySetsKey = JSON.stringify(studySets.map(s => ({ id: s.id, name: s.name })).sort((a, b) => a.id.localeCompare(b.id)))
    const mapKey = `${taggedIdsKey}|${studySetsKey}`
    
    // Skip if key hasn't changed (content is the same)
    if (mapKey === prevMapKeyRef.current) {
      return
    }
    
    prevMapKeyRef.current = mapKey

    if (taggedStudySetIds.length === 0) {
      setStudySetNames(prev => prev.size === 0 ? prev : new Map())
      return
    }

    const namesMap = new Map<string, string>()
    taggedStudySetIds.forEach((id) => {
      const studySet = studySets.find((s) => s.id === id)
      if (studySet) {
        namesMap.set(id, studySet.name)
      }
    })

    setStudySetNames(prev => {
      // Compare to avoid unnecessary updates
      if (prev.size !== namesMap.size) {
        return namesMap
      }
      for (const [id, name] of namesMap) {
        if (prev.get(id) !== name) {
          return namesMap
        }
      }
      return prev // No change
    })
    // Dependencies: we check the key inside, so we need the arrays to be in scope
    // but we only run when the key actually changes (checked via ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taggedStudySetIds, studySets])

  // Only return null after initial load confirms there are no tags
  if (hasInitialLoad && taggedStudySetIds.length === 0) return null

  // Filter to only show tags that have names loaded
  const tagsWithNames = taggedStudySetIds.filter(id => studySetNames.has(id))
  
  // Don't show anything if no tags have names yet
  if (tagsWithNames.length === 0) return null

  // Show container with tags that have names
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tagsWithNames.map((studySetId) => {
        const name = studySetNames.get(studySetId)!

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
      const newStudySetId = generateUUID() // Compatible with all browsers including older Safari
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
  // Single text body: plain-merge legacy prompt + response (no section split)
  const [promptContent, setPromptContent] = useState(() => {
    if (isProjectBoard) return data.boardTitle || ''
    const responseRaw = data.responseMessage?.content
    const responseHtml = responseRaw ? formatResponseContent(responseRaw) : ''
    return mergePanelHtml(data.promptMessage?.content, responseHtml)
  })
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
  const hasInitialShrunkRef = useRef<string | null>(null) // Track which panel ID we've done initial shrink for
  const [isInitialShrinkComplete, setIsInitialShrinkComplete] = useState(false) // Track if initial shrink is done (for hiding panel until ready)
  const promptEditorRef = useRef<any>(null) // Ref to prompt editor instance
  const responseEditorRef = useRef<any>(null) // Ref to response editor instance
  const newCommentTextareaRef = useRef<HTMLTextAreaElement>(null) // Ref for new comment textarea
  const replyTextareaRefs = useRef<Record<string, HTMLTextAreaElement>>({}) // Refs for reply textareas
  const hasAutoFocusedRef = useRef(false) // Track if note editor has been auto-focused
  const { resolvedTheme } = useTheme() // Get theme to set transparent background color
  
  // Resize state for panel scaling - default dimensions for calculating scale factor
  const DEFAULT_PANEL_WIDTH = 768 // Default panel width (max-width)
  const DEFAULT_PANEL_HEIGHT = 400 // Default panel height estimate
  const [resizeDimensions, setResizeDimensions] = useState<{ width: number; height: number } | null>(null) // Track resized dimensions
  const [fontScale, setFontScale] = useState(1) // Scale factor for text based on resize ratio
  const [rotation, setRotation] = useState(0) // Degrees of item rotation (persisted in message metadata)
  const isResizingRef = useRef(false) // Track if currently resizing
  const initialResizeWidthRef = useRef<number | null>(null) // Track initial panel width when resize starts (for note panels)
  const initialResizeHeightRef = useRef<number | null>(null) // Track initial panel height when resize starts (for note panels)
  const initialTextWidthRef = useRef<number | null>(null) // Track initial TEXT content width (for proper fill scaling)
  const isFirstResizeCallRef = useRef(true) // Track if this is the first resize call in the current session
  const initialTextAspectRatioRef = useRef<number | null>(null) // Track text's natural aspect ratio (width/height)
  const hasLoadedResizeStateRef = useRef(false) // Track if we've already loaded and applied resize state from metadata
  const isRotatingRef = useRef(false) // True while pointer-dragging the rotation handle
  const rotationDragRef = useRef<{ startAngle: number; startRotation: number } | null>(null) // Pointer math for live rotate

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

  // Load resize dimensions/fontScale from message metadata on mount to restore panel size
  // Note: This effect calculates isItem inline to avoid dependency on isItem before it's defined
  useEffect(() => {
    if (isProjectBoard || !promptMessage || hasLoadedResizeStateRef.current) return // Project boards don't persist resize, and only load once

    // Item panel: metadata.isItem, or empty user-only body
    const isItemPanel = isItemMeta(promptMessage?.metadata) ||
      (promptMessage?.role === 'user' && 
       !responseMessage && 
       (!promptMessage?.content || promptMessage.content.trim() === '' || promptMessage.content === '<p></p>' || promptMessage.content === '<p><br></p>'))

    const loadResizeState = async () => {
      // Get message metadata to check for saved resize state
      const { data: message } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', promptMessage.id)
        .single()

      if (message?.metadata && typeof message.metadata === 'object') {
        const metadata = message.metadata as Record<string, any>
        
        // For note panels: load fontScale (legacy scale-to-fit)
        if (isItemPanel && metadata.fontScale && typeof metadata.fontScale === 'number') {
          setFontScale(metadata.fontScale)
        }

        // Restore saved rotation for items (degrees around panel center)
        if (isItemPanel && typeof metadata.rotation === 'number') {
          setRotation(metadata.rotation) // Apply persisted angle so layout survives reload
        }

        // Load explicit box size for items + other panels (corner resize baseline)
        if (metadata.resizeDimensions && typeof metadata.resizeDimensions === 'object') {
          const dims = metadata.resizeDimensions as { width?: number; height?: number }
          if (dims.width && dims.height && dims.width > 0 && dims.height > 0) {
            setResizeDimensions({ width: dims.width, height: dims.height })
            
            // Update React Flow node dimensions to match saved resize
            const setNodesFunc = getSetNodes()
            if (setNodesFunc) {
              setNodesFunc((nodes: any[]) =>
                nodes.map((node: any) =>
                  node.id === id
                    ? { ...node, width: dims.width, height: dims.height }
                    : node
                )
              )
            }
          }
        }
      }
      
      // Mark as loaded to prevent re-running
      hasLoadedResizeStateRef.current = true
    }

    loadResizeState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectBoard, promptMessage?.id]) // Load once on mount - only depend on promptMessage.id


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

  // Handle resize end - clear resizing flag and reset refs for next resize session
  // handleResizeEnd is defined after isItem to access it - see below

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
  
  // Check if flashcard tags are loaded (for controlling toolbar visibility)
  const { isReady: tagsLoaded, tagIds } = useFlashcardTagsLoaded(isFlashcard && responseMessage?.id ? responseMessage.id : undefined)
  
  // Item card: metadata.isItem, or empty user-only body
  const isItem = isItemMeta(promptMessage?.metadata) ||
    (promptMessage?.role === 'user' && 
     !responseMessage && 
     (!promptMessage?.content || promptMessage.content.trim() === '' || promptMessage.content === '<p></p>' || promptMessage.content === '<p><br></p>'))
  
  // Calculate dynamic line-height for note nodes based on height (decreases as height increases)
  const calculateNoteLineHeight = useCallback(() => {
    if (!isItem) return '1.7' // Default line-height
    
    // Try to get height from React Flow node first (more accurate during resize)
    let currentHeight: number | null = null
    const nodes = getNodes()
    const currentNode = nodes.find((node: any) => node.id === id)
    if (currentNode && currentNode.height) {
      currentHeight = currentNode.height
    }
    
    // Fallback to panelRef height if node height not available
    if (currentHeight === null && panelRef.current) {
      currentHeight = panelRef.current.offsetHeight
    }
    
    // If still no height, use default
    if (currentHeight === null || currentHeight <= 0) {
      return '1.7'
    }
    
    const baseHeight = DEFAULT_PANEL_HEIGHT // Base height for calculation
    const baseLineHeight = 1.7 // Base line-height
    
    // Calculate how much taller the node is compared to base
    const heightRatio = currentHeight / baseHeight
    
    // Decrease line-height as height increases
    // Formula: lineHeight = baseLineHeight - (heightRatio - 1) * factor
    // This allows line-height to go negative when height is significantly increased
    const factor = 0.5 // Adjust this to control how quickly line-height decreases
    const calculatedLineHeight = baseLineHeight - (heightRatio - 1) * factor
    
    return `${calculatedLineHeight}`
  }, [isItem, id, getNodes])
  
  // Get current line-height for notes - update on resize
  const [noteLineHeight, setNoteLineHeight] = useState('1.7')
  // Measured item box for edge-title perimeter math (items = former notes)
  const [itemBoxSize, setItemBoxSize] = useState({ width: 200, height: 120 })
  // In-place nested board for a titled item’s linked page
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false)
  const [pagePreviewMounted, setPagePreviewMounted] = useState(false) // Keep iframe warm after first open/hover
  const linkedPageId = !isProjectBoard
    ? (promptMessage?.metadata?.linkedPageId as string | undefined)
    : undefined
  const itemTitleLabel =
    (promptMessage?.metadata?.itemTitle as string | undefined) || ''

  // Warm lean embed document (and mount hidden iframe) so first nav isn’t a cold boot
  const prefetchPagePreview = () => {
    if (!linkedPageId) return
    prefetchPageEmbed(linkedPageId)
    router.prefetch(`/embed/${linkedPageId}`)
    setPagePreviewMounted(true)
  }

  // Update line-height + item box when note/item is resized using ResizeObserver
  useEffect(() => {
    if (!isItem || !panelRef.current) return
    
    const updateFromSize = () => {
      const newLineHeight = calculateNoteLineHeight() // Keep note typography in sync with height
      setNoteLineHeight(newLineHeight)
      if (panelRef.current) {
        setItemBoxSize({
          width: panelRef.current.offsetWidth || 200, // Perimeter width for title chip
          height: panelRef.current.offsetHeight || 120, // Perimeter height for title chip
        })
      }
    }
    
    // Initial calculation
    updateFromSize()
    
    // Set up ResizeObserver to update line-height when panel is resized
    const resizeObserver = new ResizeObserver(() => {
      updateFromSize()
    })
    
    resizeObserver.observe(panelRef.current)
    
    return () => {
      resizeObserver.disconnect()
    }
  }, [isItem, calculateNoteLineHeight])
  
  // Regular chat panels are those that are not flashcards and not notes
  const isRegularChatPanel = !isFlashcard && !isItem

  // Keep RF node width/height aligned with the measured item box so NodeResizeControl
  // starts from real size (fit-content nodes often have width/height 0 → drag looks like move)
  useEffect(() => {
    if (!isItem || !panelRef.current || !isInitialShrinkComplete) return // Wait until item has laid out
    const el = panelRef.current // Panel DOM for measurement
    const syncNodeSize = () => {
      if (isResizingRef.current || !el) return // During active resize, RF owns dimensions
      const width = el.offsetWidth // Measured content box width
      const height = el.offsetHeight // Measured content box height
      if (width <= 0 || height <= 0) return // Ignore empty frames
      const setNodesFunc = getSetNodes() // Board setNodes from context
      if (!setNodesFunc) return
      setNodesFunc((nodes: any[]) =>
        nodes.map((node: any) =>
          node.id === id && (node.width !== width || node.height !== height)
            ? { ...node, width, height } // Write baseline for corner-handle math
            : node
        )
      )
    }
    syncNodeSize() // Immediate sync on select/mount
    const ro = new ResizeObserver(syncNodeSize) // Re-sync when text/layout changes size
    ro.observe(el)
    return () => ro.disconnect()
  }, [isItem, id, getSetNodes, isInitialShrinkComplete, resizeDimensions, selected])

  // Handle resize end - clear resizing flag and persist explicit box size from final params
  const handleResizeEnd = useCallback(async (_event: any, params?: { width: number; height: number }) => {
    isResizingRef.current = false // Allow size-sync observer again
    isFirstResizeCallRef.current = true // Reset first-call bookkeeping

    // Prefer RF end params (avoids stale React state); fall back to current state
    const width = Math.max(params?.width ?? resizeDimensions?.width ?? 0, 200)
    const height = Math.max(params?.height ?? resizeDimensions?.height ?? 0, 40)
    if (width > 0 && height > 0) {
      setResizeDimensions({ width, height }) // Lock final box size into local state
    }

    if (isProjectBoard || !promptMessage) return // Nothing to persist on project boards

    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', promptMessage.id)
      .single()

    if (fetchError) {
      console.error('Error fetching message for resize save:', fetchError)
      return
    }

    const existingMetadata = (message?.metadata as Record<string, any>) || {}
    const updatedMetadata: Record<string, any> = {
      ...existingMetadata,
      resizeDimensions: { width, height }, // Persist box for reload
    }
    if (isItem) updatedMetadata.fontScale = fontScale // Keep legacy scale if present

    const { error: updateError } = await supabase
      .from('messages')
      .update({ metadata: updatedMetadata })
      .eq('id', promptMessage.id)

    if (updateError) {
      console.error('Error saving resize state to database:', updateError)
    }
  }, [isItem, isProjectBoard, promptMessage, fontScale, resizeDimensions, supabase])

  // Corner-drag resize: apply explicit width/height so the box grows/shrinks (not just moves)
  const handleResize = useCallback((_event: any, params: { width: number; height: number }) => {
    isResizingRef.current = true // Block observer from fighting live resize
    const width = Math.max(params.width, 200) // Enforce min width
    const height = Math.max(params.height, 40) // Enforce min height so handles stay usable
    setResizeDimensions({ width, height }) // Drive panel style — matches RF dimension changes
  }, [])

  // Persist item rotation degrees into message metadata after a rotate gesture ends
  const saveRotation = useCallback(async (nextRotation: number) => {
    if (isProjectBoard || !promptMessage) return // Project boards / missing message: skip DB write
    const { data: message, error: fetchError } = await supabase // Fetch current metadata blob
      .from('messages')
      .select('metadata')
      .eq('id', promptMessage.id)
      .single()
    if (fetchError) { // Bail if we cannot read existing metadata
      console.error('Error fetching message for rotation save:', fetchError)
      return
    }
    const existingMetadata = (message?.metadata as Record<string, any>) || {} // Keep other metadata keys
    const { error: updateError } = await supabase // Write rotation alongside existing fields
      .from('messages')
      .update({ metadata: { ...existingMetadata, rotation: nextRotation } })
      .eq('id', promptMessage.id)
    if (updateError) console.error('Error saving rotation to database:', updateError) // Surface write failures
  }, [isProjectBoard, promptMessage, supabase])

  // Begin rotate: measure angle from panel center to pointer and lock drag state
  const handleRotatePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation() // Do not select/drag the RF node
    e.preventDefault() // Avoid text selection while rotating
    if (!panelRef.current) return // Need geometry for center
    const rect = panelRef.current.getBoundingClientRect() // Screen-space panel bounds
    const cx = rect.left + rect.width / 2 // Horizontal center in viewport
    const cy = rect.top + rect.height / 2 // Vertical center in viewport
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) // Initial pointer angle (radians)
    isRotatingRef.current = true // Mark active rotate session
    rotationDragRef.current = { startAngle, startRotation: rotation } // Baseline for delta math
    e.currentTarget.setPointerCapture(e.pointerId) // Keep events on this handle while dragging
  }, [rotation])

  // Live-update rotation from pointer deltas relative to panel center
  const handleRotatePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current || !rotationDragRef.current || !panelRef.current) return // Ignore stray moves
    const rect = panelRef.current.getBoundingClientRect() // Re-measure (zoom/pan may change)
    const cx = rect.left + rect.width / 2 // Center X
    const cy = rect.top + rect.height / 2 // Center Y
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx) // Current pointer angle
    const deltaDeg = ((angle - rotationDragRef.current.startAngle) * 180) / Math.PI // Radians → degrees
    let next = rotationDragRef.current.startRotation + deltaDeg // Apply delta to start rotation
    if (e.shiftKey) next = Math.round(next / 15) * 15 // Hold Shift to snap to 15° increments
    setRotation(next) // Paint live rotation
  }, [])

  // End rotate: release capture and persist the final angle
  const handleRotatePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRotatingRef.current) return // Only finish an active gesture
    isRotatingRef.current = false // Clear rotating flag
    rotationDragRef.current = null // Drop drag baseline
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    setRotation((current) => { // Read latest angle then persist
      void saveRotation(current) // Fire-and-forget metadata save
      return current // No state change needed
    })
  }, [saveRotation])

  // Auto-select panel when editor is focused or has selection (text edit mode)
  const handleEditorActiveChange = useCallback((isActive: boolean) => {
    if (isActive && !selected) {
      // Editor is active (focused or has selection) but panel is not selected - auto-select it
      // First deselect all other nodes, then select this one
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, selected: true }
            : { ...node, selected: false }
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
  // Item panels use fit-content width
  const isItemPanel = isItemMeta(promptMessage?.metadata)
  // Items use fit-content width, flashcards and regular panels use fixed width
  const usesFitContent = isItemPanel
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

  // Sync single text body when underlying messages change (plain-merge prompt + response)
  useEffect(() => {
    if (isProjectBoard) {
      if (data.boardTitle !== promptContent && !promptHasChanges) {
        setPromptContent(data.boardTitle)
      }
    } else if (!promptHasChanges) {
      const responseHtml = responseMessage?.content
        ? formatResponseContent(responseMessage.content)
        : ''
      const merged = mergePanelHtml(promptMessage?.content, responseHtml)
      if (merged !== promptContent) {
        setPromptContent(merged)
      }
    }
    // Reset auto-focus ref when prompt message changes (new note created)
    hasAutoFocusedRef.current = false
  }, [isProjectBoard, isProjectBoard ? data.boardTitle : promptMessage?.content, responseMessage?.content, promptContent, promptHasChanges, data, promptMessage?.id])

  // Keep responseContent mirror for width-measurement helpers that still read it
  useEffect(() => {
    if (responseMessage && responseMessage.content) {
      const formattedContent = formatResponseContent(responseMessage.content)
      if (formattedContent !== responseContent && !responseHasChanges) {
        setResponseContent(formattedContent)
        setTimeout(() => {
          if (!usesFitContent) {
            expandPanelWidth()
          }
        }, 100)
      }
    } else if (!responseMessage) {
      setResponseContent('')
    }
  }, [responseMessage?.id, responseMessage?.content, responseContent, responseHasChanges, usesFitContent, expandPanelWidth])

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
        // For regular panels, delete messages — and linked page if this item was titled
        if (!promptMessage) return

        const messageIds = [promptMessage.id]
        if (responseMessage) {
          messageIds.push(responseMessage.id)
        }

        // Keep Pages menu in sync: deleting a titled item removes its page map
        try {
          await deleteLinkedPageForItem(supabase, promptMessage.metadata as Record<string, unknown>)
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        } catch (linkErr) {
          console.error('Failed to delete linked page for item:', linkErr)
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
  const isComponentPanel = isItem || promptContentValue.trim().length === 0
  // const isFlashcard = promptMessage?.metadata?.isFlashcard === true // Already defined at top
  // Show grey area if: has content OR is a flashcard (even if empty) OR has response message (to show nested on response load, even if content is empty during streaming)
  // Notes never show grey area (they're simple note nodes)
  const shouldShowGreyArea = !isItem && (promptContentValue.trim().length > 0 || isFlashcard || !!responseMessage)
  // Calculate loading state: response is loading when responseMessage doesn't exist or has no content yet
  // Notes never show loading state (they don't have responses)
  const isLoading = !isItem && (!responseMessage || (responseMessage && !responseMessage.content))
  
  // Measure panel's content aspect ratio for note panels (needed for proper height calculation during resize)
  // This captures the natural aspect ratio of the panel content (text + padding) when first rendered
  useEffect(() => {
    if (isItem && panelRef.current && isInitialShrinkComplete && !resizeDimensions) {
      // Wait a bit for the panel to fully render and settle
      const timeoutId = setTimeout(() => {
        const panelElement = panelRef.current
        if (!panelElement) return
        
        // Measure the panel's current dimensions (this represents the natural aspect ratio of the content)
        const panelWidth = panelElement.offsetWidth
        const panelHeight = panelElement.offsetHeight
        
        if (panelWidth > 0 && panelHeight > 0 && initialTextAspectRatioRef.current === null) {
          // Calculate panel's natural aspect ratio (width/height)
          // This includes the text content plus all padding
          initialTextAspectRatioRef.current = panelWidth / panelHeight
        }
      }, 100) // Small delay to ensure panel is fully rendered
      
      return () => clearTimeout(timeoutId)
    }
  }, [isItem, isInitialShrinkComplete, promptContent, resizeDimensions])

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

  // Corner resize dots match mockup: white fill, thin gray ring, circular
  // Slightly larger than the visual ring so the hit target is easier to grab than the node body
  const itemCornerResizeStyle = {
    width: 14, // Hit target (CSS paints the inner 10px circle)
    height: 14, // Keep square so border-radius yields a circle
    background: resolvedTheme === 'dark' ? '#1a1a1a' : '#ffffff', // Contrast against board
    border: '1.5px solid #9ca3af', // Neutral ring (not selection blue)
    borderRadius: '50%', // Circular corner handles
    boxSizing: 'border-box' as const, // Include border in box size
    zIndex: 60, // Above title chip / connection dots so drag hits resize, not node drag
  }

  return (
    <div
        ref={panelRef}
        data-panel-container="true" // Data attribute to help find panel container for comment popup
        data-item-node={isItem ? 'true' : undefined} // Marks items for selected connection-dot styling
        className={cn(
          'group rounded-2xl border relative cursor-grab active:cursor-grabbing overflow-visible backdrop-blur-sm transition-[opacity,box-shadow,background-color,border-color] duration-300', // No transform transition so live rotate stays snappy
          // Always show blue border when selected, otherwise use custom border color or default theme-based color
          selected ? 'border-blue-500 dark:border-blue-400' : (data.borderColor ? '' : 'border-gray-200 dark:border-[#2f2f2f]'),
          isBookmarked
            ? 'shadow-[0_0_8px_rgba(250,204,21,0.6)] dark:shadow-[0_0_8px_rgba(250,204,21,0.4)]'
            : (data.borderStyle === 'none' ? 'shadow-none' : 'shadow-sm'),
          // Blur non-flashcard panels when flashcard study mode is active
          shouldBlur && 'blur-sm opacity-40 pointer-events-none'
        )}
      style={{
        // Item panels use fit-content width (grows with text), others use fixed width
        // Page preview expands the item into a board-within-board window
        width: pagePreviewOpen
          ? '520px'
          : resizeDimensions
            ? `${resizeDimensions.width}px`
            : (usesFitContent ? 'fit-content' : `${panelWidthToUse}px`),
        // Preview mode: fixed window — body text is hidden so it can’t sit under the preview chrome
        height: pagePreviewOpen ? '420px' : (resizeDimensions ? `${resizeDimensions.height}px` : undefined),
        minWidth: pagePreviewOpen ? '520px' : (usesFitContent ? '200px' : (isFlashcard ? '300px' : '200px')),
        minHeight: pagePreviewOpen ? '420px' : '0px',
        maxWidth: undefined,
        opacity: isInitialShrinkComplete ? 1 : 0,
        backgroundColor: panelBackgroundColor,
        borderColor: selected ? undefined : (data.borderColor || undefined),
        borderStyle: selected ? 'solid' : (data.borderStyle as any || undefined),
        borderWidth: selected ? (data.borderWeight || '1px') : (data.borderWeight || undefined),
        transform: rotation ? `rotate(${rotation}deg)` : undefined, // Apply persisted/live item rotation
        transformOrigin: 'center center', // Rotate around panel center (matches drag math)
      }}
      onClick={(e) => {
        // Single-section items: no collapse expand-on-click
      }}
      onDoubleClick={(e) => {
        // Double-click anywhere on panel focuses the single text editor
        const target = e.target as HTMLElement
        if (target.closest('button, a, [contenteditable="true"], input, textarea, select')) {
          return
        }
        e.stopPropagation()
        const editorToFocus = promptEditorRef.current
        if (editorToFocus && !editorToFocus.isDestroyed) {
          setTimeout(() => {
            editorToFocus.commands.focus()
            const docSize = editorToFocus.state.doc.content.size
            if (docSize > 1) {
              editorToFocus.commands.setTextSelection(docSize - 1)
            }
          }, 0)
        }
      }}
    >
      {/* Selected items: four circular corner resize handles (replaces bottom-right toolbar island) */}
      {selected && isItem && (
        <>
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((position) => (
            <NodeResizeControl
              key={position} // One control per corner
              position={position} // RF places the handle on that corner
              className="nopan" // Prevent canvas pan while resizing
              style={itemCornerResizeStyle} // White circular handle styling
              minWidth={200} // Match prior item min width
              minHeight={40} // Keep a usable box; pairs with handleResize clamp
              keepAspectRatio={false} // Free-form box resize (text reflows)
              onResize={handleResize} // Apply explicit width/height
              onResizeEnd={handleResizeEnd} // Persist resizeDimensions
            />
          ))}
          {/* Rotation affordance — bottom-left, outside the box (mockup) */}
          <button
            type="button"
            className="nodrag nopan absolute z-50 flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            style={{ left: 0, bottom: 0, marginLeft: '-18px', marginBottom: '-18px', cursor: 'grab' }} // Offset past corner handle
            title="Rotate"
            aria-label="Rotate item"
            onPointerDown={handleRotatePointerDown} // Start angle tracking
            onPointerMove={handleRotatePointerMove} // Live rotate
            onPointerUp={handleRotatePointerUp} // Persist angle
            onPointerCancel={handleRotatePointerUp} // Treat cancel as end
            onClick={(e) => e.stopPropagation()} // Never bubble to panel select/drag
          >
            <RotateCw className="h-4 w-4 pointer-events-none" /> {/* Curved-arrow icon from mockup */}
          </button>
        </>
      )}

      {/* Edge title chip — hidden while preview fills the card (chrome has title; chip would overlap) */}
      {isItem && !isProjectBoard && promptMessage?.id && !pagePreviewOpen && (
        <ItemTitleEdge
          selected={!!selected}
          width={itemBoxSize.width}
          height={itemBoxSize.height}
          messageId={promptMessage.id}
          conversationId={conversationId}
          itemTitle={promptMessage.metadata?.itemTitle as string | undefined}
          linkedPageId={linkedPageId}
          titleEdgeT={typeof promptMessage.metadata?.titleEdgeT === 'number' ? promptMessage.metadata.titleEdgeT : null}
          previewOpen={pagePreviewOpen}
          onTogglePreview={() => {
            setPagePreviewMounted(true) // Keep iframe after close for instant reopen
            setPagePreviewOpen((open) => !open)
          }}
          onPrefetchPreview={prefetchPagePreview}
          isPageBody={isPageBodyMeta(promptMessage.metadata as Record<string, unknown>)}
        />
      )}
      
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
        <>
          {/* Left handle - target (can receive connections) */}
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
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Left handle - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Top handle - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Top handle - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Right handle - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Right}
            id="right"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Right handle - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: handleColor,
              border: `1px solid ${handleBorderColor}`,
              '--handle-color': handleColor,
              '--handle-hover-color': handleHoverColor,
            } as React.CSSProperties}
          />
        </>
      ) : null}

      {/* Top and bottom handles for flashcards - regular handles (not arrow handles) */}
      {/* These are always shown for flashcards, regardless of navigation arrows */}
      {isFlashcard && !shouldHideHandles && (
        <>
          {/* Top handle for flashcards - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Top handle for flashcards - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Top}
            id="top"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle for flashcards - target (can receive connections) */}
          <Handle
            type="target"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
          {/* Bottom handle for flashcards - source (can send connections) */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            isConnectable={true}
            className={cn(
              'handle-dot',
              selected ? 'handle-dot-selected' : 'handle-dot-default'
            )}
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: isFillTransparent ? 'transparent' : handleColor,
              border: isBorderNone ? 'none' : `1px solid ${handleBorderColor}`,
              '--handle-color': isFillTransparent ? 'transparent' : handleColor,
              '--handle-hover-color': isFillTransparent ? 'transparent' : handleHoverColor,
            } as React.CSSProperties}
          />
        </>
      )}

      {/* Single text body — no prompt/response sections or collapse */}
      <div
        className={cn(
          'p-1 backdrop-blur-sm rounded-2xl relative overflow-visible',
          // Preview open: fill the card; body editor is hidden (content lives on the nested page)
          pagePreviewOpen && 'flex flex-col h-full min-h-0',
          promptMessage?.metadata?.fadeIn === true && 'animate-note-fade-in'
        )}
        style={{
          backgroundColor: responseAreaBackgroundColor,
        }}
      >
        {/* Hide body while previewing — keeps page title (edge chip / preview chrome) from sitting under the map */}
        {!pagePreviewOpen && (
          <div
            className="px-3 py-3"
            style={{ lineHeight: isItem ? noteLineHeight : '1.7' }}
          >
            <TipTapContent
              content={promptContent || ''}
              className="text-gray-900 dark:text-gray-100"
              originalContent={
                isProjectBoard
                  ? (data.boardTitle || '')
                  : mergePanelHtml(
                      promptMessage?.content,
                      responseMessage?.content ? formatResponseContent(responseMessage.content) : ''
                    )
              }
              onContentChange={handlePromptChange}
              onHasChangesChange={setPromptHasChanges}
              onComment={(selectedText, from, to) => handleComment(selectedText, from, to, 'prompt')}
              comments={comments.filter(c => c.section === 'prompt')}
              editorRef={promptEditorRef}
              fontScale={fontScale}
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
              isFlashcard={isFlashcard}
              isPanelSelected={selected}
              isLoading={false}
              onBlur={handleEditorBlur}
              onEditorActiveChange={handleEditorActiveChange}
            />
          </div>
        )}

        {/* Keep iframe mounted after warm/open; fills card while visible */}
        {pagePreviewMounted && linkedPageId && (
          <div
            className={cn(
              pagePreviewOpen ? 'flex-1 min-h-0 min-w-0 flex flex-col p-2 pt-2' : 'hidden'
            )}
          >
            <NestedBoardPreview
              conversationId={linkedPageId}
              title={itemTitleLabel}
              visible={pagePreviewOpen}
              fill={pagePreviewOpen}
              hostNodeId={id} // Chrome drag moves this host item
              onClose={() => setPagePreviewOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Right handle with flashcard navigation */}
      {/* Hide handle when comment popup is visible */}
      {isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) && nextBoardWithFlashcards && isAtLastFlashcardInBoard && selected ? (
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
      ) : isFlashcard && (hasMultipleFlashcards || hasFlashcardsInOtherBoards) ? (
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
      ) : !shouldHideHandles ? (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className={cn(
            'handle-dot',
            selected ? 'handle-dot-selected' : 'handle-dot-default'
          )}
          style={{
            width: '10px',
            height: '10px',
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
      
      {/* Flashcard tags only — copy / collapse / more under-item menu removed */}
      {selected && isFlashcard && responseMessage?.id && tagsLoaded && (
        <div 
          className="absolute left-0 flex items-start gap-1 bg-white dark:bg-[#1f1f1f] rounded-lg shadow-lg border border-gray-200 dark:border-[#2f2f2f] p-1 z-50 pointer-events-auto"
          style={{
            top: '100%', // Position below the panel
            marginTop: '8px', // Gap between panel and toolbar (matches note resize toolbar gap)
          }}
          onClick={(e) => e.stopPropagation()} // Prevent clicks from propagating to panel
        >
          <TagButton responseMessageId={responseMessage.id} />
          <TagBoxes responseMessageId={responseMessage.id} initialTagIds={tagIds} />
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

