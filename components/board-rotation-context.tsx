'use client'

// Board camera rotation — CSS vars, two-finger twist, and a context for the nav control
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useReactFlow, useStore } from 'reactflow'
import {
  boardRotationRef,
  patchReactFlowRotation,
  normalizeDeg,
  pinchTwistRawHeading,
  snapRotation,
  twistSnapHeading,
  viewportKeepingPanePoint,
} from '@/lib/board-rotation'

const CHROME_SEL =
  '[data-minimap-toggle-context], [data-minimap-context], [data-minimap-pill-context], [data-edit-top-bar]' // Free nav / minimap / top bar — never steal twist from chrome

type BoardRotationContextValue = {
  rotation: number // Current heading in degrees (0 = upright)
  setRotationAroundPanePoint: (nextDeg: number, paneX: number, paneY: number, nextZoom?: number) => void // Orbit a pane pixel
  setRotationAroundViewCenter: (nextDeg: number, opts?: { snap?: boolean }) => void // Icon scrub / slider / reset
  resetRotation: () => void // Snap heading to 0 around the view center
  setScrollMode: (on: boolean) => void // Free-nav Scroll vs Zoom (wheel); two-finger is always pan+pinch
}

const BoardRotationContext = createContext<BoardRotationContextValue | null>(null)

type GestureLike = Event & { rotation?: number; scale?: number; clientX?: number; clientY?: number } // Safari GestureEvent

type TwistGesture = {
  startDist: number
  startAngle: number
  startRot: number
  startZoom: number
  stuckAtZero: boolean // Magnet only after crossing 0 from outside
  rotateArmed: boolean // False until the fingers clearly twist (pinch stays zoom-only)
  zoomLocked: boolean // True once this gesture is a pinch — ignore later twist
  armOffset: number // dDeg at arm time so heading doesn’t jump
  lastMidX: number // Previous two-finger midpoint — pan by the delta
  lastMidY: number
  lastT: number // performance.now() of last sample — pan velocity
  vx: number // Midpoint px / ms (for coast after lift)
  vy: number
}

function isIosTouch(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as Mac
}

function paneCenter(flowEl: HTMLElement): { x: number; y: number } {
  return { x: flowEl.clientWidth / 2, y: flowEl.clientHeight / 2 } // Layout size — not AABB (rotation is on inner layers)
}

function flowEl(): HTMLElement | null {
  return document.querySelector('.react-flow') as HTMLElement | null // RF root = pane box for client→pane
}

function overBoard(e: { clientX?: number; clientY?: number; target?: EventTarget | null }) {
  const x = e.clientX
  const y = e.clientY
  if (typeof x === 'number' && typeof y === 'number') {
    const hit = document.elementFromPoint(x, y) // Trackpad GestureEvent often targets document/html
    if (hit?.closest(CHROME_SEL)) return false
    if (hit?.closest('.react-flow')) return true
  }
  const t = e.target
  if (t instanceof Element) {
    if (t.closest(CHROME_SEL)) return false
    if (t.closest('.react-flow')) return true
  }
  return false
}

