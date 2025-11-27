// Board chat page - shows React Flow map with input box
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BoardFlow } from '@/components/board-flow'
import { ChatInput } from '@/components/chat-input'

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify conversation exists and belongs to user
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, title, user_id')
    .eq('id', conversationId)
    .single()

  if (error || !conversation || conversation.user_id !== user.id) {
    redirect('/board')
  }

  return (
    <div className="h-full relative">
      {/* React Flow board */}
      <BoardFlow conversationId={conversationId} />
      
      {/* Input box overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center p-4 pointer-events-none z-10">
        <div className="w-full max-w-3xl pointer-events-auto">
          <ChatInput conversationId={conversationId} />
        </div>
      </div>
    </div>
  )
}

