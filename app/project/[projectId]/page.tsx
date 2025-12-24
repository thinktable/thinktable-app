// Project page - shows React Flow map with board panels
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProjectFlow } from '@/components/project-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify project exists and belongs to user
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, name, user_id')
    .eq('id', projectId)
    .single()

  if (error || !project || project.user_id !== user.id) {
    redirect('/board')
  }

  return (
    <EditorProvider>
      <ReactFlowContextProvider projectId={projectId}>
        <div className="h-full relative">
          {/* React Flow project map */}
          <ProjectFlow projectId={projectId} />
          
          {/* Input box overlay at bottom with sticky prompt panel */}
          <InputAreaWithStickyPrompt projectId={projectId} />
        </div>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}

