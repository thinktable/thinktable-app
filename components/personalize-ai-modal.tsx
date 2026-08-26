'use client'

// Personalize Thinktable AI — default mark is a hand-drawn T; saved PNG stays editable
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Eraser, Pencil, RotateCcw, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** localStorage key for the custom logo drawing (PNG data URL) */
export const TT_LOGO_DRAWING_STORAGE_KEY = 'thinktable-ai-logo-drawing'

/** Legacy topper key — cleared on hydrate so old toppers do not linger */
const TT_TOPPER_STORAGE_KEY_LEGACY = 'thinktable-ai-topper'

/** Logo circle fill — matches public/thinktable-logo.svg .cls-1 */
export const LOGO_CIRCLE_COLOR = '#a2a7af'

/** AI sparkles badge fill — yellow accent on brand mark */
const AI_STAR_COLOR = '#f5c518'

/** Stroke color for custom marks (white cutout look) */
const DRAW_WHITE = '#ffffff'

/** Canvas pixel size for editor + export */
const CANVAS_SIZE = 256

/** Pen width presets in canvas pixels */
const THICKNESSES = [4, 8, 14, 22] as const

/** Marker weight for the default T — matches the filled logo bar at 256px */
const DRAWN_T_WIDTH = 26

/** Crossbar: left → stem, slight sag so it reads as a pen stroke */
const DRAWN_T_BAR = 'M 48 64 C 72 56, 94 72, 124 61'

/** Stem: overlaps the bar, wobbles down the left-of-center column */
const DRAWN_T_STEM = 'M 110 48 C 104 102, 118 152, 108 198'

/** Small right hook at the stem foot (logo’s table-leg serif) */
const DRAWN_T_FOOT = 'M 108 186 C 118 192, 134 194, 150 188'

/** Lumpy table-dot to the right of the stem (filled, not a perfect circle) */
const DRAWN_DOT =
  'M 206 104 C 208 85, 194 69, 176 70 C 156 71, 144 90, 147 108 C 150 128, 168 140, 186 136 C 202 132, 206 118, 206 104 Z'

/** Clip strokes to the logo disc so round caps never paint the corners */
function clipLogoDisc(ctx: CanvasRenderingContext2D) {
  ctx.beginPath() // Disc path
  ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 0.5, 0, Math.PI * 2) // Same radius as the fill
  ctx.clip() // Keep marker inside the circle
}

/** Paint the default hand-drawn T + table-dot in white (disc already filled) */
function strokeDefaultDrawnMark(ctx: CanvasRenderingContext2D) {
  ctx.save() // Restore clip + style after
  clipLogoDisc(ctx) // Stay inside the grey disc
  ctx.strokeStyle = DRAW_WHITE // Same white as the pen tool
  ctx.fillStyle = DRAW_WHITE // Dot is a filled blob
  ctx.lineCap = 'round' // Marker ends
  ctx.lineJoin = 'round' // Marker corners
  ctx.lineWidth = DRAWN_T_WIDTH // T bar/stem weight
  ctx.stroke(new Path2D(DRAWN_T_BAR)) // Crossbar
  ctx.stroke(new Path2D(DRAWN_T_STEM)) // Vertical stem
  ctx.stroke(new Path2D(DRAWN_T_FOOT)) // Foot hook
  ctx.fill(new Path2D(DRAWN_DOT)) // Table-dot
  ctx.restore() // Drop clip
}

/** Default AI mark — same marker strokes the canvas seeds with */
function DefaultDrawnLogoSvg({
  size,
  className,
  onBoard = false,
}: {
  size: number
  className?: string
  onBoard?: boolean // Map chat toggle: black/white strokes on board fill
}) {
  const stroke = onBoard ? 'currentColor' : DRAW_WHITE
  return (
    <svg
      viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
      width={size}
      height={size}
      className={cn(onBoard && 'text-gray-900 dark:text-white', className)}
      role="img"
      aria-label="Thinktable"
    >
      <g
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={DRAWN_T_WIDTH}
      >
        <path d={DRAWN_T_BAR} />
        <path d={DRAWN_T_STEM} />
        <path d={DRAWN_T_FOOT} />
      </g>
      <path d={DRAWN_DOT} fill={stroke} />
    </svg>
  )
}

/** Read persisted logo drawing data URL (client-only) */
export function getStoredLogoDrawing(): string | null {
  if (typeof window === 'undefined') return null
  try {
    localStorage.removeItem(TT_TOPPER_STORAGE_KEY_LEGACY)
  } catch {
    // Ignore storage errors
  }
  return localStorage.getItem(TT_LOGO_DRAWING_STORAGE_KEY)
}

