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
import { useEffect, useRef, useState } from 'react'
import { Highlighter, RotateCcw, MoreHorizontal, Trash2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface ChatPanelNodeData {
  promptMessage: Message
  responseMessage?: Message
  conversationId: string
}

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', color: '#fef08a' },
  { name: 'Green', color: '#86efac' },
  { name: 'Blue', color: '#93c5fd' },
  { name: 'Pink', color: '#f9a8d4' },
  { name: 'Orange', color: '#fdba74' },
]

function TipTapContent({ 
  content, 
  className, 
  originalContent,
  onContentChange,
  onHasChangesChange
}: { 
  content: string
  className?: string
  originalContent: string
  onContentChange?: (newContent: string) => void
  onHasChangesChange?: (hasChanges: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({
        multicolor: true,
      }),
      TextStyle,
      Color,
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
  })

  useEffect(() => {
    if (editor) {
      const currentContent = editor.getHTML()
      // Always sync content, even if empty (to clear editor when content is removed)
      if (currentContent !== content) {
        editor.commands.setContent(content || '<p></p>')
      }
    }
  }, [editor, content])

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
          placement: 'top', // Force above selection
          offset: 8, // 8px above the selection
        }}
      >
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex items-center gap-1">
          <Highlighter className="h-4 w-4 text-gray-600" />
          {HIGHLIGHT_COLORS.map(({ name, color }) => (
            <Button
              key={name}
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
              className="h-8 w-8 p-0 rounded"
              style={{ backgroundColor: color }}
              title={name}
            >
              <span className="sr-only">{name}</span>
            </Button>
          ))}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  )
}

export function ChatPanelNode({ data, selected }: NodeProps<ChatPanelNodeData>) {
  const { promptMessage, responseMessage, conversationId } = data
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [promptHasChanges, setPromptHasChanges] = useState(false)
  const [responseHasChanges, setResponseHasChanges] = useState(false)
  const [promptContent, setPromptContent] = useState(promptMessage.content)
  const [responseContent, setResponseContent] = useState(responseMessage?.content || '')
  const [isDeleting, setIsDeleting] = useState(false)

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
        setResponseContent(newContent)
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
      className={cn(
        'bg-white rounded-xl shadow-sm border min-w-[400px] max-w-[500px] relative cursor-grab active:cursor-grabbing',
        selected ? 'border-blue-500' : 'border-gray-200'
      )}
    >
      <Handle type="target" position={Position.Top} />
      
      {/* Prompt section at top */}
      <div className="p-4 border-b border-gray-200 bg-white rounded-t-xl pb-12">
        <TipTapContent 
          content={promptContent}
          className="text-gray-900"
          originalContent={promptMessage.content}
          onContentChange={handlePromptChange}
          onHasChangesChange={setPromptHasChanges}
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

      {/* Response section below */}
      {responseMessage && (
        <div className="p-4 bg-white rounded-b-xl pb-12">
          <TipTapContent 
            key={`response-${responseMessage.id}`} // Force re-render when message ID changes
            content={responseContent || responseMessage.content || ''}
            className="text-gray-700"
            originalContent={responseMessage.content || ''}
            onContentChange={handleResponseChange}
            onHasChangesChange={setResponseHasChanges}
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
      )}

      {/* Bottom action buttons - Copy and More menu at bottom left */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 z-10">
        {/* Copy button - two overlapping squares */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded hover:bg-gray-50"
          onClick={(e) => {
            e.stopPropagation()
            // Copy the full panel content (prompt + response)
            const fullContent = `${promptContent}\n\n${responseContent || ''}`.trim()
            navigator.clipboard.writeText(fullContent)
          }}
          title="Copy panel content"
        >
          <Copy className="h-4 w-4 text-gray-600" />
        </Button>
        
        {/* More menu button - horizontal ellipsis */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded hover:bg-gray-50"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4 text-gray-600" />
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
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

