// Study set page - shows React Flow map with flashcards from study set
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudySetFlow } from '@/components/study-set-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'

export default async function StudySetPage({
  params,
}: {
  params: Promise<{ studySetId: string }>
}) {
  const { studySetId } = await params
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify study set exists and belongs to user
  const { data: profile } = await supabase
    .from('profiles')
    .select('metadata')
    .eq('id', user.id)
    .single()

  if (!profile?.metadata) {
    redirect('/board')
  }

  const studySets = (profile.metadata as Record<string, any>)?.studySets || []
  const studySet = studySets.find((set: { id: string; name: string }) => set.id === studySetId)

  if (!studySet) {
    redirect('/board')
  }

  return (
    <EditorProvider>
      <ReactFlowContextProvider>
        <div className="h-full relative">
          {/* React Flow board with flashcards from study set */}
          <StudySetFlow studySetId={studySetId} />
          
          {/* Input box overlay at bottom with sticky prompt panel */}
          <InputAreaWithStickyPrompt />
        </div>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}
