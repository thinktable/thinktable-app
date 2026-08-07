'use client'

// In-place page preview — embeds a child board inside a titled item on the parent map.

import dynamic from 'next/dynamic' // Avoid circular import with board-flow → chat-panel-node
import { X } from 'lucide-react' // Collapse preview
import { EditorProvider } from '@/components/editor-context' // Nested editors need their own provider
import { ReactFlowContextProvider } from '@/components/react-flow-context' // Child map’s style/state
import { BoardEmbedProvider } from '@/lib/board-embed-context' // Tell nested UI it is embedded

const BoardFlow = dynamic(
  () => import('@/components/board-flow').then((m) => ({ default: m.BoardFlow })),
  {
    ssr: false, // React Flow is client-only
    loading: () => (
      <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">
        Loading page…
      </div>
    ),
  }
)

type NestedBoardPreviewProps = {
  conversationId: string // Linked page’s map id
  title: string // Page title for the preview chrome
  onClose: () => void // Collapse back to the item card
}

export function NestedBoardPreview({ conversationId, title, onClose }: NestedBoardPreviewProps) {
  return (
    <div
      className="nodrag nopan nowheel mt-2 w-full rounded-xl border border-gray-200 dark:border-[#2f2f2f] overflow-hidden bg-gray-50 dark:bg-[#0f0f0f] flex flex-col"
      style={{ height: 360, minWidth: 320 }} // Fixed preview window inside the item
      onMouseDown={(e) => e.stopPropagation()} // Keep parent item from starting a drag
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Preview chrome — page-within-page header */}
      <div className="flex items-center justify-between h-8 px-2 border-b border-gray-200 dark:border-[#2f2f2f] bg-white/80 dark:bg-[#1f1f1f]/80 shrink-0">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
          {title || 'Page'}
        </span>
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
          title="Close preview"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Nested board — own providers so parent map context is not polluted */}
      <div className="flex-1 min-h-0 relative">
        <BoardEmbedProvider embedded>
          <EditorProvider>
            <ReactFlowContextProvider conversationId={conversationId}>
              <BoardFlow conversationId={conversationId} embedded />
            </ReactFlowContextProvider>
          </EditorProvider>
        </BoardEmbedProvider>
      </div>
    </div>
  )
}
