/**
 * Forward a pointerdown from a connection **indicator** (outer blue dot) onto the
 * invisible edge-anchor Handle (connection **point**) so RF starts a thread from the frame edge.
 */
export function forwardConnectStartToHandle(
  e: React.PointerEvent | React.MouseEvent,
  side: 'left' | 'right' | 'top' | 'bottom'
) {
  e.preventDefault() // Don't select/drag the frame
  e.stopPropagation()

  const nodeEl = (e.currentTarget as HTMLElement).closest('.react-flow__node') // Host frame/shape
  if (!nodeEl) return

  // Connection point = RF source handle on this side (geometry lives on the frame edge)
  const handle =
    (nodeEl.querySelector(
      `.react-flow__handle.tt-connection-point.react-flow__handle-source[data-handleid="${side}"]`
    ) as HTMLElement | null) ||
    (nodeEl.querySelector(
      `.react-flow__handle-source[data-handleid="${side}"]`
    ) as HTMLElement | null) ||
    (nodeEl.querySelector(
      `.react-flow__handle[data-handleid="${side}"]`
    ) as HTMLElement | null)

  if (!handle) return

  // Anchors use pointer-events:none while idle — briefly enable so RF's Handle listener runs
  const prevPointerEvents = handle.style.pointerEvents
  handle.style.pointerEvents = 'auto'

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: e.clientX,
    clientY: e.clientY,
    button: 0,
    buttons: 1,
  }

  // RF 11 Handle listens for mousedown; also send pointerdown for newer paths
  handle.dispatchEvent(
    new PointerEvent('pointerdown', {
      ...eventInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
  )
  handle.dispatchEvent(new MouseEvent('mousedown', eventInit))

  // Restore after RF has armed the connection gesture
  requestAnimationFrame(() => {
    handle.style.pointerEvents = prevPointerEvents
  })
}