type ThinktableBrandMarkProps = {
  drawingUrl?: string | null // Saved composite PNG (solid circle + white strokes)
  size?: number
  className?: string
  /** Board fill + theme strokes (default); brand = legacy grey disc for personalize canvas */
  discVariant?: 'brand' | 'board'
}

/**
 * Brand mark — default hand-drawn T + table-dot, or a saved circle PNG.
 * Solid circle behind the mark so any transparency still reads as the logo disc.
 * AI sparkles badge sits top-left with a white border (outside the disc clip).
 */
export function ThinktableBrandMark({
  drawingUrl = null,
  size = 56,
  className,
  discVariant = 'board',
}: ThinktableBrandMarkProps) {
  const badgeSize = Math.max(14, Math.round(size * 0.34)) // Scales with logo
  const onBoard = discVariant === 'board'

  return (
    <div
      className={cn('relative flex-shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {/* Logo disc — board fill + border by default; legacy grey on personalize canvas */}
      <div
        className={cn(
          'h-full w-full overflow-hidden rounded-full border-[1.5px]',
          onBoard
            ? 'bg-gray-50 dark:bg-[#0f0f0f] border-gray-500 dark:border-gray-400'
            : 'border-gray-500 dark:border-gray-400'
        )}
        style={onBoard ? undefined : { backgroundColor: LOGO_CIRCLE_COLOR }}
      >
        {drawingUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drawingUrl}
            alt="Thinktable"
            width={size}
            height={size}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <DefaultDrawnLogoSvg
            size={size}
            className="h-full w-full"
            onBoard={onBoard}
          />
        )}
      </div>

      {/* AI stars — top-left; main + top spark only (no bottom), soft yellow + white outline */}
      <svg
        viewBox="0 0 24 24"
        className="absolute pointer-events-none"
        style={{
          width: badgeSize,
          height: badgeSize,
          top: -Math.round(badgeSize * 0.15),
          left: -Math.round(badgeSize * 0.15),
          color: AI_STAR_COLOR,
          filter: 'drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.6px #fff)',
        }}
        fill="none"
        aria-hidden
      >
        {/* Large center sparkle */}
        <path
          d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        {/* Small top-right spark */}
        <path d="M20 2v4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <path d="M22 4h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </div>
  )
}

type Tool = 'pen' | 'eraser'

type PersonalizeAiModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawingUrl: string | null
  onDrawingChange: (url: string | null) => void
}

