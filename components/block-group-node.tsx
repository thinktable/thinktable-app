'use client'

// Visual group frame — sibling of child cards (no RF parentId). Drag the frame to move the group;
// ⋮⋮ / card drag moves only that block. Membership is metadata.blockGroupId.

import { memo } from 'react' // Stable node type for React Flow
import { NodeProps } from 'reactflow' // RF node props
import { cn } from '@/lib/utils' // Class merge

export type BlockGroupNodeData = {
  conversationId?: string // Owning map (for future group actions)
  label?: string // Optional group label
}

function BlockGroupNodeComponent({ selected, data }: NodeProps<BlockGroupNodeData>) {
  return (
    <div
      data-block-group="true" // Marks group frame for menus / hit-testing
      className={cn(
        'rounded-2xl border-2 border-dashed w-full h-full pointer-events-auto cursor-grab active:cursor-grabbing', // Visible frame; padding ring is the grab target (children sit above)
        selected
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50/30 dark:bg-blue-950/20'
          : 'border-gray-300 dark:border-[#3a3a3a] bg-gray-50/40 dark:bg-[#1a1a1a]/40'
      )}
      style={{ minWidth: 120, minHeight: 80 }}
      title={data?.label || 'Block group'}
    />
  )
}

export const BlockGroupNode = memo(BlockGroupNodeComponent) // RF requires stable node types
