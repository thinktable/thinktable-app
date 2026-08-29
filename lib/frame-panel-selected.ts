// Host-frame RF selection for TipTap NodeViews (they miss React `selected`).
// DOM attrs / isEditable lagged and left full Notion tables up after deselect.

import { useSyncExternalStore } from 'react'

const selectedIds = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

/** Publish whether this frame is RF-selected (node id and/or message id). */
export function setFramePanelSelected(id: string | undefined | null, selected: boolean): void {
  if (!id) return
  const had = selectedIds.has(id)
  if (selected === had) return
  if (selected) selectedIds.add(id)
  else selectedIds.delete(id)
  notify()
}

export function isFramePanelSelected(id: string | undefined | null): boolean {
  return !!id && selectedIds.has(id)
}

export function subscribeFramePanelSelected(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when any of the host ids is in the selected set. */
export function useFramePanelSelected(ids: Array<string | null | undefined>): boolean {
  return useSyncExternalStore(
    subscribeFramePanelSelected,
    () => ids.some((id) => isFramePanelSelected(id)),
    () => false
  )
}
