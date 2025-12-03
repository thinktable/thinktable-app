'use client'

// Context for sharing React Flow instance with components outside ReactFlowProvider
import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import { ReactFlowInstance } from 'reactflow'

interface ReactFlowContextType {
  reactFlowInstance: ReactFlowInstance | null
  setReactFlowInstance: (instance: ReactFlowInstance | null) => void
  getSetNodes: () => ((nodes: any) => void) | undefined // Getter for setNodes function (stored in ref)
  registerSetNodes: (setNodes: ((nodes: any) => void) | undefined) => void // Function to register setNodes from useNodesState
  isLocked: boolean // Global lock state
  setIsLocked: (locked: boolean) => void // Function to set lock state
  layoutMode: 'auto' | 'tree' | 'cluster' | 'none' // Layout mode state
  setLayoutMode: (mode: 'auto' | 'tree' | 'cluster' | 'none') => void // Function to set layout mode
  isDeterministicMapping: boolean // Deterministic mapping state (enabled when layoutMode is 'none')
  setIsDeterministicMapping: (enabled: boolean) => void // Function to set deterministic mapping state
  panelWidth: number // Panel width (matches prompt box width when zoom is 100%)
  setPanelWidth: (width: number) => void // Function to set panel width
  isPromptBoxCentered: boolean // Whether prompt box is centered (vs left-aligned)
  setIsPromptBoxCentered: (centered: boolean) => void // Function to set prompt box centered state
}

const ReactFlowContext = createContext<ReactFlowContextType | undefined>(undefined)

export function ReactFlowContextProvider({ children }: { children: ReactNode }) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const setNodesRef = useRef<((nodes: any) => void) | undefined>(undefined) // Use ref to avoid setState during render
  const [isLocked, setIsLocked] = useState(false) // Global lock state
  const [layoutMode, setLayoutMode] = useState<'auto' | 'tree' | 'cluster' | 'none'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-layout-mode') as 'auto' | 'tree' | 'cluster' | 'none' | null
      return saved === 'auto' || saved === 'tree' || saved === 'cluster' || saved === 'none' ? saved : 'auto'
    }
    return 'auto' // Auto, Tree, Cluster, or None (deterministic mapping) layout mode
  })
  const [isDeterministicMapping, setIsDeterministicMapping] = useState(() => {
    // Initialize from layoutMode - if 'none', deterministic mapping is disabled (no branching)
    // If 'auto', 'tree', or 'cluster', deterministic mapping is enabled (branching)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('thinkable-layout-mode') as 'auto' | 'tree' | 'cluster' | 'none' | null
      return saved !== 'none' && saved !== null // Enabled for auto/tree/cluster, disabled for none
    }
    return true // Default to enabled (auto mode)
  })
  const [panelWidth, setPanelWidth] = useState(768) // Default panel width (matches prompt box max width)
  const [isPromptBoxCentered, setIsPromptBoxCentered] = useState(false) // Whether prompt box is centered

  // Save layout mode to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('thinkable-layout-mode', layoutMode)
    }
  }, [layoutMode])

  // Sync deterministic mapping state with layoutMode
  // None = no branching (disabled), Auto/Tree/Cluster = branching (enabled)
  useEffect(() => {
    setIsDeterministicMapping(layoutMode !== 'none')
  }, [layoutMode])

  // Getter function to access the ref value
  const getSetNodes = useCallback(() => setNodesRef.current, [])
  
  // Registration function that updates the ref (doesn't trigger re-render)
  const registerSetNodes = useCallback((fn: ((nodes: any) => void) | undefined) => {
    setNodesRef.current = fn
  }, [])

  return (
    <ReactFlowContext.Provider value={{ reactFlowInstance, setReactFlowInstance, getSetNodes, registerSetNodes, isLocked, setIsLocked, layoutMode, setLayoutMode, isDeterministicMapping, setIsDeterministicMapping, panelWidth, setPanelWidth, isPromptBoxCentered, setIsPromptBoxCentered }}>
      {children}
    </ReactFlowContext.Provider>
  )
}

export function useReactFlowContext() {
  const context = useContext(ReactFlowContext)
  if (context === undefined) {
    // Return null values if context is not available (graceful degradation)
    return { reactFlowInstance: null, setReactFlowInstance: () => {}, getSetNodes: () => undefined, registerSetNodes: () => {}, isLocked: false, setIsLocked: () => {}, layoutMode: 'auto' as const, setLayoutMode: () => {}, isDeterministicMapping: false, setIsDeterministicMapping: () => {}, panelWidth: 768, setPanelWidth: () => {}, isPromptBoxCentered: false, setIsPromptBoxCentered: () => {} }
  }
  return context
}

