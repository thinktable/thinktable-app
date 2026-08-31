'use client'

import { createContext, useContext, useMemo } from 'react'

type PhoneFrameDragContextValue = {
  manualDragNodeId: string | null // Unselected phone hold-drag (blue move border)
}

const PhoneFrameDragContext = createContext<PhoneFrameDragContextValue>({
  manualDragNodeId: null,
})

export function PhoneFrameDragProvider({
  manualDragNodeId,
  children,
}: {
  manualDragNodeId: string | null
  children: React.ReactNode
}) {
  // A fresh object here re-rendered every frame on the board, because this provider wraps all of
  // BoardFlow and `memo` cannot stop a context update. Frame measurement alone re-renders the board
  // ~14 times during a pan (RF `dimensions` changes), which was 560 ChatPanelNode renders per pan
  // with nothing selected — the memo comparator reported no prop change for a single one of them.
  const value = useMemo(() => ({ manualDragNodeId }), [manualDragNodeId])
  return (
    <PhoneFrameDragContext.Provider value={value}>{children}</PhoneFrameDragContext.Provider>
  )
}

export function usePhoneFrameDrag() {
  return useContext(PhoneFrameDragContext)
}