export function BoardRotationProvider({ children }: { children: ReactNode }) {
  const instance = useReactFlow() // Viewport helpers + patch target
  const transform = useStore((s) => s.transform) // Live x/y/zoom so CSS vars track pan
  const domNode = useStore((s) => s.domNode) // .react-flow — WebKit dispatches gestures onto this tree
  const [rotation, setRotation] = useState(0) // React state for nav UI
  const rotationRef = useRef(0) // Gesture math must not wait a render
  rotationRef.current = rotation
  boardRotationRef.current = rotation // Non-React readers stay in sync
  const scrollModeRef = useRef(false) // Live Free-nav Scroll vs Zoom — don’t rebind gesture listeners on toggle
  const setScrollMode = useCallback((on: boolean) => {
    scrollModeRef.current = on // Phone two-finger reads this every move
  }, [])

  const applyAroundPanePoint = useCallback(
    (nextDeg: number, paneX: number, paneY: number, nextZoom?: number) => {
      const heading = normalizeDeg(nextDeg) // Slider / icon / twist pass already-snapped values
      const vp = instance.getViewport()
      const zoom = nextZoom ?? vp.zoom
      const next = viewportKeepingPanePoint(paneX, paneY, vp, rotationRef.current, heading, zoom)
      instance.setViewport(next) // New T so the pivot flow point stays under the finger
      rotationRef.current = heading
      boardRotationRef.current = heading
      setRotation(heading)
    },
    [instance]
  )

  const setRotationAroundViewCenter = useCallback(
    (nextDeg: number, opts?: { snap?: boolean }) => {
      const heading = opts?.snap ? snapRotation(nextDeg) : normalizeDeg(nextDeg) // Icon scrub snaps; slider does not
      const el = flowEl()
      if (!el) {
        rotationRef.current = heading
        boardRotationRef.current = heading
        setRotation(heading)
        return
      }
      const c = paneCenter(el)
      applyAroundPanePoint(heading, c.x, c.y)
    },
    [applyAroundPanePoint]
  )

  const resetRotation = useCallback(() => {
    setRotationAroundViewCenter(0) // Always orbit the view center so the board doesn’t jump
  }, [setRotationAroundViewCenter])

  // Keep RF screenToFlow / flowToScreen rotation-aware once d3 is ready
  useEffect(() => {
    if (!instance.viewportInitialized) return
    patchReactFlowRotation(instance)
  }, [instance, instance.viewportInitialized])

  // Drive CSS camera rotate on nodes/edges/dots without touching RF’s translate+scale (m22 = zoom)
  useLayoutEffect(() => {
    const el = flowEl()
    if (!el) return
    el.style.setProperty('--tt-board-rot', `${rotation}deg`) // Inner layers read this
    el.style.setProperty('--tt-vx', `${transform[0]}px`) // Background rotates around the flow origin
    el.style.setProperty('--tt-vy', `${transform[1]}px`)
    el.classList.toggle('tt-board-rotated', Math.abs(rotation) > 0.01) // Skip identity transforms when upright
  }, [rotation, transform])

  // Two-finger twist (+ pinch zoom) — capture so RF’s d3 pinch doesn’t double-zoom
  useEffect(() => {
    const pointers = new Map<number, { x: number; y: number }>() // Active fingers on the board
    let pinch: TwistGesture | null = null // Two real pointers (iPad)
    let safari: TwistGesture | null = null // Trackpad / Safari GestureEvent
    let lastGestureTs = 0 // Window + node listeners can see the same event
    let lastX = window.innerWidth / 2 // Fallback when GestureEvent omits clientX
    let lastY = window.innerHeight / 2

    const list = () => [...pointers.values()] // Current pair (order doesn’t matter for angle delta)

    let inertiaRaf = 0 // Coast after two-finger pan lift (trackpad-like)

    const stopInertia = () => {
      if (inertiaRaf) cancelAnimationFrame(inertiaRaf)
      inertiaRaf = 0
    }

    const startInertia = (ivx: number, ivy: number) => {
      stopInertia()
      let vx = ivx
      let vy = ivy
      let prev = performance.now()
      const step = (now: number) => {
        const dt = Math.min(32, now - prev) // Cap so a backgrounded tab doesn’t jump
        prev = now
        vx *= Math.exp(-0.0045 * dt) // ~1s coast; matches Mac trackpad feel
        vy *= Math.exp(-0.0045 * dt)
        if (Math.hypot(vx, vy) < 0.04) {
          inertiaRaf = 0
          return
        }
        const vp = instance.getViewport()
        instance.setViewport({ x: vp.x + vx * dt, y: vp.y + vy * dt, zoom: vp.zoom })
        inertiaRaf = requestAnimationFrame(step)
      }
      inertiaRaf = requestAnimationFrame(step)
    }

    const applyTwist = (dDeg: number, scaleRatio: number, paneX: number, paneY: number, zoom: number, g: TwistGesture, vp: { x: number; y: number; zoom: number }) => {
      const raw = pinchTwistRawHeading(g.startRot, dDeg, scaleRatio, g) // Zoom-only until a committed twist
      const { heading, stuckAtZero } = twistSnapHeading(raw, rotationRef.current, g.stuckAtZero)
      g.stuckAtZero = stuckAtZero
      const next = viewportKeepingPanePoint(paneX, paneY, vp, rotationRef.current, heading, zoom)
      instance.setViewport(next)
      if (heading === rotationRef.current) return // Pan/zoom only — skip a React render every frame
      rotationRef.current = heading
      boardRotationRef.current = heading
      setRotation(heading)
    }

    // Pinch always zooms; two fingers moving together always pan (then coast on lift)
    const applyTwoFinger = (ax: number, ay: number, bx: number, by: number) => {
      if (!pinch) return
      const dx = bx - ax
      const dy = by - ay
      const dist = Math.hypot(dx, dy) || 1
      const midX = (ax + bx) / 2
      const midY = (ay + by) / 2
      const panX = midX - pinch.lastMidX // Content follows the two-finger midpoint
      const panY = midY - pinch.lastMidY
      const now = performance.now()
      const dt = Math.max(1, now - pinch.lastT)
      const alpha = 0.4 // Smooth velocity so a noisy last frame doesn’t over-coast
      pinch.vx = pinch.vx * (1 - alpha) + (panX / dt) * alpha
      pinch.vy = pinch.vy * (1 - alpha) + (panY / dt) * alpha
      pinch.lastMidX = midX
      pinch.lastMidY = midY
      pinch.lastT = now
      const el = flowEl()
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vp = instance.getViewport()
      const panned = { x: vp.x + panX, y: vp.y + panY, zoom: vp.zoom } // Pan first, then zoom around the new midpoint
      const angle = Math.atan2(dy, dx)
      const dDeg = ((angle - pinch.startAngle) * 180) / Math.PI
      const nextZoom = Math.min(2, Math.max(0.1, pinch.startZoom * (dist / pinch.startDist)))
      applyTwist(dDeg, dist / pinch.startDist, midX - rect.left, midY - rect.top, nextZoom, pinch, panned)
    }

    const beginPinch = (ax: number, ay: number, bx: number, by: number) => {
      stopInertia() // New gesture owns the camera
      const dx = bx - ax
      const dy = by - ay
      pinch = {
        startDist: Math.hypot(dx, dy) || 1,
        startAngle: Math.atan2(dy, dx),
        startRot: rotationRef.current,
        startZoom: instance.getViewport().zoom,
        stuckAtZero: false,
        rotateArmed: false,
        zoomLocked: false, // Pinch-zoom must not arm rotate mid-gesture
        armOffset: 0,
        lastMidX: (ax + bx) / 2,
        lastMidY: (ay + by) / 2,
        lastT: performance.now(),
        vx: 0,
        vy: 0,
      }
    }

    const endTwoFinger = () => {
      if (pinch && Math.hypot(pinch.vx, pinch.vy) > 0.06) startInertia(pinch.vx, pinch.vy) // Flick → coast; slow lift → stop
      pinch = null
    }

    const onDown = (e: PointerEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      const t = e.target
      if (!(t instanceof Element)) return
      if (t.closest(CHROME_SEL)) return // Nav / minimap / top bar keep their own gestures
      if (!t.closest('.react-flow')) return
      stopInertia() // Grab the board — kill leftover coast
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        e.preventDefault() // Don't start a second RF gesture on the other finger
        e.stopPropagation()
        const [a, b] = list()
        beginPinch(a.x, a.y, b.x, b.y)
      }
    }

    const onMove = (e: PointerEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size !== 2 || !pinch) return
      e.preventDefault() // Don’t let the browser page-rotate / page-zoom
      e.stopPropagation() // RF ZoomPane would also pinch — we own both zoom and twist
      const [a, b] = list()
      applyTwoFinger(a.x, a.y, b.x, b.y)
    }

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2 && touchCount < 2) endTwoFinger() // Desktop: no TouchEvent; phone: touchend owns teardown
    }

    let touchCount = 0 // iOS may cancel pointers while two fingers stay down

    const onTouchStart = (e: TouchEvent) => {
      touchCount = e.touches.length
      if (e.touches.length < 2 || pointers.size >= 2) return // Pointer path already owns a pair
      const t = e.target
      if (!(t instanceof Element) || t.closest(CHROME_SEL) || !t.closest('.react-flow')) return
      const a = e.touches[0]
      const b = e.touches[1]
      beginPinch(a.clientX, a.clientY, b.clientX, b.clientY) // iOS may never send a second pointerdown
    }

    const onTouchMove = (e: TouchEvent) => {
      touchCount = e.touches.length
      if (e.touches.length < 2) return // One finger = pan / frame drag
      const t = e.target
      if (!(t instanceof Element) || t.closest(CHROME_SEL) || !t.closest('.react-flow')) return
      e.preventDefault() // iOS page zoom
      e.stopPropagation() // Block d3-zoom pinch so we don’t double-scale
      if (pointers.size >= 2) return // Pointer onMove already applied this frame
      const a = e.touches[0]
      const b = e.touches[1]
      if (!pinch) beginPinch(a.clientX, a.clientY, b.clientX, b.clientY)
      applyTwoFinger(a.clientX, a.clientY, b.clientX, b.clientY)
    }

    const onTouchEnd = (e: TouchEvent) => {
      touchCount = e.touches.length
      if (e.touches.length < 2 && pointers.size < 2) endTwoFinger()
    }

    const freshTwist = (startRot: number, startZoom: number): TwistGesture => ({
      startDist: 1,
      startAngle: 0,
      startRot,
      startZoom,
      stuckAtZero: false,
      rotateArmed: false, // Same Maps-style arm as two-finger touch
      zoomLocked: false,
      armOffset: 0,
      lastMidX: 0, // Trackpad GestureEvent doesn’t pan by midpoint
      lastMidY: 0,
      lastT: 0,
      vx: 0,
      vy: 0,
    })

    // Mac Safari trackpad: GestureEvent is the only rotate API. It does not use capture
    // and often targets html/document (not the pane) — listen bubble on window/document too.
    // iOS fires GestureEvent AND pointers for the same pinch; pointers own phone twist.
    const onGestureStart = (e: Event) => {
      if (isIosTouch() || pointers.size >= 2) return // Phone pinch is pointer-only
      const ge = e as GestureLike
      if (!overBoard({ clientX: ge.clientX || lastX, clientY: ge.clientY || lastY, target: e.target })) return
      if (e.timeStamp === lastGestureTs && safari) return // Same event on window + html + pane
      lastGestureTs = e.timeStamp
      e.preventDefault() // Without this Safari never sends gesturechange / steals the twist for tabs
      safari = freshTwist(rotationRef.current, instance.getViewport().zoom)
    }
    const onGestureChange = (e: Event) => {
      if (isIosTouch() || pointers.size >= 2) return
      const ge = e as GestureLike
      if (!overBoard({ clientX: ge.clientX || lastX, clientY: ge.clientY || lastY, target: e.target })) return
      e.preventDefault()
      const el = flowEl()
      if (!el) return
      const vp = instance.getViewport()
      if (!safari) {
        safari = freshTwist(rotationRef.current - (ge.rotation || 0), vp.zoom / Math.max(0.01, ge.scale || 1)) // Missed start — back-solve baseline
      }
      const rect = el.getBoundingClientRect()
      const cx = typeof ge.clientX === 'number' && ge.clientX !== 0 ? ge.clientX : lastX
      const cy = typeof ge.clientY === 'number' && ge.clientY !== 0 ? ge.clientY : lastY
      const scale = ge.scale || 1
      const nextZoom = Math.min(2, Math.max(0.1, safari.startZoom * scale))
      applyTwist(ge.rotation || 0, scale, cx - rect.left, cy - rect.top, nextZoom, safari, vp)
    }
    const onGestureEnd = () => {
      safari = null
    }

    const onMouseMeta = (e: MouseEvent) => {
      lastX = e.clientX
      lastY = e.clientY
    }

    const pointerOpts: AddEventListenerOptions = { capture: true, passive: false }
    const gestureBubble: AddEventListenerOptions = { capture: false, passive: false } // WebKit GestureEvent skips capture
    window.addEventListener('mousemove', onMouseMeta, true)

    const gestureHosts: EventTarget[] = [window, document, document.documentElement, document.body]
    if (domNode) gestureHosts.push(domNode) // Events that do target the board still bubble here

    const useSafariTrackpad = !isIosTouch() // Chrome never fires these; Safari Mac does
    const bindGesture = (t: EventTarget) => {
      t.addEventListener('gesturestart', onGestureStart, gestureBubble)
      t.addEventListener('gesturechange', onGestureChange, gestureBubble)
      t.addEventListener('gestureend', onGestureEnd, gestureBubble)
      if (t instanceof HTMLElement) {
        t.ongesturestart = onGestureStart as never // IDL path — some Safari builds ignore addEventListener
        t.ongesturechange = onGestureChange as never
        t.ongestureend = onGestureEnd as never
      }
    }
    const unbindGesture = (t: EventTarget) => {
      t.removeEventListener('gesturestart', onGestureStart, false)
      t.removeEventListener('gesturechange', onGestureChange, false)
      t.removeEventListener('gestureend', onGestureEnd, false)
      if (t instanceof HTMLElement) {
        t.ongesturestart = null
        t.ongesturechange = null
        t.ongestureend = null
      }
    }
    if (useSafariTrackpad) {
      for (const t of gestureHosts) bindGesture(t)
    }

    const pointerHosts: EventTarget[] = [window]
    if (domNode) pointerHosts.push(domNode)
    for (const t of pointerHosts) {
      t.addEventListener('pointerdown', onDown as EventListener, true)
      t.addEventListener('pointermove', onMove as EventListener, pointerOpts)
      t.addEventListener('pointerup', onUp as EventListener, true)
      t.addEventListener('pointercancel', onUp as EventListener, true)
      t.addEventListener('touchstart', onTouchStart as EventListener, pointerOpts)
      t.addEventListener('touchmove', onTouchMove as EventListener, pointerOpts)
      t.addEventListener('touchend', onTouchEnd as EventListener, true)
      t.addEventListener('touchcancel', onTouchEnd as EventListener, true)
    }

    return () => {
      stopInertia()
      window.removeEventListener('mousemove', onMouseMeta, true)
      if (useSafariTrackpad) {
        for (const t of gestureHosts) unbindGesture(t)
      }
      for (const t of pointerHosts) {
        t.removeEventListener('pointerdown', onDown as EventListener, true)
        t.removeEventListener('pointermove', onMove as EventListener, true)
        t.removeEventListener('pointerup', onUp as EventListener, true)
        t.removeEventListener('pointercancel', onUp as EventListener, true)
        t.removeEventListener('touchstart', onTouchStart as EventListener, true)
        t.removeEventListener('touchmove', onTouchMove as EventListener, true)
        t.removeEventListener('touchend', onTouchEnd as EventListener, true)
        t.removeEventListener('touchcancel', onTouchEnd as EventListener, true)
      }
    }
  }, [instance, applyAroundPanePoint, domNode])

  const value = useMemo(
    () => ({
      rotation,
      setRotationAroundPanePoint: applyAroundPanePoint,
      setRotationAroundViewCenter,
      resetRotation,
      setScrollMode,
    }),
    [rotation, applyAroundPanePoint, setRotationAroundViewCenter, resetRotation, setScrollMode]
  )

  return <BoardRotationContext.Provider value={value}>{children}</BoardRotationContext.Provider>
}

export function useBoardRotation() {
  const ctx = useContext(BoardRotationContext)
  if (!ctx) {
    return {
      rotation: 0,
      setRotationAroundPanePoint: () => {},
      setRotationAroundViewCenter: () => {},
      resetRotation: () => {},
      setScrollMode: () => {},
    }
  }
  return ctx
}
