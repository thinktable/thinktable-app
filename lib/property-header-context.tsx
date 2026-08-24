'use client'

// Host frame paints empty property icons; the first title boardLink renders them under the card name.

import { createContext, useContext, type ReactNode } from 'react'

const PropertyHeaderSlotContext = createContext<ReactNode>(null)

export const PropertyHeaderSlotProvider = PropertyHeaderSlotContext.Provider

/** Empty property strip slot — only mounted on the first title boardLink in the frame. */
export function usePropertyHeaderSlot(): ReactNode {
  return useContext(PropertyHeaderSlotContext)
}
