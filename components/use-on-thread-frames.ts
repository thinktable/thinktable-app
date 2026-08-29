'use client'

// Insert frames onto threads + drag them along the path.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Edge, Node, NodeChange } from 'reactflow'
import { createClient } from '@/lib/supabase/client'
import { generateUUID } from '@/lib/utils'
import { newBlockMetadata } from '@/lib/blocks'
import { absFlowPosition } from '@/components/use-block-group-drag'
import {
  readOnThread,
  findEdgeForOnThread,
  ON_THREAD_DEFAULT_SIZE,
  onThreadFrameVisualSize,
  onThreadPathSyncKey,
  persistOnThreadPlacement,
  detachOnThreadFrame,
  projectFrameOntoThreadPath,
  patchNodeOnThreadMeta,
  nodeWithOnThreadAnchor,
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
  const dragRef = useRef<{ nodeId: string; anchor: OnThreadMeta } | null>(null)
  const pathSyncKey = useMemo(() => onThreadPathSyncKey(edges, nodes), [edges, nodes])

  const patchMessageCaches = useCallback(
    (messageId: string, abs: { x: number; y: number }, anchor: OnThreadMeta) => {
      if (!conversationId) return
      const patch = (key: unknown[]) => {
        queryClient.setQueryData(key, (old: unknown) => {
          const list = Array.isArray(old) ? [...old] : []
          return list.map((m: { id?: string; metadata?: Record<string, unknown> }) =>
            m.id === messageId
              ? { ...m, metadata: { ...(m.metadata || {}), position: abs, onThread: anchor } }
              : m
          )
        })
      }
      patch(['messages-for-panels', conversationId])
      patch(['messages-for-panels', conversationId, 'full'])
      patch(['messages-for-panels', conversationId, 'embed'])
    },
    [conversationId, queryClient]
  )

  const commitOnThreadPlacement = useCallback(
    (nodeId: string, position: { x: number; y: number }, anchor: OnThreadMeta) => {
      const live = getNodes()
      const node = live.find((n) => n.id === nodeId)
      const msgId = node?.data?.promptMessage?.id as string | undefined
      if (!node || !msgId) return

      const existing = readOnThread(node.data?.promptMessage?.metadata as Record<string, unknown>)
      const abs = absFlowPosition({ ...node, position }, live)
      const posSame =
        Math.abs(node.position.x - position.x) < 0.5 &&
        Math.abs(node.position.y - position.y) < 0.5
      const metaSame =
        existing?.t === anchor.t &&
        (existing?.offset ?? 0) === (anchor.offset ?? 0) &&
        (existing?.normalX ?? 0) === (anchor.normalX ?? 0) &&
        (existing?.normalY ?? 0) === (anchor.normalY ?? 0)
      if (posSame && metaSame) return

      setNodes((nds) => {
        let changed = false
        const next = nds.map((n) => {
          if (n.id !== nodeId) return n
          changed = true
          return patchNodeOnThreadMeta({ ...n, position }, anchor, abs)
        })
        return changed ? next : nds
      })
      patchMessageCaches(msgId, abs, anchor)

      if (!conversationId) return
      void (async () => {
        try {
          const supabase = createClient()
          await persistOnThreadPlacement(supabase, {
            messageId: msgId,
            position: abs,
            onThread: anchor,
          })
        } catch (err) {
          console.error('Failed to persist on-thread frame placement:', err)
        }
      })()
    },
    [conversationId, getNodes, patchMessageCaches, setNodes]
  )

  /** Re-seat on-thread frames when endpoint frames move or the path bends — not on every nodes tick. */
  useEffect(() => {
    if (typeof document === 'undefined' || !pathSyncKey) return
    if (dragRef.current?.nodeId) return

    const live = getNodes()
    setNodes((nds) => {
      let changed = false
      const next = nds.map((n) => {
        if (n.type !== 'chatPanel') return n
        const anchor = readOnThread(n.data?.promptMessage?.metadata as Record<string, unknown>)
        if (!anchor) return n
        const edge = findEdgeForOnThread(edges, nds, anchor)
        if (!edge) return n
        const geom = geometryForEdge(edge, nds)
        if (!geom) return n
        const size = onThreadFrameVisualSize(n)
        const target = positionForOnThreadFrame(geom, anchor, size)
        if (
          Math.abs(n.position.x - target.x) < 0.5 &&
          Math.abs(n.position.y - target.y) < 0.5
        ) {
          return n
        }
        changed = true
        const abs = absFlowPosition({ ...n, position: target }, nds)
        return patchNodeOnThreadMeta({ ...n, position: target }, anchor, abs)
      })
      return changed ? next : nds
    })
  }, [pathSyncKey, edges, getNodes, setNodes])

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
      const itemPosition = positionForOnThreadFrame(geom, anchor, ON_THREAD_DEFAULT_SIZE)
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
    dragRef.current = { nodeId: node.id, anchor: { ...anchor } }
  }, [])

  /** Project position changes onto the thread — no setNodes here (RF applies the change). */
  const constrainOnThreadPositionChanges = useCallback(
    (changes: NodeChange[], currentNodes: Node[]): NodeChange[] => {
      return changes.map((change) => {
        if (change.type !== 'position' || !change.position) return change
        const node = currentNodes.find((n) => n.id === change.id)
        if (!node || node.type !== 'chatPanel') return change
        const liveNode =
          dragRef.current?.nodeId === change.id
            ? nodeWithOnThreadAnchor(node, dragRef.current.anchor)
            : node
        const projected = projectFrameOntoThreadPath(edges, currentNodes, liveNode, change.position)
        if (!projected) return change
        if (dragRef.current?.nodeId === change.id) {
          dragRef.current.anchor = projected.anchor
        }
        return { ...change, position: projected.position }
      })
    },
    [edges]
  )

  const onNodeDrag = useCallback((_event: unknown, node: Node) => {
    if (node.type !== 'chatPanel') return
    const session = dragRef.current
    if (!session || session.nodeId !== node.id) return
    const projected = projectFrameOntoThreadPath(
      edges,
      getNodes(),
      nodeWithOnThreadAnchor(node, session.anchor),
      node.position
    )
    if (projected) session.anchor = projected.anchor // Same object as dragRef.current, already narrowed non-null
  }, [edges, getNodes])

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      const session = dragRef.current
      if (!session || session.nodeId !== node.id) {
        dragRef.current = null
        return
      }

      const live = getNodes()
      const rfNode = live.find((n) => n.id === node.id)
      const current = rfNode ? { ...rfNode, position: node.position } : node
      const anchor = { ...session.anchor }
      const edge = findEdgeForOnThread(edges, live, anchor)
      const geom = edge ? geometryForEdge(edge, live) : null
      const size = onThreadFrameVisualSize(current)

      let position = node.position
      let finalAnchor = anchor
      if (geom) {
        position = positionForOnThreadFrame(geom, anchor, size)
        finalAnchor = anchor
      } else {
        const projected = projectFrameOntoThreadPath(edges, live, current, node.position)
        if (projected) {
          position = projected.position
          finalAnchor = projected.anchor
        }
      }

      commitOnThreadPlacement(node.id, position, finalAnchor)
      dragRef.current = null
    },
    [commitOnThreadPlacement, edges, getNodes]
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
    constrainOnThreadPositionChanges,
    detachFramesOnDeletedEdge,
    isOnThreadNode,
  }
}
