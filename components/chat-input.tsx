'use client'

// Chat input component - centered when no board is selected
import { useState, useRef, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowUp, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  conversationId?: string // Optional - if provided, sends to existing conversation
}

export function ChatInput({ conversationId }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input])

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

        // Generate board name from user's prompt using AI
        try {
          const nameResponse = await fetch('/api/chat/generate-board-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: userMessage,
            }),
          })

          if (nameResponse.ok) {
            const { title } = await nameResponse.json()
            // Update conversation title
            await supabase
              .from('conversations')
              .update({ title })
              .eq('id', currentConversationId)
          }
        } catch (error) {
          console.error('Failed to generate board name:', error)
          // Continue anyway - title can be updated later
        }
      }

      // Create user message
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

      // Call chat API to get AI response
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: currentConversationId,
          message: userMessage,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get AI response')
      }

      // Handle streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(Boolean)

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              if (data === '[DONE]' || data === '') {
                break
              }
              try {
                if (data === '' || data.length === 0) {
                  continue
                }
                const parsed = JSON.parse(data)
                if (parsed && parsed.content) {
                  assistantContent += parsed.content
                }
              } catch (e) {
                // Skip invalid JSON
                console.debug('Skipping invalid JSON chunk:', data)
              }
            }
          }
        }
      }

      // Create assistant message
      const { error: assistantError } = await supabase
        .from('messages')
        .insert({
          conversation_id: currentConversationId,
          user_id: user.id,
          role: 'assistant',
          content: assistantContent,
        })

      if (assistantError) {
        throw new Error('Failed to save AI response: ' + assistantError.message)
      }

      // Invalidate and immediately refetch queries to refresh the board flow and sidebar
      await queryClient.invalidateQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      await queryClient.invalidateQueries({ queryKey: ['messages', currentConversationId] })
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      
      // Force immediate refetch - wait a bit for database write to complete
      setTimeout(async () => {
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      }, 200)
      
      // Also refetch again after a longer delay to catch any timing issues
      setTimeout(async () => {
        await queryClient.refetchQueries({ queryKey: ['messages-for-panels', currentConversationId] })
      }, 1000)
      
      // Also trigger event for any listeners
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('message-updated'))
      }
      
      setIsLoading(false)

      // Redirect to the conversation page if this was a new conversation
      if (!conversationId) {
        router.push(`/board/${currentConversationId}`)
        router.refresh()
      } else {
        // If already on the conversation page, just trigger sidebar refresh
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('conversation-created'))
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error)
      alert(error.message || 'Failed to send message')
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-3xl mx-auto">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Shift+Enter for new line)"
          className="min-h-[52px] max-h-[200px] resize-none pr-12 rounded-full py-3.5"
          disabled={isLoading}
        />
        <Button
          type="submit"
          disabled={isLoading || !input.trim()}
          size="icon"
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 rounded-full",
            input.trim() 
              ? "bg-black hover:bg-gray-900 text-white" 
              : "bg-[#cbd5e1] hover:bg-[#94a3b8] text-gray-600 disabled:bg-gray-100 disabled:text-gray-400"
          )}
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

