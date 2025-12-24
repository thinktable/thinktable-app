'use client'

// Chat interface component - displays messages and input for a conversation
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ChatInput } from './chat-input'
import { MessageList } from './message-list'
import { useEffect, useRef } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface ChatInterfaceProps {
  conversationId: string
}

// Fetch messages for a conversation
async function fetchMessages(conversationId: string): Promise<Message[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching messages:', error)
    return []
  }
  return (data || []) as Message[]
}

export function ChatInterface({ conversationId }: ChatInterfaceProps) {
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => fetchMessages(conversationId),
    refetchInterval: 2000, // Refetch every 2 seconds for new messages
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-sm">
      {/* Messages area - transparent so React Flow shows through */}
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>

      {/* Input area - centered overlay */}
      <div className="flex justify-center p-4 bg-transparent">
        <div className="w-full max-w-3xl">
          <ChatInput conversationId={conversationId} />
        </div>
      </div>
    </div>
  )
}

