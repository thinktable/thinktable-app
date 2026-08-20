'use client' // Toolbar SVG — client so it can sit in the Layout dropdown

import { Magnet, ChevronsDownUp, ChevronsUpDown } from 'lucide-react' // Magnet snap + stack/unstack
import { DropdownMenuItem } from './ui/dropdown-menu' // Same chrome as the rest of the tool menus
import { cn } from '@/lib/utils' // Merge selected / size classes

/** Growth direction of the layout tree (same as `arrowDirection`). */
export type LayoutArrowDir = 'down' | 'up' | 'left' | 'right'

/** One stem, or fork bias: single / left / center / right. Magnet is a separate toggle. */
export type LayoutForkAlign = 'single' | 'left' | 'center' | 'right'

const FORK_ALIGNS: LayoutForkAlign[] = ['single', 'left', 'center', 'right'] // Left column under the magnet
const FORK_DIRS: LayoutArrowDir[] = ['down', 'right', 'left', 'up'] // Right column under stack/unstack

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
const COL_RULE = 'mx-0.5 h-px w-6 self-center bg-muted' // Hairline inside a column (under magnet / collapse)

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
  align: LayoutForkAlign // Fork / linear — magnet is a separate toggle
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

/** Toolbar glyph: selected alignment fork in the selected direction (magnet is not the trigger). */
export function LayoutAlignGlyph({
  direction,
  align,
  className,
}: {
  direction: LayoutArrowDir // Which way the stem points
  align: LayoutForkAlign // Single or a fork
  className?: string // Usually h-4 w-4
}) {
  return <LayoutForkIcon direction={direction} align={align} className={className} />
}

/** Alignment column + direction column for the Layout tool dropdown (and More overflow). */
export function LayoutForkMenuItems({
  direction,
  align,
  onDirectionChange,
  onAlignChange,
  canSnap = false,
  snapActive = false,
  onSnapFrames,
  canStack = false,
  stackActive = false,
  onStackFrames,
}: {
  direction: LayoutArrowDir // Currently selected growth direction
  align: LayoutForkAlign // Currently selected fork alignment
  onDirectionChange: (dir: LayoutArrowDir) => void // Pick down / right / left / up
  onAlignChange: (align: LayoutForkAlign) => void // Pick single arrow, or left / center / right fork
  canSnap?: boolean // Need ≥2 selected frames
  snapActive?: boolean // Selection already shares a sideStacks link
  onSnapFrames?: () => void // Toggle pack/unlink — does not change align
  canStack?: boolean // Need ≥2 selected (or an already-stacked group)
  stackActive?: boolean // Selection’s group has hidden mates
  onStackFrames?: () => void // Toggle stack/unstack — does not change direction
}) {
  const alignTitle = (next: LayoutForkAlign) =>
    next === 'single' ? 'Single arrow' : `${next} aligned fork` // Hover / a11y
  return (
    <div className="flex w-fit items-stretch"> {/* Two columns: align | direction */}
      <div className="flex flex-col"> {/* Magnet toggle on top, then alignment arrows */}
        <DropdownMenuItem
          title={!canSnap ? 'Select 2+ frames to snap together' : snapActive ? 'Unsnap frames' : 'Snap frames together'}
          aria-label={!canSnap ? 'Select 2+ frames to snap together' : snapActive ? 'Unsnap frames' : 'Snap frames together'}
          disabled={!canSnap}
          onSelect={(e) => {
            e.preventDefault() // Keep the menu open; do not steal the alignment pick
            onSnapFrames?.()
          }}
          className={cn(ITEM, snapActive && ITEM_ON)}
        >
          <Magnet className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuItem>
        <div className={COL_RULE} aria-hidden="true" /> {/* Split magnet from alignment arrows */}
        {FORK_ALIGNS.map((next) => (
          <DropdownMenuItem
            key={next}
            title={alignTitle(next)}
            aria-label={alignTitle(next)}
            onSelect={(e) => {
              e.preventDefault() // Keep the menu open so direction arrows can update in place
              onAlignChange(next)
            }}
            className={cn(ITEM, align === next && ITEM_ON)}
          >
            <LayoutAlignGlyph direction={direction} align={next} className="h-4 w-4" />
          </DropdownMenuItem>
        ))}
      </div>
      <div className="mx-0.5 w-px self-stretch bg-muted" aria-hidden="true" /> {/* Vertical split */}
      <div className="flex flex-col"> {/* Stack/unstack toggle on top, then direction arrows */}
        <DropdownMenuItem
          title={!canStack ? 'Select 2+ frames to stack' : stackActive ? 'Unstack frames' : 'Stack frames'}
          aria-label={!canStack ? 'Select 2+ frames to stack' : stackActive ? 'Unstack frames' : 'Stack frames'}
          disabled={!canStack}
          onSelect={(e) => {
            e.preventDefault() // Keep the menu open; do not steal the direction pick
            onStackFrames?.()
          }}
          className={cn(ITEM, stackActive && ITEM_ON, 'text-gray-500 dark:text-gray-400')}
        >
          {stackActive ? (
            <ChevronsUpDown className="h-4 w-4" aria-hidden="true" /> // Stacked — click to expand
          ) : (
            <ChevronsDownUp className="h-4 w-4" aria-hidden="true" /> // Expanded — click to stack
          )}
        </DropdownMenuItem>
        <div className={COL_RULE} aria-hidden="true" /> {/* Split stack toggle from direction arrows */}
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
            <LayoutForkIcon direction={next} align={align} className="h-4 w-4" />
          </DropdownMenuItem>
        ))}
      </div>
    </div>
  )
}
