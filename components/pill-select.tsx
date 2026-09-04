'use client'

// Floating pill select — desktop segmented control; phone: mode dropdown + tools
import { useState, useEffect } from 'react' // Local selected value + parent sync
import { ChevronDown } from 'lucide-react' // Phone mode dropdown chevron
import { cn } from '@/lib/utils' // Class merge
import { usePhoneModeMenu } from './phone-mode-menu-context' // Portal hosts for tools (inside) and undo/redo (right)
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu' // Phone: Actions / Layout / Draw / View in a left dropdown

interface PillSelectOption {
  value: string
  label: string
}

interface PillSelectProps {
  options: PillSelectOption[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}

export function PillSelect({ options, value, onChange, className }: PillSelectProps) {
  const [selectedValue, setSelectedValue] = useState(value || options[0]?.value || '')
  const { setToolsHost, setUndoHost, phoneTools } = usePhoneModeMenu() // Portals; overflow → pill (left-aligned)
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label ?? options[0]?.label // Trigger text

  // Stay in sync when the parent drives mode (toolbar / context)
  useEffect(() => {
    if (value !== undefined && value !== selectedValue) {
      setSelectedValue(value)
    }
  }, [value, selectedValue])

  const handleSelect = (optionValue: string) => {
    setSelectedValue(optionValue) // Keep the trigger label in sync
    onChange?.(optionValue) // Toolbar swaps that mode’s tools
  }

  return (
    <div
      className={cn(
        'relative flex items-stretch w-fit pointer-events-auto', // Cluster sizes to dropdown + tools + undo
        phoneTools ? 'ml-2' : 'mx-auto' // Tools in pill → left-aligned; segmented control stays centered
      )}
    >
      <div
        data-edit-menu-pill // Mode toggle shell; Filter/Sort aligns to [data-edit-menu-select] inside
        className={cn(
          // Solid soft grey (matches former translucent look over the board, without transparency)
          'relative z-10 flex items-center gap-0.5 px-1 py-1 rounded-full bg-[#f7f8f9] dark:bg-[#1c1c24] shadow-sm', // Both ends rounded; sits above undo so the right cap covers the tucked fill
          className
        )}
      >
        {phoneTools ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-edit-menu-select // Phone Filter/Sort left-aligns to this mode chip
                  className="inline-flex flex-shrink-0 items-center gap-0.5 px-3 py-1.5 rounded-full bg-white dark:bg-white text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-white" // Current mode; white chip like desktop selected
                  aria-label="Mode"
                >
                  {selectedLabel}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom"> {/* Opens under the left trigger */}
                <DropdownMenuRadioGroup value={selectedValue} onValueChange={handleSelect}>
                  {options.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div
              ref={setToolsHost} // EditorToolbar portals this mode’s tools here (not undo/redo)
              data-phone-mode-tools
              className="flex items-center gap-0 overflow-x-auto max-w-[min(calc(100vw-11rem),420px)] min-h-7" // gap-0: slash margins space the 6 Draw icons evenly
            />
          </>
        ) : (
          options.map((option) => {
            const isSelected = selectedValue === option.value // Desktop: selected chip
            return (
              <button
                key={option.value}
                type="button"
                data-edit-menu-select={isSelected ? '' : undefined} // Filter/Sort strip left-aligns to the selected mode chip
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                  isSelected
                    ? 'bg-white dark:bg-white text-gray-700 dark:text-gray-300' // White background when selected (desktop only)
                    : 'bg-transparent text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
                )}
              >
                {option.label}
              </button>
            )
          })
        )}
      </div>
      {phoneTools ? (
        <div
          ref={setUndoHost} // Toolbar portals undo/redo here — right of the toggle, outside it
          data-phone-undo
          className="relative z-0 flex items-center gap-0.5 py-1 flex-shrink-0 empty:hidden rounded-r-full bg-gray-50 dark:bg-[#0f0f0f]" // Board fill under the tools cap; padding/overlap in CSS so the arrows don’t move
        />
      ) : null}
    </div>
  )
}
