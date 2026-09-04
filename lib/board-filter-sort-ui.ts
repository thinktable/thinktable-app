// Board Filter / Sort strip UI state — open under the top bar (above the mode pill).
// Filter and Sort toggle independently; the strip is visible when either is on.

export type BoardFilterSortFocus = 'filter' | 'sort' // Which Actions glyph was last pressed

export type BoardFilterSortUi = {
  openFilter: boolean // Filter side of the criteria strip
  openSort: boolean // Sort side — Sort pill only when true
  focus: BoardFilterSortFocus // Pressed highlight on the toolbar glyph
  open: boolean // openFilter || openSort — strip mounts when true
}

// Cached snapshot — useSyncExternalStore requires getSnapshot to return the same ref until a change
let snapshot: BoardFilterSortUi = {
  openFilter: false,
  openSort: false,
  focus: 'filter',
  open: false,
}
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function publish(next: Omit<BoardFilterSortUi, 'open'>) {
  const open = next.openFilter || next.openSort
  if (
    snapshot.openFilter === next.openFilter &&
    snapshot.openSort === next.openSort &&
    snapshot.focus === next.focus &&
    snapshot.open === open
  ) {
    return // No change — keep the cached snapshot ref
  }
  snapshot = { ...next, open } // New object only when state actually changes
  notify()
}

export function subscribeBoardFilterSortUi(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getBoardFilterSortUi(): BoardFilterSortUi {
  return snapshot // Stable ref between publishes
}

/** Close both sides (e.g. leave Actions mode). */
export function setBoardFilterSortOpen(open: boolean) {
  if (!open) {
    publish({ openFilter: false, openSort: false, focus: snapshot.focus })
    return
  }
  // Opening without a side — arm Filter by default
  if (snapshot.openFilter || snapshot.openSort) return
  publish({ openFilter: true, openSort: false, focus: 'filter' })
}

/** Click Filter or Sort: toggle that side only; strip hides when both are off. */
export function toggleBoardFilterSort(focus: BoardFilterSortFocus) {
  if (focus === 'filter') {
    publish({
      openFilter: !snapshot.openFilter,
      openSort: snapshot.openSort,
      focus: 'filter',
    })
  } else {
    publish({
      openFilter: snapshot.openFilter,
      openSort: !snapshot.openSort,
      focus: 'sort',
    })
  }
}
