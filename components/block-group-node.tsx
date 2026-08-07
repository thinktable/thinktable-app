'use client'

// Visual container for grouped map blocks — no editor; children are RF parented nodes.
// No ⋮⋮ handle on the frame — the container itself is the group affordance (multi-action later).

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
        'rounded-2xl border-2 border-dashed pointer-events-auto', // Frame only; children own ⋮⋮ handles
        selected
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50/30 dark:bg-blue-950/20'
          : 'border-gray-300 dark:border-[#3a3a3a] bg-gray-50/40 dark:bg-[#1a1a1a]/40'
      )}
      style={{
        width: '100%', // RF node width from style/dimensions
        height: '100%', // RF node height from style/dimensions
        minWidth: 120, // Usable empty group
        minHeight: 80,
      }}
      title={data?.label || 'Block group'}
    />
  )
}

export const BlockGroupNode = memo(BlockGroupNodeComponent) // RF requires stable node types
