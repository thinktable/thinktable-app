'use client'

// Style-bar Frame style dropdown — fill / border / weight / style / silhouette.
// Mirrors the frame right-click Color + Shape flyouts for selected frames.

import { Check } from 'lucide-react' // Active silhouette check
import { cn } from '@/lib/utils' // Class merge
import Shape from '@/components/shapes/Shape' // Mini silhouette previews
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  FRAME_SHAPE_NONE,
  FRAME_SHAPE_TYPES,
  frameShapeLabel,
  type FrameShapeChoice,
} from '@/lib/frame-shape' // Frame-as-shape picker values

/** Notion-like frame palette — fill uses pale bg; border uses stronger stroke hues. */
export const FRAME_COLOR_SWATCHES = [
  { id: 'default', name: 'Default', fill: '', border: '' }, // Empty = transparent chrome
  { id: 'gray', name: 'Gray', fill: '#F1F1EF', border: '#787774' },
  { id: 'brown', name: 'Brown', fill: '#F4EEEE', border: '#9F6B53' },
  { id: 'orange', name: 'Orange', fill: '#FBECDD', border: '#D9730D' },
  { id: 'yellow', name: 'Yellow', fill: '#FBF3DB', border: '#CB912F' },
  { id: 'green', name: 'Green', fill: '#EDF3EC', border: '#448361' },
  { id: 'blue', name: 'Blue', fill: '#E7F3F8', border: '#337EA9' },
  { id: 'purple', name: 'Purple', fill: '#F6F3F9', border: '#9065B0' },
  { id: 'pink', name: 'Pink', fill: '#F9F2F5', border: '#C14C8A' },
  { id: 'red', name: 'Red', fill: '#FDEBEC', border: '#E03E3E' },
] as const

/** Case-insensitive hex/empty match for active swatch highlighting. */
function colorsMatch(a: string, b: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

/** Parse stored borderWeight (`2` or `2px`) into a 1–8 slider number. */
export function parseBorderWeightPx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(8, Math.max(1, value))
  if (typeof value === 'string') {
    const n = parseFloat(value)
    if (Number.isFinite(n)) return Math.min(8, Math.max(1, n))
  }
  return 1
}

type BorderStyleValue = 'solid' | 'dashed' | 'dotted' | 'none'

