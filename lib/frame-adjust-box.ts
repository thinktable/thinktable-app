// Upright adjust-box geometry for snap / stack (blue selection chrome).
// Snap + stack lines live in the gap between adjust boxes, not the inner fill.

import type { Node } from 'reactflow'
import { frameScreenChromeScale } from '@/components/threads/constants'
import { absFlowPosition, nodeFlowSize } from '@/components/use-block-group-drag'

export const BLOCK_HANDLE_GUTTER_W = 24 // TipTap ⋮⋮ column inside the blue strip
export const ADJUST_CONTENT_GAP_X = 1 // L/R air beyond the handle column
export const ADJUST_CONTENT_GAP_Y = 6 // T/B band air
export const CONNECTIONS_GROUP_H = 28 // Connections strip height

export type FlowBox = { x: number; y: number; width: number; height: number }
export type AdjustChromeInsets = { x: number; yTop: number; yBottom: number }

function nodeMeta(n: Node): Record<string, unknown> {
  return (n.data?.promptMessage?.metadata || {}) as Record<string, unknown>
}

/** Nominal adjust-box chrome (flow px) — matches selected-frame blue box insets. */
export function nominalAdjustChromeInsets(
  _meta: Record<string, unknown>,
  zoom: number
): AdjustChromeInsets {
  const scale = frameScreenChromeScale(Math.max(0.01, zoom))
  const x = Math.round((BLOCK_HANDLE_GUTTER_W + ADJUST_CONTENT_GAP_X) * scale)
  // Property + connections strips live inside the fill, so the blue box only insets L/R.
  return { x, yTop: 0, yBottom: 0 }
}

/** Adjust-box width/height in flow px (selected RF outer box already includes chrome). */
export function frameAdjustFlowSize(
  node: Node,
  zoom: number
): { width: number; height: number } {
  const size = nodeFlowSize(node)
  if (node.selected) return size
  const chrome = nominalAdjustChromeInsets(nodeMeta(node), zoom)
  return {
    width: size.width + chrome.x * 2,
    height: size.height + chrome.yTop + chrome.yBottom,
  }
}

/** Upright adjust-box in absolute flow space. */
export function frameAdjustFlowBox(node: Node, live: Node[], zoom: number): FlowBox {
  const abs = absFlowPosition(node, live)
  const size = nodeFlowSize(node)
  if (node.selected) {
    return { x: abs.x, y: abs.y, width: size.width, height: size.height }
  }
  const chrome = nominalAdjustChromeInsets(nodeMeta(node), zoom)
  return {
    x: abs.x - chrome.x,
    y: abs.y - chrome.yTop,
    width: size.width + chrome.x * 2,
    height: size.height + chrome.yTop + chrome.yBottom,
  }
}

/** RF absolute top-left from an adjust-box top-left. */
export function rfAbsFromAdjustOrigin(
  adjustOrigin: { x: number; y: number },
  node: Node,
  zoom: number
): { x: number; y: number } {
  if (node.selected) return adjustOrigin
  const chrome = nominalAdjustChromeInsets(nodeMeta(node), zoom)
  return { x: adjustOrigin.x + chrome.x, y: adjustOrigin.y + chrome.yTop }
}

/** Adjust box when the frame already sits at absolute flow `abs`. */
export function frameAdjustFlowBoxAt(
  node: Node,
  abs: { x: number; y: number },
  zoom: number
): FlowBox {
  const size = nodeFlowSize(node)
  if (node.selected) {
    return { x: abs.x, y: abs.y, width: size.width, height: size.height }
  }
  const chrome = nominalAdjustChromeInsets(nodeMeta(node), zoom)
  return {
    x: abs.x - chrome.x,
    y: abs.y - chrome.yTop,
    width: size.width + chrome.x * 2,
    height: size.height + chrome.yTop + chrome.yBottom,
  }
}

/** Screen rect of the upright adjust box (stack line portal). */
export function frameAdjustScreenRect(
  nodeId: string,
  node: Node | undefined,
  zoom: number
): DOMRect | null {
  const el = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
  ) as HTMLElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (!node || node.selected) return rect
  const chrome = nominalAdjustChromeInsets(nodeMeta(node), zoom)
  const expandX = chrome.x * zoom
  const expandYTop = chrome.yTop * zoom
  const expandYBottom = chrome.yBottom * zoom
  return new DOMRect(
    rect.left - expandX,
    rect.top - expandYTop,
    rect.width + 2 * expandX,
    rect.height + expandYTop + expandYBottom
  )
}
