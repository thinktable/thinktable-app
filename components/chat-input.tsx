'use client'

// Chat input component - centered when no board is selected
import { useState, useRef, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowUp, Loader2, Plus, Paperclip, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useReactFlowContext } from './react-flow-context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ChatInputProps {
  conversationId?: string // Optional - if provided, sends to existing conversation
  projectId?: string // Optional - if provided, creates new board in this project
  onHeightChange?: (height: number) => void // Callback to notify parent of height changes
}

interface QueuedPrompt {
  id: string
  message: string
  timestamp: number
}

export function ChatInput({ conversationId, projectId, onHeightChange }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [inputHeight, setInputHeight] = useState(52) // Track current input height
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]) // Queue of pending prompts
  const [isResearchMode, setIsResearchMode] = useState(false) // Track if Research mode is active
  const [isFlashcardsMode, setIsFlashcardsMode] = useState(false) // Track if Create flashcards mode is active
  const [isResearchDialogOpen, setIsResearchDialogOpen] = useState(false) // Track if Research dialog is open
  const { isDeterministicMapping } = useReactFlowContext() // Get deterministic mapping state from context
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Keep textarea focused even when clicking elsewhere (unless clicking on interactive elements or selecting text)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Track the last click target to determine if we should refocus
    let lastClickTarget: HTMLElement | null = null

    const refocusTextarea = () => {
      if (textarea && document.activeElement !== textarea) {
        // Check if user is selecting text - if so, don't refocus
        const selection = window.getSelection()
        const hasSelection = selection && selection.toString().length > 0

        if (!hasSelection) {
          textarea.focus()
          // Move cursor to end of text
          const length = textarea.value.length
          textarea.setSelectionRange(length, length)
        }
      }
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      lastClickTarget = target // Store the click target

      // Clear text selection if clicking away from selected text
      const selection = window.getSelection()
      if (selection && selection.toString().length > 0) {
        // Check if click is within the selection or on an interactive element
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
        let clickInSelection = false

        if (range) {
          // Check if click target is within the selection's container
          const selectionContainer = range.commonAncestorContainer
          const clickInContainer = selectionContainer.nodeType === Node.TEXT_NODE
            ? selectionContainer.parentElement?.contains(target)
            : (selectionContainer as Element)?.contains(target)

          // Also check if click is within the selection's bounding rectangle
          const rect = range.getBoundingClientRect()
          const clickInBounds = event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom

          clickInSelection = clickInContainer || clickInBounds
        }

        // Don't clear selection if:
        // - Clicking within the selected text
        // - Clicking on buttons, dropdowns, or other interactive elements
        // - Clicking on contenteditable elements (TipTap editors) - allow editing
        const isInteractive = target.closest('button') ||
          target.closest('[role="menu"]') ||
          target.closest('[role="menuitem"]') ||
          target.closest('.dropdown-menu')

        // Don't clear if clicking on contenteditable (user might be editing)
        const isOnContentEditable = target.closest('[contenteditable="true"]') ||
          target.closest('.ProseMirror')

        // Clear selection if clicking away (not in selection and not on interactive element or contenteditable)
        if (!clickInSelection && !isInteractive && !isOnContentEditable) {
          selection.removeAllRanges()
        }
      }

      // Don't refocus if clicking on:
      // - The textarea itself or form
      // - Buttons or interactive elements
      // - Dropdown menus
      // - Comment input boxes (textarea elements that are comment inputs)
      const isCommentInput = (target.tagName === 'TEXTAREA' && target.hasAttribute('data-comment-input')) ||
        target.closest('textarea[data-comment-input]')
      const isInteractive = target.closest('button') ||
        target.closest('[role="menu"]') ||
        target.closest('[role="menuitem"]') ||
        target.closest('.dropdown-menu') ||
        target.closest('form') ||
        target === textarea ||
        textarea.contains(target) ||
        isCommentInput

      // Check if clicking on panels or contenteditable (TipTap editors)
      const isOnPanel = target.closest('.react-flow__node')
      const isOnContentEditable = target.closest('[contenteditable="true"]')

      // Don't refocus if clicking on panels or contenteditable - allow user to edit panel content
      // BUT don't refocus if clicking on comment inputs
      if (!isInteractive && !isOnPanel && !isOnContentEditable) {
        // Short delay to allow other interactions to complete
        setTimeout(refocusTextarea, 10)
      }
    }

    // Handle mouseup events (after selection) - refocus if not selecting text
    // BUT don't refocus if clicking on panels or contenteditable elements
    const handleMouseUp = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const isOnPanel = target.closest('.react-flow__node')
      const isOnContentEditable = target.closest('[contenteditable="true"]')

      // Don't refocus if clicking on panels or contenteditable - allow user to edit panel content
      if (!isOnPanel && !isOnContentEditable) {
        setTimeout(refocusTextarea, 100)
      }
    }

    // Handle when React Flow nodes are selected - refocus after selection
    // BUT don't refocus if user clicked on a panel or contenteditable element
    const handleNodeSelect = () => {
      // Check if the last click was on a panel or contenteditable
      const wasClickOnPanel = lastClickTarget?.closest('.react-flow__node')
      const wasClickOnContentEditable = lastClickTarget?.closest('[contenteditable="true"]')

      // Also check current active element as fallback
      const activeElement = document.activeElement as HTMLElement
      const isOnContentEditable = activeElement?.isContentEditable ||
        activeElement?.closest('[contenteditable="true"]')
      const isOnPanel = activeElement?.closest('.react-flow__node')

      // Don't refocus if user clicked on or is currently editing panel content
      if (!wasClickOnPanel && !wasClickOnContentEditable && !isOnContentEditable && !isOnPanel) {
        setTimeout(refocusTextarea, 100)
      }
    }

    // Listen for React Flow node selection events
    window.addEventListener('node-selected', handleNodeSelect)

    // Add event listeners
    document.addEventListener('mousedown', handleDocumentClick, true)
    document.addEventListener('mouseup', handleMouseUp, true)

    // Initial focus
    if (textarea && document.activeElement !== textarea) {
      textarea.focus()
    }

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      window.removeEventListener('node-selected', handleNodeSelect)
    }
  }, [])

  // Auto-resize textarea and notify parent of height changes
  useEffect(() => {
    if (textareaRef.current) {
      // Reset to base state for measurement
      textareaRef.current.style.height = '52px'
      textareaRef.current.style.lineHeight = '52px'
      textareaRef.current.style.paddingTop = '0px'
      textareaRef.current.style.paddingBottom = '0px'

      // Check if content fits in one line (pill shape)
      const scrollHeight = textareaRef.current.scrollHeight
      const fitsInOneLine = scrollHeight <= 52

      if (fitsInOneLine) {
        // Content fits in one line - keep pill shape
        textareaRef.current.style.height = '52px'
        textareaRef.current.style.lineHeight = '52px' // Match height exactly for perfect pill
        textareaRef.current.style.paddingTop = '0px' // No padding to maintain pill shape
        textareaRef.current.style.paddingBottom = '0px' // No padding to maintain pill shape
        textareaRef.current.style.overflow = 'hidden'
      } else {
        // Content needs multiple lines - expand naturally
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.lineHeight = '1.4'
        textareaRef.current.style.paddingTop = '13px' // Add padding when expanded
        textareaRef.current.style.paddingBottom = '13px' // Add padding when expanded
        const expandedHeight = textareaRef.current.scrollHeight
        textareaRef.current.style.height = `${expandedHeight}px`
        textareaRef.current.style.overflow = 'auto'
      }

      // Track current height for button positioning
      const currentHeight = textareaRef.current.offsetHeight
      setInputHeight(currentHeight)

      // Notify parent of height change (include padding)
      if (onHeightChange && formRef.current) {
        const height = formRef.current.offsetHeight
        onHeightChange(height)
      }
    }
  }, [input, onHeightChange])

  // Process a single prompt (extracted for queue processing)
  const processPrompt = async (userMessage: string, currentConversationId: string) => {
    setIsLoading(true)

    let convId = currentConversationId

    try {
      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        throw new Error('Not authenticated. Please refresh the page and try again.')
      }

      // If no conversation ID, create a new conversation/board
      if (!convId) {
        // First, create the conversation with a temporary title
        // Set position to -1 to ensure it appears at the top of the sidebar list
        // If projectId is provided, add it to metadata but don't set position (project boards sort by created_at)
        const metadata: Record<string, any> = {}
        if (projectId) {
          // For project boards, don't set position - they'll sort by created_at descending (newest first)
          metadata.project_id = projectId
        } else {
          // For regular boards, set position to -1 to appear at top of main list
          metadata.position = -1
        }

        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation', // Temporary title, will be updated by AI
            metadata: metadata,
          })
          .select()
          .single()

        if (convError) {
          throw new Error('Failed to create conversation: ' + convError.message)
        }

        convId = newConversation.id

        // Dispatch event IMMEDIATELY to update conversationId state synchronously
        // This must happen before creating the message so the query is enabled
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('conversation-created', { detail: { conversationId: convId } }))
        }
        // Update URL to include conversation ID (like ChatGPT)
        router.replace(`/board/${convId}`)
      }

      // Create user message first (with isFlashcard metadata if in flashcards mode)
      const { data: userMessageData, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: userMessage,
          ...(isFlashcardsMode && { metadata: { isFlashcard: true } }), // Set flashcard metadata if mode is enabled
        })
        .select()
        .single()

      if (msgError) {
        throw new Error('Failed to send message: ' + msgError.message)
      }

      // Optimistically update the query cache to show panel immediately
      // This works even if conversationId state hasn't updated yet
      console.log('🔄 ChatInput: User message created, optimistically updating cache for:', convId)
      queryClient.setQueryData(['messages-for-panels', convId], (oldMessages: Message[] | undefined) => {
        if (!oldMessages) {
          return [userMessageData]
        }
        // Add the new message if it's not already there
        const exists = oldMessages.some(m => m.id === userMessageData.id)
        if (!exists) {
          return [...oldMessages, userMessageData].sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        }
        return oldMessages
      })

      // Trigger a refetch to ensure the query is enabled and runs
      // Use a small delay to ensure conversationId state has updated
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['messages-for-panels', convId] })
      }, 50)

      // Generate board name from AI (for any chat, not just first message)
      // Only skip if conversation was manually renamed
      try {
        // Check if conversation was manually renamed before generating name
        const { data: conv } = await supabase
          .from('conversations')
          .select('title, metadata')
          .eq('id', convId)
          .single()

        // Only skip if user manually renamed (metadata flag is true)
        // "New Conversation" is just the default title and should be overridden by AI
        const isManuallyRenamed = conv?.metadata?.manuallyRenamed === true
        const isDefaultTitle = conv?.title === 'New Conversation'

        // Generate AI name if: not manually renamed, OR it's still the default title
        if (!isManuallyRenamed || isDefaultTitle) {
          const nameResponse = await fetch('/api/chat/generate-board-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: userMessage,
            }),
          })

          if (nameResponse.ok) {
            const data = await nameResponse.json()
            // Extract AI-generated title from API response (NOT the prompt)
            const aiGeneratedTitle = data?.title?.trim()

            // Validate AI-generated title was received
            // Trust the API's fallback generation - only reject if it's still an exact match
            // The API should have already handled similarity checks and generated a fallback
            const titleLower = aiGeneratedTitle?.toLowerCase().trim() || ''
            const promptLower = userMessage.toLowerCase().trim()
            const exactMatch = titleLower === promptLower

            // Only reject exact matches - trust API's fallback for similar titles
            if (aiGeneratedTitle && aiGeneratedTitle.length > 0 && !exactMatch) {
              console.log('📝 AI generated board title:', aiGeneratedTitle, '(from prompt:', userMessage.substring(0, 50) + '...)')
              console.log('✅ Updating title to AI-generated:', aiGeneratedTitle)

              // Update conversation with AI-generated title (NOT the prompt)
              const { error: updateError, data: updatedConv } = await supabase
                .from('conversations')
                .update({ title: aiGeneratedTitle })
                .eq('id', convId)
                .select()
                .single()

              if (!updateError && updatedConv) {
                console.log('✅ Board title updated in DB:', updatedConv.title)

                // Immediately invalidate and refetch - don't wait
                queryClient.invalidateQueries({ queryKey: ['conversations'] })
                const refetchResult = await queryClient.refetchQueries({ queryKey: ['conversations'] })
                console.log('🔄 Refetched conversations, result:', refetchResult)

                // Trigger event for sidebar (multiple times to ensure it catches)
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new Event('conversation-updated'))
                  setTimeout(() => {
                    window.dispatchEvent(new Event('conversation-updated'))
                  }, 50)
                }

                // Additional refetch after short delay to catch any timing issues
                setTimeout(async () => {
                  await queryClient.refetchQueries({ queryKey: ['conversations'] })
                }, 100)

                setTimeout(async () => {
                  await queryClient.refetchQueries({ queryKey: ['conversations'] })
                }, 300)

                // Refresh router
                setTimeout(() => {
                  router.refresh()
                }, 200)
              } else {
                console.error('❌ Failed to update conversation title:', updateError)
              }
            } else {
              if (!aiGeneratedTitle || aiGeneratedTitle.length === 0) {
                console.warn('⚠️ No AI-generated title received from API. Response:', data)
              } else {
                console.warn('⚠️ AI returned prompt text or too similar. Title:', aiGeneratedTitle, '| Prompt:', userMessage.substring(0, 50))
                console.warn('⚠️ Skipping title update - API should have generated fallback, but validation failed')
                // The API route should have handled this with fallback, but if it didn't, we skip updating
              }
            }
          } else {
            const errorData = await nameResponse.json().catch(() => ({}))
            console.error('Failed to generate board name:', nameResponse.status, errorData)
          }
        }
      } catch (error) {
        console.error('Failed to generate board name:', error)
        // Continue anyway - title can be updated later
      }

      // Call chat API to get AI response
      console.log('🔄 ChatInput: Calling /api/chat with:', {
        conversationId: convId,
        messageLength: userMessage.length,
        deterministicMapping: isDeterministicMapping,
      })

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: convId,
          message: userMessage,
          deterministicMapping: isDeterministicMapping,
          isFlashcardsMode: isFlashcardsMode, // Pass flashcard mode to API for metadata
        }),
      })

      console.log('🔄 ChatInput: API response status:', response.status, response.ok)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('🔄 ChatInput: API response error:', response.status, errorText)
        throw new Error(`Failed to get AI response: ${response.status} ${errorText}`)
      }

      // Handle streaming response
      console.log('🔄 ChatInput: Starting to read stream')
      const reader = response.body?.getReader()
      if (!reader) {
        console.error('🔄 ChatInput: No response body reader available')
        throw new Error('No response body reader available')
      }

      const decoder = new TextDecoder()
      let assistantContent = ''
      let hasReceivedContent = false
      let chunkCount = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('🔄 ChatInput: Stream done, received', chunkCount, 'chunks, content length:', assistantContent.length)
            break
          }

          chunkCount++
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n').filter(Boolean)

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              if (data === '[DONE]') {
                console.log('🔄 ChatInput: Received [DONE] signal')
                break
              }
              if (data === '') {
                continue
              }
              try {
                const parsed = JSON.parse(data)
                if (parsed && parsed.content) {
                  assistantContent += parsed.content
                  hasReceivedContent = true
                  if (chunkCount % 10 === 0 || assistantContent.length < 100) {
                    console.log('🔄 ChatInput: Received content chunk, total length:', assistantContent.length)
                  }
                }
                // Handle debug info from server - log ALL debug messages
                if (parsed && parsed.debug) {
                  console.log('🔄 ChatInput: Server debug:', parsed.debug)
                  // Log additional debug info if present
                  if (parsed.hasParsedData !== undefined) {
                    console.log('🔄 ChatInput: Debug details:', {
                      hasParsedData: parsed.hasParsedData,
                      hasPanels: parsed.hasPanels,
                      panelsCount: parsed.panelsCount,
                      parsedDataType: parsed.parsedDataType,
                      parsedDataKeys: parsed.parsedDataKeys,
                      parsedDataSample: parsed.parsedDataSample
                    })
                  }
                  if (parsed.messageKeys) {
                    console.log('🔄 ChatInput: Message keys:', parsed.messageKeys)
                  }
                  if (parsed.panelsCount !== undefined) {
                    console.log('🔄 ChatInput: Processing panels:', parsed.panelsCount)
                  }
                  if (parsed.panelIndex !== undefined) {
                    console.log('🔄 ChatInput: Creating message for panel:', parsed.panelIndex, 'content length:', parsed.contentLength)
                  }
                  if (parsed.messageId) {
                    console.log('🔄 ChatInput: Message created with ID:', parsed.messageId)
                  }
                }
                // Handle mapping data from deterministic mapping
                if (parsed && parsed.mapping && isDeterministicMapping) {
                  // Mapping data will be processed server-side
                  // Client just needs to refresh to see new panels and links
                  console.log('🔄 ChatInput: Received mapping data:', parsed.mapping)

                  // Handle edges data if present
                  if (parsed.edges && Array.isArray(parsed.edges)) {
                    console.log('🔄 ChatInput: Received edges data:', parsed.edges.length, 'edges')
                    // Dispatch custom event with edge data for board-flow to handle
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('edges-created', {
                        detail: { edges: parsed.edges }
                      }))
                    }
                  }

                  hasReceivedContent = true // Mark that we received something
                }
                // Handle errors
                if (parsed && parsed.error) {
                  console.error('🔄 ChatInput: API error in stream:', parsed.error)
                  throw new Error(parsed.error)
                }
              } catch (e) {
                // Skip invalid JSON or handle errors
                if (e instanceof Error && e.message) {
                  throw e
                }
                console.debug('🔄 ChatInput: Skipping invalid JSON chunk:', data)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
        console.log('🔄 ChatInput: Stream reader released')
      }

      console.log('🔄 ChatInput: Stream processing complete. hasReceivedContent:', hasReceivedContent, 'assistantContent length:', assistantContent.length)

      // If no content was received and deterministic mapping is enabled, the server should have created messages
      // But if no content at all, something went wrong
      if (!hasReceivedContent && !isDeterministicMapping) {
        console.warn('🔄 ChatInput: ⚠️ No content received from API stream')
      }

      // Create assistant message only if deterministic mapping is disabled
      // (When enabled, the server creates the messages from the structured output)
      if (!isDeterministicMapping && assistantContent) {
        console.log('🔄 ChatInput: Saving assistant message to database, length:', assistantContent.length)
        const { error: assistantError } = await supabase
          .from('messages')
          .insert({
            conversation_id: convId,
            user_id: user.id,
            role: 'assistant',
            content: assistantContent,
            ...(isFlashcardsMode && { metadata: { isFlashcard: true } }), // Set flashcard metadata if mode is enabled
          })

        if (assistantError) {
          console.error('🔄 ChatInput: Failed to save assistant message:', assistantError)
          throw new Error('Failed to save AI response: ' + assistantError.message)
        }
        console.log('🔄 ChatInput: Assistant message saved successfully')
      } else if (isDeterministicMapping) {
        console.log('🔄 ChatInput: Deterministic mapping enabled, messages should be created server-side')
      } else {
        console.warn('🔄 ChatInput: ⚠️ No assistant content to save, content length:', assistantContent.length)
      }

      // Immediately refetch messages to show panel right away
      console.log('🔄 ChatInput: Refetching messages immediately for conversation:', convId)
      await queryClient.refetchQueries({ queryKey: ['messages-for-panels', convId] })

      // Also invalidate to ensure everything stays in sync
      console.log('🔄 ChatInput: Invalidating queries for conversation:', convId)
      queryClient.invalidateQueries({ queryKey: ['messages-for-panels', convId] })
      queryClient.invalidateQueries({ queryKey: ['messages', convId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })

      // For deterministic mapping, messages are created server-side, so we need to wait a bit longer
      // and dispatch multiple events to ensure refetch happens
      if (typeof window !== 'undefined') {
        console.log('🔄 ChatInput: Dispatching message-updated event')
        window.dispatchEvent(new Event('message-updated'))

        // For deterministic mapping, dispatch additional events after delays to catch all messages
        if (isDeterministicMapping) {
          setTimeout(() => {
            console.log('🔄 ChatInput: Dispatching second message-updated event (deterministic mapping)')
            window.dispatchEvent(new Event('message-updated'))
          }, 500)

          setTimeout(() => {
            console.log('🔄 ChatInput: Dispatching third message-updated event (deterministic mapping)')
            window.dispatchEvent(new Event('message-updated'))
          }, 1000)
        }
      }

      setIsLoading(false)

      // Update URL and state if this was a new conversation
      // Note: Event and URL update already happened above when conversation was created
      if (convId) {
        // If already on the conversation page, just trigger sidebar refresh
        if (typeof window !== 'undefined') {
          console.log('🔄 ChatInput: Dispatching conversation-updated event for conversation:', convId)
          window.dispatchEvent(new Event('conversation-updated'))
        }
      }

      // Process next queued prompt if any
      setQueuedPrompts((queue) => {
        if (queue.length > 0) {
          const nextPrompt = queue[0]
          // Process next prompt asynchronously
          setTimeout(() => {
            processPrompt(nextPrompt.message, convId)
          }, 100)
          return queue.slice(1) // Remove processed prompt from queue
        }
        return queue
      })
    } catch (error: any) {
      console.error('Chat error:', error)
      console.error('Error stack:', error.stack)
      // Show error to user
      alert(error.message || 'Failed to send message. Please check the console for details.')
      setIsLoading(false)

      // Still try to refresh queries in case a partial response was saved
      if (convId) {
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', convId] })
      }

      // Process next queued prompt even on error
      setQueuedPrompts((queue) => {
        if (queue.length > 0) {
          const nextPrompt = queue[0]
          setTimeout(() => {
            processPrompt(nextPrompt.message, convId)
          }, 100)
          return queue.slice(1)
        }
        return queue
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMessage = input.trim()
    setInput('')

    // Immediately refocus textarea so user can continue typing (like Cursor)
    if (textareaRef.current) {
      textareaRef.current.focus()
    }

    try {
      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        throw new Error('Not authenticated. Please refresh the page and try again.')
      }

      let currentConversationId = conversationId

      // If no conversation ID, create a new conversation/board
      if (!currentConversationId) {
        // First, create the conversation with a temporary title
        // Set position to -1 to ensure it appears at the top of the sidebar list
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation', // Temporary title, will be updated by AI
            metadata: { position: -1 }, // Set position to -1 to appear at top
          })
          .select()
          .single()

        if (convError) {
          throw new Error('Failed to create conversation: ' + convError.message)
        }

        currentConversationId = newConversation.id

        // Dispatch event IMMEDIATELY to update conversationId state synchronously
        // This must happen before creating the message so the query is enabled
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('conversation-created', { detail: { conversationId: currentConversationId } }))
        }
        // Update URL to include conversation ID (like ChatGPT)
        router.replace(`/board/${currentConversationId}`)
      }

      // If already loading, add to queue instead of processing immediately
      if (isLoading) {
        const queuedPrompt: QueuedPrompt = {
          id: Date.now().toString(),
          message: userMessage,
          timestamp: Date.now(),
        }
        setQueuedPrompts((queue) => [...queue, queuedPrompt])
        return
      }

      // Process immediately if not loading
      await processPrompt(userMessage, currentConversationId!)
    } catch (error: any) {
      console.error('Error in handleSubmit:', error)
      alert(error.message || 'Failed to send message. Please check the console for details.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-2">
      {/* Queued prompts display - above input box */}
      {queuedPrompts.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
          {queuedPrompts.map((queued) => (
            <div
              key={queued.id}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="truncate">{queued.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="relative w-full">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Shift+Enter for new line)"
            style={{
              borderRadius: '26px',
              minHeight: '52px',
              paddingLeft: '40px',
              paddingRight: '40px',
              paddingTop: '0px',
              paddingBottom: '0px',
              boxSizing: 'border-box',
            }}
            className={cn(
              "max-h-[200px] resize-none focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200",
              (isResearchMode || isFlashcardsMode) ? "border border-blue-200 dark:border-blue-200" : "" // Light blue border for both modes
            )}
          />
          {/* Plus icon button with dropdown on the left */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                className="absolute left-2 rounded-full bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-200 border-0 shadow-none h-8 w-8"
                style={{
                  borderRadius: '50%', // Perfect circle
                  // Center at default height (52px), bottom when expanded
                  top: inputHeight <= 52 ? '50%' : 'auto',
                  bottom: inputHeight > 52 ? '8px' : 'auto',
                  transform: inputHeight <= 52 ? 'translateY(-50%)' : 'none',
                }}
              // Don't disable - allow prompt queuing
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 flex flex-col gap-1">
              <DropdownMenuItem
                onClick={() => {
                  console.log('Add photos & files clicked')
                }}
                className={cn(
                  "text-gray-700 dark:text-gray-300", // Default: grey tab text color
                  "hover:text-gray-900 dark:hover:text-white" // Hover: black text
                )}
              >
                <Paperclip className="h-4 w-4 mr-2" />
                Add photos & files
                <span className="ml-auto text-xs text-gray-500">⌘U</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-2" />
              <DropdownMenuItem
                onClick={() => {
                  const wasEnabled = isResearchMode
                  setIsResearchMode(!isResearchMode)
                  if (!wasEnabled) {
                    setIsResearchDialogOpen(true)
                  }
                  if (!wasEnabled && isFlashcardsMode) {
                    setIsFlashcardsMode(false)
                  }
                }}
                className={cn(
                  "text-gray-700 dark:text-gray-300", // Default: grey tab text color
                  isResearchMode && "bg-blue-50 dark:bg-[#2a2a3a] text-gray-900 dark:text-white hover:text-gray-900 dark:hover:text-white", // Selected: black text, same blue background
                  "hover:text-gray-900 dark:hover:text-white" // Hover: black text
                )}
              >
                <Search className="h-4 w-4 mr-2" />
                Research
                {isResearchMode && (
                  <span className="ml-auto text-xs">✓</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const wasEnabled = isFlashcardsMode
                  setIsFlashcardsMode(!isFlashcardsMode)
                  if (!wasEnabled && isResearchMode) {
                    setIsResearchMode(false)
                  }
                }}
                className={cn(
                  "text-gray-700 dark:text-gray-300", // Default: grey tab text color
                  isFlashcardsMode && "bg-blue-50 dark:bg-[#2a2a3a] text-gray-900 dark:text-white hover:text-gray-900 dark:hover:text-white", // Selected: black text, same blue background
                  "hover:text-gray-900 dark:hover:text-white" // Hover: black text
                )}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create flashcards
                {isFlashcardsMode && (
                  <span className="ml-auto text-xs">✓</span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Send button on the right */}
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            size="icon"
            className={cn(
              "absolute right-2 rounded-full h-8 w-8",
              input.trim()
                ? "bg-black dark:bg-white hover:bg-gray-900 dark:hover:bg-gray-200 text-white dark:text-black"
                : "bg-[#cbd5e1] dark:bg-gray-700 hover:bg-[#94a3b8] dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-500"
            )}
            style={{
              borderRadius: '50%', // Perfect circle
              // Center at default height (52px), bottom when expanded
              top: inputHeight <= 52 ? '50%' : 'auto',
              bottom: inputHeight > 52 ? '8px' : 'auto',
              transform: inputHeight <= 52 ? 'translateY(-50%)' : 'none',
            }}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>

      {/* Research Dialog - only shows when Research is toggled ON */}
      <Dialog open={isResearchDialogOpen} onOpenChange={setIsResearchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Research Mode</DialogTitle>
            <DialogDescription>
              Research mode is now active. This feature will help you gather and organize information.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}


