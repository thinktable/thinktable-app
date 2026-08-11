// Board chat page - map column + optional full-height right chat sidebar
// In-item previews use `/embed/{id}` (not this route) so they skip the board sidebar layout.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { BoardFlow } from '@/components/board-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { ChatSidebar } from '@/components/chat-sidebar'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import { PreviewFocusProvider } from '@/lib/preview-focus-context'
import { AiEditSessionProvider } from '@/lib/ai/edit-session'
import { PageAccessProvider } from '@/lib/share/page-access-context'
import { redeemShareToken, resolvePageAccessRole } from '@/lib/share/server'
import { canEditPage } from '@/lib/share/roles'

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>
  searchParams: Promise<{ s?: string | string[] }>
}) {
  const { conversationId } = await params
  const sp = await searchParams
  const rawToken = Array.isArray(sp.s) ? sp.s[0] : sp.s

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Redeem share link before access check; always strip ?s= from the URL afterward
  if (rawToken) {
    const hdrs = await headers()
    const ip =
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      hdrs.get('x-real-ip') ||
      null
    const result = await redeemShareToken({
      pageId: conversationId,
      token: rawToken,
      user,
      ip,
    })
    // Strip token from address bar whether success or failure (prevent Referer/history leaks)
    if (result.ok) {
      redirect(`/board/${conversationId}`)
    }
    redirect('/board') // Uniform failure — do not reveal why
  }

  const role = await resolvePageAccessRole(supabase, conversationId)
  if (!role) {
    redirect('/board') // No access
  }

  // Confirm conversation is readable under new RLS (shared or owned)
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, title')
    .eq('id', conversationId)
    .maybeSingle()

  if (error || !conversation) {
    redirect('/board')
  }

  const editable = canEditPage(role) // edit | owner

  return (
    <EditorProvider>
      <ReactFlowContextProvider conversationId={conversationId}>
        <PreviewFocusProvider>
          <AiEditSessionProvider>
            <PageAccessProvider role={role} pageId={conversationId}>
              <div className="h-full flex">
                <div className="flex-1 relative min-w-0 h-full">
                  <BoardFlow conversationId={conversationId} />
                  {/* Top bar stays for all roles; write tools gate via PageAccess */}
                  <InputAreaWithStickyPrompt conversationId={conversationId} />
                </div>
                {/* AI sidebar is an edit surface — hide for view/comment */}
                {editable ? <ChatSidebar conversationId={conversationId} /> : null}
              </div>
            </PageAccessProvider>
          </AiEditSessionProvider>
        </PreviewFocusProvider>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}
