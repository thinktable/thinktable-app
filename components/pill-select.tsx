'use client'

// Floating pill select — segmented control; selected option can show a reset/clear affordance
import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react' // Reset/clear — only on the active segment
import { cn } from '@/lib/utils'

interface PillSelectOption {
  value: string
  label: string
  onReset?: () => void // When set, show reset icon to the right of the label while selected
}

interface PillSelectProps {
  options: PillSelectOption[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}

export function PillSelect({ options, value, onChange, className }: PillSelectProps) {
  const [selectedValue, setSelectedValue] = useState(value || options[0]?.value || '')

  // Stay in sync when the parent drives mode (toolbar / context)
  useEffect(() => {
    if (value !== undefined && value !== selectedValue) {
      setSelectedValue(value)
    }
  }, [value, selectedValue])

  const handleSelect = (optionValue: string) => {
    setSelectedValue(optionValue)
    onChange?.(optionValue)
  }

  return (
    <div
      className={cn(
        // Solid soft grey (matches former translucent look over the board, without transparency)
        'flex items-center gap-0.5 px-1 py-1 rounded-full bg-[#f7f8f9] dark:bg-[#1c1c24] shadow-sm',
        className
      )}
    >
      {options.map((option) => {
        const isSelected = selectedValue === option.value
        const showReset = isSelected && typeof option.onReset === 'function' // Only on the active toggle
        return (
          <div
            key={option.value}
            className={cn(
              'inline-flex items-center rounded-full text-sm font-medium transition-all duration-200',
              isSelected
                ? 'bg-white dark:bg-white text-gray-700 dark:text-gray-300' // White background when selected
                : 'bg-transparent text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
            )}
          >
            <button
              type="button"
              onClick={() => handleSelect(option.value)}
              className={cn(
                'px-4 py-1.5 rounded-full',
                showReset && 'pr-1.5' // Tighten before the reset icon
              )}
            >
              {option.label}
            </button>
            {showReset && (
              <button
                type="button"
                title={`Reset ${option.label}`}
                aria-label={`Reset ${option.label}`}
                className="mr-2 inline-flex items-center justify-center rounded-full p-0.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-200/20"
                onClick={(e) => {
                  e.stopPropagation()
                  option.onReset?.()
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
