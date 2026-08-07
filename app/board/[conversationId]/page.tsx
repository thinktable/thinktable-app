// Board chat page - map column + optional full-height right chat sidebar
// In-item previews use `/embed/{id}` (not this route) so they skip the board sidebar layout.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BoardFlow } from '@/components/board-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { ChatSidebar } from '@/components/chat-sidebar'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import { PreviewFocusProvider } from '@/lib/preview-focus-context'

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
      <ReactFlowContextProvider conversationId={conversationId}>
        <PreviewFocusProvider>
          <div className="h-full flex">
            <div className="flex-1 relative min-w-0 h-full">
              <BoardFlow conversationId={conversationId} />
              <InputAreaWithStickyPrompt conversationId={conversationId} />
            </div>
            <ChatSidebar conversationId={conversationId} />
          </div>
        </PreviewFocusProvider>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}
