'use client'

// Default board page - same as regular board page but with welcome text overlay
import { BoardFlow } from '@/components/board-flow'
import { InputAreaWithStickyPrompt } from '@/components/input-area-with-sticky-prompt'
import { EditorProvider } from '@/components/editor-context'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { useState, useEffect } from 'react'

const WelcomeText = dynamic(() => import('@/components/welcome-text-overlay').then(mod => mod.WelcomeText), {
  ssr: false,
})

export default function BoardPage() {
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)

  // Listen for conversation creation events from ChatInput
  useEffect(() => {
    const handleConversationCreated = (e: Event) => {
      const customEvent = e as CustomEvent<{ conversationId: string }>
      if (customEvent.detail?.conversationId) {
        console.log('🔄 BoardPage: conversation-created event received, updating conversationId:', customEvent.detail.conversationId)
        // Update state immediately to enable the query
        setConversationId(customEvent.detail.conversationId)
      }
    }

    window.addEventListener('conversation-created', handleConversationCreated as EventListener)

    return () => {
      window.removeEventListener('conversation-created', handleConversationCreated as EventListener)
    }
  }, [])

  // Also listen for URL changes (when router.replace updates the URL)
  useEffect(() => {
    const handleUrlChange = () => {
      const pathMatch = window.location.pathname.match(/^\/board\/([^/]+)$/)
      if (pathMatch && pathMatch[1] !== conversationId) {
        setConversationId(pathMatch[1])
      }
    }

    // Check immediately
    handleUrlChange()

    // Listen for popstate (back/forward) and pushstate/replacestate
    window.addEventListener('popstate', handleUrlChange)
    const originalReplaceState = window.history.replaceState
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(window.history, args)
      handleUrlChange()
    }

    return () => {
      window.removeEventListener('popstate', handleUrlChange)
      window.history.replaceState = originalReplaceState
    }
  }, [conversationId])

  return (
    <EditorProvider>
      <ReactFlowContextProvider conversationId={conversationId}>
        <div className="h-full relative">
          {/* React Flow board */}
          <BoardFlow conversationId={conversationId} />

          {/* Welcome text overlay - disappears when first panel is placed */}
          <Suspense fallback={null}>
            <WelcomeText />
          </Suspense>

          {/* Input box overlay at bottom with sticky prompt panel */}
          <InputAreaWithStickyPrompt conversationId={conversationId} />
        </div>
      </ReactFlowContextProvider>
    </EditorProvider>
  )
}
