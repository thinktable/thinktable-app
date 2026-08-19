'use client' // Toolbar SVG — client so it can sit in the Layout dropdown

import { Magnet } from 'lucide-react' // Snap option in the Thread layout alignment row
import { DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu' // Same chrome as the rest of the tool menus
import { cn } from '@/lib/utils' // Merge selected / size classes

/** Growth direction of the layout tree (same as `arrowDirection`). */
export type LayoutArrowDir = 'down' | 'up' | 'left' | 'right'

/** Snap, one stem, or fork bias: snap / single / left / center / right. */
export type LayoutForkAlign = 'snap' | 'single' | 'left' | 'center' | 'right'

const FORK_ALIGNS: LayoutForkAlign[] = ['snap', 'single', 'left', 'center', 'right'] // Alignment row: snap, linear arrow, then forks
const FORK_DIRS: LayoutArrowDir[] = ['down', 'right', 'left', 'up'] // Same order as the previous regular arrows

/** Rotate a downward fork so its stem points along `direction` (SVG clockwise degrees). */
const DIR_ROTATE: Record<LayoutArrowDir, number> = { down: 0, right: 270, up: 180, left: 90 }

const L = 6 // Left prong X in the downward template
const R = 18 // Right prong X
const Y0 = 3 // Stem top
const YB = 10 // Crossbar Y
const YT = 20 // Prong tips
const CR = 4 // Fillet radius so T-corners read as curves, not squares
const AH = 1.25 // Arrowhead half-width (old chevron was 3)
const AD = 1.6 // Arrowhead depth (old chevron was 3.5)

const ITEM = 'h-7 w-7 p-0 flex items-center justify-center rounded-sm' // Match the old 28px arrow cells
const ITEM_ON = 'bg-gray-100 dark:bg-[#1f1f1f]' // Selected wash (same as other toolbar icon menus)

/** Rounded T-fork body (downward); `single` is one stem, others pick which spine the stem uses. */
function forkBody(align: LayoutForkAlign): string {
  if (align === 'single') {
    return `M 12 ${Y0} L 12 ${YT}` // Non-branched: one shaft, same tip size as the forks
  }
  if (align === 'left') {
    return `M ${L} ${Y0} L ${L} ${YT} M ${L} ${YB - CR} Q ${L} ${YB} ${L + CR} ${YB} L ${R - CR} ${YB} Q ${R} ${YB} ${R} ${YB + CR} L ${R} ${YT}` // Spine on the left; branch fillets right then down
  }
  if (align === 'right') {
    return `M ${R} ${Y0} L ${R} ${YT} M ${R} ${YB - CR} Q ${R} ${YB} ${R - CR} ${YB} L ${L + CR} ${YB} Q ${L} ${YB} ${L} ${YB + CR} L ${L} ${YT}` // Spine on the right; branch fillets left then down
  }
  return `M 12 ${Y0} L 12 ${YB - CR} M 12 ${YB - CR} Q 12 ${YB} ${12 - CR} ${YB} L ${L + CR} ${YB} Q ${L} ${YB} ${L} ${YB + CR} L ${L} ${YT} M 12 ${YB - CR} Q 12 ${YB} ${12 + CR} ${YB} L ${R - CR} ${YB} Q ${R} ${YB} ${R} ${YB + CR} L ${R} ${YT}` // Stem in the middle; both corners filleted
}

/** Tiny round-join chevron at a prong tip. */
function tip(x: number): string {
  return `${x - AH},${YT - AD} ${x},${YT} ${x + AH},${YT - AD}` // Smaller than the old 6×3.5 V
}

/** Two-prong fork: rounded T + small tips; rotate encodes direction. */
export function LayoutForkIcon({
  direction,
  align,
  className,
}: {
  direction: LayoutArrowDir // Which way the stem points
  align: Exclude<LayoutForkAlign, 'snap'> // Fork / linear only — snap uses Magnet via LayoutAlignGlyph
  className?: string // Usually h-4 w-4 to match lucide
}) {
  return (
    <svg
      viewBox="0 0 24 24" // Lucide canvas so h-4 matches ArrowDown
      fill="none" // Stroke-only, inherits button color
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round" // Softens fork fillets and chevron tips
      className={className}
      aria-hidden="true" // Parent button / item owns the label
    >
      <g transform={`rotate(${DIR_ROTATE[direction]} 12 12)`}> {/* Down template → selected direction */}
        <path d={forkBody(align)} /> {/* Stem, or stem + rounded split + prongs */}
        {align === 'single' ? (
          <polyline points={tip(12)} /> // One tip on the single shaft
        ) : (
          <>
            <polyline points={tip(L)} /> {/* Left tip */}
            <polyline points={tip(R)} /> {/* Right tip */}
          </>
        )}
      </g>
    </svg>
  )
}

/** Glyph for the alignment row / toolbar: magnet for snap, otherwise the (rotated) fork arrow. */
export function LayoutAlignGlyph({
  direction,
  align,
  className,
}: {
  direction: LayoutArrowDir // Which way the stem points
  align: LayoutForkAlign // Snap, single, or a fork
  className?: string // Usually h-4 w-4
}) {
  if (align === 'snap') return <Magnet className={className} aria-hidden="true" /> // Snap sits left of the linear arrow; canonical magnet, not rotated
  return <LayoutForkIcon direction={direction} align={align} className={className} /> // Linear + forks follow selected direction
}

/** Alignment row + direction forks for the Layout tool dropdown (and More overflow). */
export function LayoutForkMenuItems({
  direction,
  align,
  onDirectionChange,
  onAlignChange,
  canSnap = false,
  snapActive = false,
  onSnapFrames,
}: {
  direction: LayoutArrowDir // Currently selected growth direction
  align: LayoutForkAlign // Currently selected fork alignment
  onDirectionChange: (dir: LayoutArrowDir) => void // Pick down / right / left / up
  onAlignChange: (align: LayoutForkAlign) => void // Pick snap, single arrow, or left / center / right fork
  canSnap?: boolean // Need ≥2 selected frames
  snapActive?: boolean // Magnet is the selected Thread layout align
  onSnapFrames?: () => void // Pack selected frames flush — position only, no lock / stack link
}) {
  const dirAlign = align === 'snap' ? 'single' : align // Direction row: snap uses the linear arrow
  const alignTitle = (next: LayoutForkAlign) => {
    if (next !== 'snap') return next === 'single' ? 'Single arrow' : `${next} aligned fork` // Hover / a11y
    if (!canSnap) return 'Select 2+ frames to snap together' // Disabled until a multi-frame selection
    return 'Snap frames together'
  }
  return (
    <>
      <div className="flex justify-center"> {/* Snap, then linear arrow, then left/center/right forks */}
        {FORK_ALIGNS.map((next) => (
          <DropdownMenuItem
            key={next}
            title={alignTitle(next)}
            aria-label={alignTitle(next)}
            disabled={next === 'snap' && !canSnap} // Snap is an action, not only a glyph
            onSelect={(e) => {
              e.preventDefault() // Keep the menu open so direction arrows can update in place
              onAlignChange(next)
              if (next === 'snap') onSnapFrames?.() // Pack flush; does not lock or link stacks
            }}
            className={cn(
              ITEM,
              (next === 'snap' ? snapActive || align === 'snap' : align === next) && ITEM_ON
            )}
          >
            <LayoutAlignGlyph direction={direction} align={next} className="h-4 w-4" />
          </DropdownMenuItem>
        ))}
      </div>
      <DropdownMenuSeparator className="mx-0 my-1" /> {/* Split alignment from direction */}
      <div className="flex justify-center"> {/* Forked arrows — each points its own way, using selected align */}
        {FORK_DIRS.map((next) => (
          <DropdownMenuItem
            key={next}
            title={`Layout ${next}`}
            aria-label={`Layout ${next}`}
            onSelect={(e) => {
              e.preventDefault() // Keep the menu open so alignment forks can rotate to this direction
              onDirectionChange(next)
            }}
            className={cn(ITEM, direction === next && ITEM_ON)}
          >
            <LayoutForkIcon direction={next} align={dirAlign} className="h-4 w-4" /> {/* Follow selected alignment (single or fork) */}
          </DropdownMenuItem>
        ))}
      </div>
    </>
  )
}