/** Frame style menu body — keep open on swatch/slider clicks (caller owns DropdownMenu). */
export function FrameStyleMenuItems({
  fillColor,
  borderColor,
  borderWeight,
  borderStyle,
  frameShape,
  onFillChange,
  onBorderChange,
  onBorderWeightChange,
  onBorderStyleChange,
  onShapeChange,
}: {
  fillColor: string // Current fill (empty = transparent)
  borderColor: string // Current border (empty = none)
  borderWeight: number // 1–8 px
  borderStyle: BorderStyleValue // Stroke dash pattern
  frameShape: FrameShapeChoice // Active silhouette or Default
  onFillChange: (next: string) => void // Apply fill to selected frames
  onBorderChange: (next: string) => void // Apply border color
  onBorderWeightChange: (next: number) => void // Live weight while sliding
  onBorderStyleChange: (next: BorderStyleValue) => void // Solid / dashed / …
  onShapeChange: (next: FrameShapeChoice) => void // Apply / clear silhouette
}) {
  const weight = Math.min(8, Math.max(1, borderWeight || 1)) // Clamp for the range input
  const shapeActive = frameShape === FRAME_SHAPE_NONE || !frameShape ? FRAME_SHAPE_NONE : frameShape

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">
        Background
      </DropdownMenuLabel>
      <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
        {FRAME_COLOR_SWATCHES.map((swatch) => {
          const active = colorsMatch(fillColor, swatch.fill)
          return (
            <button
              key={`fill-${swatch.id}`}
              type="button"
              title={`${swatch.name} background`}
              aria-label={`${swatch.name} background`}
              onClick={(e) => {
                e.preventDefault() // Keep Frame style menu open
                onFillChange(swatch.fill)
              }}
              className={cn(
                'h-5 w-5 rounded-[4px] border border-gray-200 dark:border-gray-600',
                active && 'ring-2 ring-offset-1 ring-gray-900 dark:ring-gray-100 dark:ring-offset-[#0f0f0f]'
              )}
              style={{ backgroundColor: swatch.fill || '#ffffff' }}
            />
          )
        })}
      </div>
      <label className="flex items-center gap-2 px-2 pb-1.5 text-xs text-gray-600 dark:text-gray-300">
        <span
          className="h-5 w-5 flex-shrink-0 rounded-[4px] border border-gray-200 dark:border-gray-600"
          style={{ backgroundColor: fillColor || '#ffffff' }}
          aria-hidden
        />
        <input
          type="color"
          value={fillColor || '#ffffff'}
          onChange={(e) => onFillChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="h-7 w-full cursor-pointer rounded border-0 bg-transparent p-0"
          title="Custom fill"
          aria-label="Custom fill color"
        />
      </label>

      <DropdownMenuSeparator className="mx-2" />

      <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">
        Border
      </DropdownMenuLabel>
      <div className="px-2 pb-1.5">
        <input
          type="range"
          min={1}
          max={8}
          step={0.1}
          value={weight}
          onChange={(e) => {
            e.stopPropagation()
            onBorderWeightChange(parseFloat(e.target.value))
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-700 dark:bg-[#333] dark:accent-gray-300"
          title="Border size"
          aria-label="Border size"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
        {FRAME_COLOR_SWATCHES.map((swatch) => {
          const active = colorsMatch(borderColor, swatch.border)
          return (
            <button
              key={`border-${swatch.id}`}
              type="button"
              title={`${swatch.name} border`}
              aria-label={`${swatch.name} border`}
              onClick={(e) => {
                e.preventDefault()
                onBorderChange(swatch.border)
              }}
              className={cn(
                'h-5 w-5 rounded-full border-2 border-gray-200 dark:border-gray-600 bg-transparent',
                active && 'ring-2 ring-offset-1 ring-gray-900 dark:ring-gray-100 dark:ring-offset-[#0f0f0f]'
              )}
              style={{ borderColor: swatch.border || '#d1d5db' }}
            />
          )
        })}
      </div>
      <label className="flex items-center gap-2 px-2 pb-1.5 text-xs text-gray-600 dark:text-gray-300">
        <span
          className="h-5 w-5 flex-shrink-0 rounded-full border-2 bg-transparent"
          style={{ borderColor: borderColor || '#d1d5db' }}
          aria-hidden
        />
        <input
          type="color"
          value={borderColor || '#787774'}
          onChange={(e) => onBorderChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="h-7 w-full cursor-pointer rounded border-0 bg-transparent p-0"
          title="Custom border"
          aria-label="Custom border color"
        />
      </label>
      <DropdownMenuRadioGroup
        value={borderStyle}
        onValueChange={(value) => onBorderStyleChange(value as BorderStyleValue)}
      >
        <DropdownMenuRadioItem value="none" className="pl-8 text-xs">
          None
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="solid" className="pl-8 text-xs">
          Solid
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dashed" className="pl-8 text-xs">
          Dashed
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dotted" className="pl-8 text-xs">
          Dotted
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator className="mx-2" />

      <DropdownMenuLabel className="text-xs font-normal text-gray-500 pl-2 py-1.5">
        Shape
      </DropdownMenuLabel>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          onShapeChange(FRAME_SHAPE_NONE)
        }}
        className={cn(
          'mx-1 mb-1.5 flex w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
          shapeActive === FRAME_SHAPE_NONE && 'bg-blue-50 dark:bg-blue-950/40'
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-600 text-[10px] text-gray-400">
          —
        </span>
        <span className="flex-1 text-left">Default</span>
        {shapeActive === FRAME_SHAPE_NONE && <Check className="h-3.5 w-3.5 text-gray-500" />}
      </button>
      <div className="grid grid-cols-5 gap-1 px-2 pb-1.5">
        {FRAME_SHAPE_TYPES.map((shapeType) => {
          const selected = shapeActive === shapeType
          return (
            <button
              key={shapeType}
              type="button"
              title={frameShapeLabel(shapeType)}
              aria-label={frameShapeLabel(shapeType)}
              onClick={(e) => {
                e.preventDefault()
                onShapeChange(shapeType)
              }}
              className={cn(
                'flex h-9 w-full items-center justify-center rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]',
                selected && 'bg-blue-50 dark:bg-blue-950/40'
              )}
            >
              <Shape
                type={shapeType}
                width={22}
                height={22}
                fill="transparent"
                strokeWidth={1.25}
                stroke="#222"
                className="dark:[&_*]:stroke-gray-300"
              />
            </button>
          )
        })}
      </div>
    </>
  )
}
