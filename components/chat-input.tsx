'use client'

// Chat input component - centered when no board is selected
import { useState, useRef, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowUp, Loader2, Plus, Paperclip } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useReactFlowContext } from './react-flow-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ChatInputProps {
  conversationId?: string // Optional - if provided, sends to existing conversation
  onHeightChange?: (height: number) => void // Callback to notify parent of height changes
}

export function ChatInput({ conversationId, onHeightChange }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [inputHeight, setInputHeight] = useState(52) // Track current input height
  const { isDeterministicMapping } = useReactFlowContext() // Get deterministic mapping state from context
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

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
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: user.id,
            title: 'New Conversation', // Temporary title, will be updated by AI
          })
          .select()
          .single()

        if (convError) {
          throw new Error('Failed to create conversation: ' + convError.message)
        }

        currentConversationId = newConversation.id
      }

      // Create user message first
      const { data: userMessageData, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'user',
          content: userMessage,
        })
        .select()
        .single()

      if (msgError) {
        throw new Error('Failed to send message: ' + msgError.message)
      }

      // Generate board name from AI (for any chat, not just first message)
      // Only skip if conversation was manually renamed
      try {
        // Check if conversation was manually renamed before generating name
        const { data: conv } = await supabase
          .from('conversations')
          .select('title, metadata')
          .eq('id', currentConversationId)
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
                .eq('id', currentConversationId)
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
        conversationId: currentConversationId,
        messageLength: userMessage.length,
        deterministicMapping: isDeterministicMapping,
      })
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: currentConversationId,
          message: userMessage,
          deterministicMapping: isDeterministicMapping,
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
            conversation_id: currentConversationId,
            user_id: user.id,
            role: 'assistant',
            content: assistantContent,
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

      // Invalidate queries to mark them as stale - this will trigger refetch when components re-render
      console.log('🔄 ChatInput: Invalidating queries for conversation:', currentConversationId)
      queryClient.invalidateQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      queryClient.invalidateQueries({ queryKey: ['messages', currentConversationId] })
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

      // Redirect to the conversation page if this was a new conversation
      if (!conversationId) {
        console.log('🔄 ChatInput: New conversation created, redirecting to:', `/board/${currentConversationId}`)
        router.push(`/board/${currentConversationId}`)
        router.refresh()
      } else {
        // If already on the conversation page, just trigger sidebar refresh
        if (typeof window !== 'undefined') {
          console.log('🔄 ChatInput: Dispatching conversation-created event for conversation:', currentConversationId)
          window.dispatchEvent(new Event('conversation-created'))
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error)
      console.error('Error stack:', error.stack)
      // Show error to user
      alert(error.message || 'Failed to send message. Please check the console for details.')
      setIsLoading(false)
      
      // Still try to refresh queries in case a partial response was saved
      if (conversationId) {
        await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', conversationId] })
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="relative w-full max-w-3xl mx-auto">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Shift+Enter for new line)"
          className="max-h-[200px] resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{
            borderRadius: '26px', // Corner radius - fully rounded sides (pill shape) at default height
            minHeight: '52px', // Minimum height (2x corner radius) - ensures fully rounded sides at default
            paddingLeft: '40px', // Space for plus button (32px button + 8px gap)
            paddingRight: '40px', // Space for send button (32px button + 8px gap)
            paddingTop: '0px', // No top padding to maintain pill shape
            paddingBottom: '0px', // No bottom padding to maintain pill shape
            // Height and line-height are set dynamically in useEffect
            boxSizing: 'border-box', // Ensure padding is included in height calculation
          }}
          disabled={isLoading}
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
              disabled={isLoading}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                // TODO: Implement file upload functionality
                console.log('Add photos & files clicked')
              }}
            >
              <Paperclip className="h-4 w-4 mr-2" />
              Add photos & files
              <span className="ml-auto text-xs text-gray-500">⌘U</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2" />
            <DropdownMenuItem
              onClick={() => {
                // TODO: Implement create flashcards functionality
                console.log('Create flashcards clicked')
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create flashcards
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
  )
}

