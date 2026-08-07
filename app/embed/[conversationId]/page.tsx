// Lean board document for NestedBoardPreview iframes — no Pages sidebar / chat chrome.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BoardFlow } from '@/components/board-flow'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import { SidebarContextProvider } from '@/components/sidebar-context'

export default async function EmbedBoardPage({
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
    .select('id, user_id')
    .eq('id', conversationId)
    .single()

  if (error || !conversation || conversation.user_id !== user.id) {
    redirect('/board')
  }

  return (
    <EditorProvider>
      <SidebarContextProvider>
        <ReactFlowContextProvider conversationId={conversationId}>
          <BoardFlow conversationId={conversationId} embedded />
        </ReactFlowContextProvider>
      </SidebarContextProvider>
    </EditorProvider>
  )
}
