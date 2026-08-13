/** Shared long-press → context-menu helper for phone (touch/pen). */

export const LONG_PRESS_MS = 450 // Hold duration before opening a menu
export const LONG_PRESS_MOVE_PX = 10 // Cancel if finger drifts (pan / drag)

export type LongPressPoint = { clientX: number; clientY: number }

export type LongPressControllerOptions = {
  delayMs?: number // Defaults to LONG_PRESS_MS
  moveThresholdPx?: number // Defaults to LONG_PRESS_MOVE_PX
  /** Which pointer types arm long-press (mouse keeps right-click). */
  pointerTypes?: ReadonlyArray<string>
  onLongPress: (
    point: LongPressPoint,
    meta: { event: PointerEvent; target: EventTarget | null }
  ) => boolean | void // Return false if the press was ignored (e.g. text selection)
}

/**
 * Imperative long-press controller for pointer events.
 * Wire pointerdown/move/up/cancel; call consumeFired() in click handlers to skip I-bar / select.
 */
export function createLongPressController(options: LongPressControllerOptions) {
  const delayMs = options.delayMs ?? LONG_PRESS_MS
  const moveThresholdPx = options.moveThresholdPx ?? LONG_PRESS_MOVE_PX
  const pointerTypes = options.pointerTypes ?? (['touch', 'pen'] as const)

  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let startTarget: EventTarget | null = null
  let pointerId: number | null = null
  let fired = false // Long-press opened a menu for this gesture
  let armed = false // Timer running — suppress marquee / browser selection
  const activePointers = new Set<number>() // Multi-touch (pinch) cancels long-press

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    armed = false
  }

  const cancelArmed = () => {
    clearTimer()
    pointerId = null
    startTarget = null
  }

  const pointerDown = (event: PointerEvent) => {
    if (!pointerTypes.includes(event.pointerType)) return
    if (event.button !== 0 && event.button !== -1) return // Primary only (-1 on some touch paths)

    activePointers.add(event.pointerId)
    if (activePointers.size > 1) {
      cancelArmed() // Pinch / two-finger pan — never open a menu
      return
    }

    cancelArmed()
    fired = false
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    startTarget = event.target
    armed = true
    timer = setTimeout(() => {
      timer = null
      armed = false
      // Haptic when available (iOS Safari may no-op)
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(10)
        }
      } catch {
        // Ignore vibrate failures
      }
      const handled = options.onLongPress(
        { clientX: startX, clientY: startY },
        { event, target: startTarget }
      )
      // Only suppress the following click when a menu actually opened
      fired = handled !== false
    }, delayMs)
  }

  const pointerMove = (event: PointerEvent) => {
    if (pointerId == null || event.pointerId !== pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (dx * dx + dy * dy > moveThresholdPx * moveThresholdPx) {
      cancelArmed() // User is panning / dragging — not a long-press
    }
  }

  const pointerUp = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (pointerId == null || event.pointerId !== pointerId) return
    clearTimer()
    pointerId = null
  }

  const pointerCancel = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (pointerId == null || event.pointerId !== pointerId) return
    cancelArmed()
  }

  const cancel = () => {
    cancelArmed()
    activePointers.clear()
  }

  /** Returns true once after a long-press fired (call from click handlers to suppress). */
  const consumeFired = () => {
    if (!fired) return false
    fired = false
    return true
  }

  /** True while a long-press menu was opened and click has not been consumed yet. */
  const didFire = () => fired

  /** True while the hold timer is running (before menu open / cancel). */
  const isArmed = () => armed

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    cancel,
    consumeFired,
    didFire,
    isArmed,
  }
}

export type LongPressController = ReturnType<typeof createLongPressController>
