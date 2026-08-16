'use client'

// RF node: layout-cached frame shell while board messages are still fetching.
// Position/size come from the last visit’s localStorage layout — not a centered fake stub.

import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { FrameContentShimmer } from '@/components/frame-content-shimmer'

export type FrameShimmerNodeData = {
  width?: number
  height?: number
  hasText?: boolean // Text lines when true; solid frame when empty / spaces-only
  barCount?: number
}

function FrameShimmerNodeInner({ data }: NodeProps<FrameShimmerNodeData>) {
  const width = data?.width && data.width > 0 ? data.width : 220 // Exact cached RF box — don’t inflate
  const height = data?.height && data.height > 0 ? data.height : 72
  const hasText = !!data?.hasText

  return (
    <div
      className="pointer-events-none select-none overflow-hidden"
      style={{ width, height }}
      aria-busy="true"
      aria-label="Loading frame"
    >
      <FrameContentShimmer
        hasText={hasText}
        barCount={data?.barCount || 2}
        withGutter={false} // Left inset lives in matchFramePad (padX/Y; ⋮⋮ outside fill)
        matchFramePad={hasText} // Same BLOCK_FRAME_PAD_X/Y as the real frame contentFit
        className="h-full w-full"
      />
    </div>
  )
}

export const FrameShimmerNode = memo(FrameShimmerNodeInner)
