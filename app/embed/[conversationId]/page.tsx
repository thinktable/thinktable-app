// Lean board document for NestedBoardPreview iframes — no Pages sidebar / chat chrome.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BoardFlow } from '@/components/board-flow'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import { SidebarContextProvider } from '@/components/sidebar-context'
import { PageAccessProvider } from '@/lib/share/page-access-context'
import { resolvePageAccessRole } from '@/lib/share/server'

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

  const role = await resolvePageAccessRole(supabase, conversationId)
  if (!role) {
    redirect('/board')
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()

  if (error || !conversation) {
    redirect('/board')
  }

  return (
    <EditorProvider>
      <SidebarContextProvider>
        <ReactFlowContextProvider conversationId={conversationId}>
          <PageAccessProvider role={role} pageId={conversationId}>
            <BoardFlow conversationId={conversationId} embedded />
          </PageAccessProvider>
        </ReactFlowContextProvider>
      </SidebarContextProvider>
    </EditorProvider>
  )
}
