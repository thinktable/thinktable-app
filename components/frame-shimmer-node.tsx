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
  const width = Math.max(120, data?.width || 220) // Prefer cached measure; else a typical empty-frame width
  const height = Math.max(40, data?.height || 72) // Prefer cached measure; else ~empty frame height
  const hasText = !!data?.hasText

  return (
    <div
      className="pointer-events-none select-none"
      style={{ width, height }}
      aria-busy="true"
      aria-label="Loading frame"
    >
      <FrameContentShimmer
        hasText={hasText}
        barCount={data?.barCount || 2}
        withGutter={hasText} // Match TipTap block gutter when showing text lines
        className="h-full w-full"
      />
    </div>
  )
}

export const FrameShimmerNode = memo(FrameShimmerNodeInner)
