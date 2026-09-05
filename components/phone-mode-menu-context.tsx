'use client'

// Phone: mode dropdown + tools in the pill; undo/redo sit to its right, outside it
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type PhoneModeMenuContextValue = {
  toolsHost: HTMLElement | null // Portal target inside the pill, right of the mode dropdown
  setToolsHost: (el: HTMLElement | null) => void // Ref callback from the phone tools row
  undoHost: HTMLElement | null // Portal target to the right of the pill, outside its chrome
  setUndoHost: (el: HTMLElement | null) => void // Ref callback from the sibling undo cluster
  phoneTools: boolean // True when icon-only tools no longer fit after share compact — tools leave for the pill
  setPhoneTools: (next: boolean) => void // Set from the toolbar’s width measure
  shareCompact: boolean // True when copy/star/AI sparkles have left the bar for board More (before phoneTools)
  setShareCompact: (next: boolean) => void // Set from the toolbar’s width measure
}

const PhoneModeMenuContext = createContext<PhoneModeMenuContextValue>({
  toolsHost: null, // No portal host until phone tools mount
  setToolsHost: () => {}, // No-op outside the provider
  undoHost: null, // No undo sibling until tools have left the bar
  setUndoHost: () => {}, // No-op outside the provider
  phoneTools: false, // Desktop: tools stay in the top bar until icons no longer fit
  setPhoneTools: () => {}, // No-op outside the provider
  shareCompact: false, // Copy/star stay beside More until the bar needs them collapsed first
  setShareCompact: () => {}, // No-op outside the provider
})

export function PhoneModeMenuProvider({ children }: { children: ReactNode }) {
  const [toolsHost, setToolsHostState] = useState<HTMLElement | null>(null) // Live portal node
  const [undoHost, setUndoHostState] = useState<HTMLElement | null>(null) // Sibling of the pill for undo/redo
  const [phoneTools, setPhoneToolsState] = useState(false) // Toolbar overflow → pill (left-aligned)
  const [shareCompact, setShareCompactState] = useState(false) // Copy/star → board More before tools leave

  const setToolsHost = useCallback((el: HTMLElement | null) => {
    setToolsHostState(el) // Pill row mounts/unmounts the portal target
  }, [])

  const setUndoHost = useCallback((el: HTMLElement | null) => {
    setUndoHostState(el) // Sibling cluster mounts/unmounts with phoneTools
  }, [])

  const setPhoneTools = useCallback((next: boolean) => {
    setPhoneToolsState((prev) => (prev === next ? prev : next)) // Skip identical overflow decisions
    if (!next) {
      setToolsHostState(null) // Drop the portal host when tools return to the bar
      setUndoHostState(null) // Undo/redo return to the top bar
    }
  }, [])

  const setShareCompact = useCallback((next: boolean) => {
    setShareCompactState((prev) => (prev === next ? prev : next)) // Skip identical compact decisions
  }, [])

  const value = useMemo(
    () => ({
      toolsHost,
      setToolsHost,
      undoHost,
      setUndoHost,
      phoneTools,
      setPhoneTools,
      shareCompact,
      setShareCompact,
    }),
    [toolsHost, setToolsHost, undoHost, setUndoHost, phoneTools, setPhoneTools, shareCompact, setShareCompact]
  )

  return <PhoneModeMenuContext.Provider value={value}>{children}</PhoneModeMenuContext.Provider>
}

export function usePhoneModeMenu() {
  return useContext(PhoneModeMenuContext) // Toolbar portals tools inside the pill and undo/redo to its right
}
