'use client'

// Undo/Redo hook for React Flow map actions
// Based on React Flow Pro example: https://reactflow.dev/examples/interaction/undo-redo
// Manages past/future state stacks for nodes and edges, enabling undo/redo of map changes

import { useCallback, useEffect, useState, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import type { Edge, Node } from 'reactflow' // Types only — Node is not a runtime export


// Configuration options for the undo/redo hook
type UseUndoRedoOptions = {
  maxHistorySize: number // Maximum number of snapshots to keep in history
  enableShortcuts: boolean // Whether to enable Ctrl+Z/Cmd+Shift+Z keyboard shortcuts
}

// Return type of the useUndoRedo hook
type UseUndoRedoReturn = {
  undo: () => void // Revert to previous state
  redo: () => void // Restore next state
  takeSnapshot: () => void // Capture current state before a change
  canUndo: boolean // Whether undo is possible
  canRedo: boolean // Whether redo is possible
}

// Snapshot of React Flow state at a point in time
type HistoryItem = {
  nodes: Node[] // All nodes at this point
  edges: Edge[] // All edges at this point
}

// Default configuration values
const defaultOptions: UseUndoRedoOptions = {
  maxHistorySize: 100, // Keep last 100 snapshots
  enableShortcuts: false, // Disable shortcuts by default (TipTap handles Ctrl+Z for editor)
}

// Hook implementation following Redux undo pattern:
// https://redux.js.org/usage/implementing-undo-history
export const useUndoRedo = ({
  maxHistorySize = defaultOptions.maxHistorySize,
  enableShortcuts = defaultOptions.enableShortcuts,
} = defaultOptions): UseUndoRedoReturn => {
  // Past states stack - undo pops from here
  const [past, setPast] = useState<HistoryItem[]>([])
  // Future states stack - redo pops from here
  const [future, setFuture] = useState<HistoryItem[]>([])

  // Get React Flow instance methods for state manipulation
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow()

  // Ref to track if we're in the middle of an undo/redo operation
  // Prevents taking snapshots during undo/redo which would corrupt history
  const isUndoRedoingRef = useRef(false)

  // Take a snapshot of current state before making changes
  // Call this BEFORE any action that modifies nodes/edges
  const takeSnapshot = useCallback(() => {
    // Don't take snapshots during undo/redo operations
    if (isUndoRedoingRef.current) return

    // Push current graph state to past stack
    setPast((past) => [
      // Keep only the last maxHistorySize - 1 items (to make room for new snapshot)
      ...past.slice(past.length - maxHistorySize + 1, past.length),
      { nodes: getNodes(), edges: getEdges() },
    ])

    // Clear future stack - new action invalidates redo history
    setFuture([])
  }, [getNodes, getEdges, maxHistorySize])

  // Undo: revert to previous state
  const undo = useCallback(() => {
    // Get the most recent past state
    const pastState = past[past.length - 1]

    if (pastState) {
      // Mark that we're undoing (prevents snapshot during state update)
      isUndoRedoingRef.current = true

      // Remove the state from past stack
      setPast((past) => past.slice(0, past.length - 1))

      // Save current state to future stack for redo
      setFuture((future) => [
        ...future,
        { nodes: getNodes(), edges: getEdges() },
      ])

      // Restore the past state
      setNodes(pastState.nodes)
      setEdges(pastState.edges)

      // Clear the undo/redo flag after state updates
      requestAnimationFrame(() => {
        isUndoRedoingRef.current = false
      })
    }
  }, [setNodes, setEdges, getNodes, getEdges, past])

  // Redo: restore next state
  const redo = useCallback(() => {
    // Get the most recent future state
    const futureState = future[future.length - 1]

    if (futureState) {
      // Mark that we're redoing (prevents snapshot during state update)
      isUndoRedoingRef.current = true

      // Remove the state from future stack
      setFuture((future) => future.slice(0, future.length - 1))

      // Save current state to past stack
      setPast((past) => [...past, { nodes: getNodes(), edges: getEdges() }])

      // Restore the future state
      setNodes(futureState.nodes)
      setEdges(futureState.edges)

      // Clear the undo/redo flag after state updates
      requestAnimationFrame(() => {
        isUndoRedoingRef.current = false
      })
    }
  }, [setNodes, setEdges, getNodes, getEdges, future])

  // Setup keyboard shortcuts if enabled
  // Note: Disabled by default since TipTap handles Ctrl+Z for editor content
  useEffect(() => {
    if (!enableShortcuts) return

    const keyDownHandler = (event: KeyboardEvent) => {
      // Check if focus is in an editor element (don't intercept TipTap shortcuts)
      const activeElement = document.activeElement
      const isInEditor = activeElement?.closest('.ProseMirror') !== null ||
        activeElement?.closest('[contenteditable="true"]') !== null ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA'

      if (isInEditor) return // Let TipTap handle it

      // Ctrl/Cmd + Shift + Z = Redo
      if (
        event.key?.toLowerCase() === 'z' &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey
      ) {
        event.preventDefault()
        redo()
      }
      // Ctrl/Cmd + Z = Undo
      else if (
        event.key?.toLowerCase() === 'z' &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault()
        undo()
      }
    }

    document.addEventListener('keydown', keyDownHandler)

    return () => {
      document.removeEventListener('keydown', keyDownHandler)
    }
  }, [undo, redo, enableShortcuts])

  return {
    undo,
    redo,
    takeSnapshot,
    canUndo: past.length > 0, // Fixed: original had inverted logic
    canRedo: future.length > 0, // Fixed: original had inverted logic
  }
}

export default useUndoRedo

