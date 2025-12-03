// Board chat page - shows React Flow map with input box
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BoardFlow } from '@/components/board-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'

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
    <EditorProvider>
      <ReactFlowContextProvider>
        <div className="h-full relative">
          {/* React Flow board */}
          <BoardFlow conversationId={conversationId} />
          
          {/* Input box overlay at bottom with sticky prompt panel */}
          <InputAreaWithStickyPrompt conversationId={conversationId} />
        </div>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}

