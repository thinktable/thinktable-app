'use client'

// Insert frames onto threads + drag them along the path.

import { useCallback, useEffect, useRef } from 'react'
import type { Edge, Node } from 'reactflow'
import { createClient } from '@/lib/supabase/client'
import { generateUUID } from '@/lib/utils'
import { newBlockMetadata } from '@/lib/blocks'
import { absFlowPosition, nodeFlowSize } from '@/components/use-block-group-drag'
import {
  readOnThread,
  findEdgeForOnThread,
  ON_THREAD_DEFAULT_SIZE,
  persistOnThreadPlacement,
  detachOnThreadFrame,
  type OnThreadMeta,
} from '@/lib/threads/on-thread-frame'
import {
  geometryForEdge,
  positionForOnThreadFrame,
} from '@/lib/threads/thread-path-geometry'

type UseOnThreadFramesOpts = {
  conversationId: string | null | undefined
  edges: Edge[]
  nodes: Node[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  getEdge: (id: string) => Edge | undefined
  getNodes: () => Node[]
  queryClient: {
    setQueryData: (key: unknown[], updater: (old: unknown) => unknown) => void
  }
  takeSnapshot: () => void
}

export function useOnThreadFrames({
  conversationId,
  edges,
  nodes,
  setNodes,
  getEdge,
  getNodes,
  queryClient,
  takeSnapshot,
}: UseOnThreadFramesOpts) {
  const dragRef = useRef<{ nodeId: string; t: number; anchor: OnThreadMeta } | null>(null)

  /** Keep on-thread frames glued to the path when endpoints or bends change. */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const draggingId = dragRef.current?.nodeId
    const live = nodes
    const updates: Array<{ id: string; position: { x: number; y: number } }> = []

    for (const node of live) {
      if (node.type !== 'chatPanel') continue
      if (draggingId && node.id === draggingId) continue
      const anchor = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
      if (!anchor) continue
      const edge = findEdgeForOnThread(edges, live, anchor)
      if (!edge) continue
      const geom = geometryForEdge(edge, live)
      if (!geom) continue
      const size = nodeFlowSize(node)
      const next = positionForOnThreadFrame(geom, anchor, size)
      const cur = node.position
      if (Math.abs(cur.x - next.x) > 0.5 || Math.abs(cur.y - next.y) > 0.5) {
        updates.push({ id: node.id, position: next })
      }
    }

    if (updates.length === 0) return
    setNodes((nds) =>
      nds.map((n) => {
        const hit = updates.find((u) => u.id === n.id)
        return hit ? { ...n, position: hit.position } : n
      })
    )
  }, [edges, nodes, setNodes])

  const insertFrameOnThread = useCallback(
    async (edgeId: string) => {
      const edge = getEdge(edgeId)
      if (!edge || !conversationId) return
      const live = getNodes()
      const sourceNode = live.find((n) => n.id === edge.source)
      const targetNode = live.find((n) => n.id === edge.target)
      const sourceMsgId = sourceNode?.data?.promptMessage?.id as string | undefined
      const targetMsgId = targetNode?.data?.promptMessage?.id as string | undefined
      if (!sourceNode || !targetNode || !sourceMsgId || !targetMsgId) return

      const geom = geometryForEdge(edge, live)
      if (!geom) return

      takeSnapshot()

      const t = 0.5
      const anchor: OnThreadMeta = { sourceMessageId: sourceMsgId, targetMessageId: targetMsgId, t }
      const size = ON_THREAD_DEFAULT_SIZE
      const itemPosition = positionForOnThreadFrame(geom, anchor, size)
      const messageId = generateUUID()
      const html = '<p></p>'

      const optimisticMessage = {
        id: messageId,
        role: 'user' as const,
        content: html,
        created_at: new Date().toISOString(),
        metadata: newBlockMetadata({
          position: itemPosition,
          fadeIn: true,
          onThread: anchor,
        }),
      }

      const panelId = `panel-${messageId}`
      setNodes((nds) => [
        ...nds.map((n) => ({ ...n, selected: false })),
        {
          id: panelId,
          type: 'chatPanel',
          position: itemPosition,
          selected: true,
          data: {
            promptMessage: optimisticMessage,
            responseMessage: undefined,
            conversationId,
            isResponseCollapsed: false,
          },
        },
      ])

      const patch = (key: unknown[]) => {
        queryClient.setQueryData(key, (old: unknown) => {
          const list = Array.isArray(old) ? old : []
          if (list.some((m: { id?: string }) => m.id === messageId)) return list
          return [...list, optimisticMessage]
        })
      }
      patch(['messages-for-panels', conversationId])
      patch(['messages-for-panels', conversationId, 'full'])
      patch(['messages-for-panels', conversationId, 'embed'])

      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { error } = await supabase.from('messages').insert({
          id: messageId,
          conversation_id: conversationId,
          user_id: user.id,
          role: 'user',
          content: html,
          metadata: optimisticMessage.metadata,
        })
        if (error) console.error('Failed to insert on-thread frame:', error)
      } catch (err) {
        console.error('Failed to insert on-thread frame:', err)
      }
    },
    [conversationId, getEdge, getNodes, queryClient, setNodes, takeSnapshot]
  )

  const onNodeDragStart = useCallback((_event: unknown, node: Node) => {
    if (node.type !== 'chatPanel') return
    const anchor = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
    if (!anchor) return
    dragRef.current = { nodeId: node.id, t: anchor.t, anchor: { ...anchor } }
  }, [])

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type !== 'chatPanel') return
      const session = dragRef.current
      if (!session || session.nodeId !== node.id) return

      const live = getNodes()
      const edge = findEdgeForOnThread(edges, live, session.anchor)
      if (!edge) return
      const geom = geometryForEdge(edge, live)
      if (!geom) return

      const size = nodeFlowSize(node)
      const centerX = node.position.x + size.width / 2
      const centerY = node.position.y + size.height / 2
      const projected = geom.closestT(centerX, centerY)
      session.t = projected.t
      session.anchor = { ...session.anchor, t: projected.t }

      const nextPos = positionForOnThreadFrame(geom, session.anchor, size)
      const cur = node.position
      if (Math.abs(cur.x - nextPos.x) > 0.25 || Math.abs(cur.y - nextPos.y) > 0.25) {
        setNodes((nds) =>
          nds.map((n) => (n.id === node.id ? { ...n, position: nextPos } : n))
        )
      }
    },
    [edges, getNodes, setNodes]
  )

  const onNodeDragStop = useCallback(
    async (_event: unknown, node: Node) => {
      const session = dragRef.current
      dragRef.current = null
      if (!session || session.nodeId !== node.id || !conversationId) return

      const live = getNodes()
      const msgId = node.data?.promptMessage?.id as string | undefined
      if (!msgId) return

      const anchor: OnThreadMeta = { ...session.anchor, t: session.t }
      const abs = absFlowPosition(live.find((n) => n.id === node.id) || node, live)

      try {
        const supabase = createClient()
        await persistOnThreadPlacement(supabase, {
          messageId: msgId,
          position: abs,
          onThread: anchor,
        })
        queryClient.setQueryData(['messages-for-panels', conversationId], (old: unknown) => {
          const list = Array.isArray(old) ? [...old] : []
          return list.map((m: { id?: string; metadata?: Record<string, unknown> }) =>
            m.id === msgId
              ? { ...m, metadata: { ...(m.metadata || {}), position: abs, onThread: anchor } }
              : m
          )
        })
      } catch (err) {
        console.error('Failed to persist on-thread frame drag:', err)
      }
    },
    [conversationId, getNodes, queryClient]
  )

  const detachFramesOnDeletedEdge = useCallback(
    async (sourceMessageId: string, targetMessageId: string) => {
      if (!conversationId) return
      const live = getNodes()
      const supabase = createClient()
      for (const node of live) {
        if (node.type !== 'chatPanel') continue
        const anchor = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
        if (!anchor) continue
        if (
          anchor.sourceMessageId !== sourceMessageId ||
          anchor.targetMessageId !== targetMessageId
        ) {
          continue
        }
        const msgId = node.data?.promptMessage?.id as string | undefined
        if (!msgId) continue
        const abs = absFlowPosition(node, live)
        await detachOnThreadFrame(supabase, msgId, abs)
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== node.id) return n
            const meta = { ...(n.data?.promptMessage?.metadata as Record<string, unknown>) }
            delete meta.onThread
            return {
              ...n,
              data: {
                ...n.data,
                promptMessage: {
                  ...n.data.promptMessage,
                  metadata: { ...meta, position: abs },
                },
              },
            }
          })
        )
      }
    },
    [conversationId, getNodes, setNodes]
  )

  const isOnThreadNode = useCallback((node: Node) => {
    return Boolean(readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>))
  }, [])

  return {
    insertFrameOnThread,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    detachFramesOnDeletedEdge,
    isOnThreadNode,
  }
}
