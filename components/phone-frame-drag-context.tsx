'use client'

import { createContext, useContext } from 'react'

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
  return (
    <PhoneFrameDragContext.Provider value={{ manualDragNodeId }}>
      {children}
    </PhoneFrameDragContext.Provider>
  )
}

export function usePhoneFrameDrag() {
  return useContext(PhoneFrameDragContext)
}