export function PersonalizeAiModal({
  open,
  onOpenChange,
  drawingUrl,
  onDrawingChange,
}: PersonalizeAiModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const resetRef = useRef(false) // Reset → Done restores the default drawn mark
  const [tool, setTool] = useState<Tool>('pen')
  const [thickness, setThickness] = useState<(typeof THICKNESSES)[number]>(8)
  const [dirty, setDirty] = useState(false)
  const [ready, setReady] = useState(false) // Canvas seeded for this open

  /** Fill the full logo disc with solid gray (draw surface under the mark) */
  const paintSolidCircle = useCallback((ctx: CanvasRenderingContext2D) => {
    const s = CANVAS_SIZE
    ctx.clearRect(0, 0, s, s)
    ctx.save()
    ctx.beginPath()
    ctx.arc(s / 2, s / 2, s / 2 - 0.5, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fillStyle = LOGO_CIRCLE_COLOR
    ctx.fill()
    ctx.restore()
  }, [])

  /** Load a prior generated image onto the disc (edit later) */
  const paintSavedImage = useCallback(
    (ctx: CanvasRenderingContext2D, src: string) =>
      new Promise<void>((resolve) => {
        const img = new window.Image()
        img.onload = () => {
          paintSolidCircle(ctx) // Solid base first
          ctx.save()
          ctx.beginPath()
          ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 0.5, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE) // Prior drawing on top
          ctx.restore()
          resolve()
        }
        img.onerror = () => {
          paintSolidCircle(ctx)
          resolve()
        }
        img.src = src
      }),
    [paintSolidCircle]
  )

  /** Grey disc + default marker T (reset / first open) */
  const paintDefaultDrawnLogo = useCallback((ctx: CanvasRenderingContext2D) => {
    paintSolidCircle(ctx) // Solid disc first
    strokeDefaultDrawnMark(ctx) // Hand-drawn T + table-dot on top
  }, [paintSolidCircle])

  /** Seed editor: saved PNG if any, else the default drawn mark */
  const seedCanvas = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (drawingUrl && !resetRef.current) {
      await paintSavedImage(ctx, drawingUrl) // Continue editing prior image
    } else {
      paintDefaultDrawnLogo(ctx) // Start from the drawn character, not a blank disc
    }
    setReady(true)
  }, [drawingUrl, paintSavedImage, paintDefaultDrawnLogo])

  // Dialog mounts canvas after open — seed when open flips true
  useEffect(() => {
    if (!open) {
      setReady(false)
      return
    }
    setTool('pen')
    setThickness(8)
    setDirty(false)
    resetRef.current = false
    setReady(false)
    // Next frame so Dialog content + canvas ref exist
    const id = requestAnimationFrame(() => {
      void seedCanvas()
    })
    return () => cancelAnimationFrame(id)
  }, [open, seedCanvas])

  const getPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    }
  }

  const strokeTo = (x: number, y: number) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const last = lastPtRef.current
    ctx.save()
    ctx.beginPath()
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 0.5, 0, Math.PI * 2)
    ctx.clip() // Stay inside solid disc
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = thickness
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = tool === 'eraser' ? LOGO_CIRCLE_COLOR : DRAW_WHITE
    ctx.beginPath()
    if (last) {
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(x, y)
    } else {
      ctx.moveTo(x, y)
      ctx.lineTo(x + 0.01, y)
    }
    ctx.stroke()
    ctx.restore()
    lastPtRef.current = { x, y }
    setDirty(true)
    resetRef.current = false
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!ready) return
    const pt = getPoint(e)
    if (!pt) return
    drawingRef.current = true
    lastPtRef.current = null
    e.currentTarget.setPointerCapture(e.pointerId)
    strokeTo(pt.x, pt.y)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const pt = getPoint(e)
    if (!pt) return
    strokeTo(pt.x, pt.y)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false
    lastPtRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released
    }
  }

  const handleReset = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    resetRef.current = true
    paintDefaultDrawnLogo(ctx) // Back to the default drawn character
    setDirty(false)
    setTool('pen')
  }

  /** Export square PNG with opaque solid circle + strokes (corners transparent OK — clip in UI) */
  const exportDrawing = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.toDataURL('image/png')
  }

  const handleDone = () => {
    if (resetRef.current && !dirty) {
      onDrawingChange(null) // Default drawn mark everywhere
    } else if (dirty) {
      onDrawingChange(exportDrawing()) // Generated image shown + editable next open
    }
    // No edits: keep existing drawingUrl
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-[400px] p-0 gap-0 overflow-hidden',
          'bg-[#1a1a1a] border-white/10 text-gray-100',
          '[&>button]:hidden'
        )}
      >
        <DialogTitle className="sr-only">Personalize your Thinktable AI</DialogTitle>
        <DialogDescription className="sr-only">
          Draw on the solid logo circle; your image is saved and can be edited later
        </DialogDescription>

        <div className="relative flex items-center justify-center px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-gray-100">
            Personalize your Thinktable AI
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Solid circle canvas — draw here; result becomes the brand image */}
        <div className="flex flex-col items-center gap-4 px-6 pt-3 pb-4">
          <div
            className="rounded-full overflow-hidden touch-none"
            style={{
              width: 168,
              height: 168,
              backgroundColor: LOGO_CIRCLE_COLOR, // Visible solid disc while canvas seeds
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="h-full w-full cursor-crosshair"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <p className="text-xs text-gray-500 text-center max-w-[260px]">
            The logo starts as a drawing — edit it, or reset to the default mark. Done saves the
            image; open again to keep editing.
          </p>
        </div>

        <div className="px-5 pb-4 flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={cn(
                'h-8 px-3 rounded-md flex items-center gap-1.5 text-xs font-medium transition-colors',
                tool === 'pen'
                  ? 'bg-white/15 text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-white/10'
              )}
              aria-pressed={tool === 'pen'}
            >
              <Pencil className="h-3.5 w-3.5" />
              Draw
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={cn(
                'h-8 px-3 rounded-md flex items-center gap-1.5 text-xs font-medium transition-colors',
                tool === 'eraser'
                  ? 'bg-white/15 text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-white/10'
              )}
              aria-pressed={tool === 'eraser'}
            >
              <Eraser className="h-3.5 w-3.5" />
              Eraser
            </button>
          </div>

          <div className="flex items-center justify-center gap-2">
            <span className="text-[11px] text-gray-500 mr-1">Thickness</span>
            {THICKNESSES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setThickness(t)}
                title={`${t}px`}
                aria-label={`Thickness ${t}`}
                aria-pressed={thickness === t}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                  thickness === t
                    ? 'bg-white/15 ring-1 ring-white/40'
                    : 'hover:bg-white/10'
                )}
              >
                <span
                  className="rounded-full bg-white"
                  style={{
                    width: Math.max(4, t / 2.5),
                    height: Math.max(4, t / 2.5),
                  }}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-100 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="h-8 px-4 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
