'use client'

// Floating pill select — segmented control (Actions / Layout / Draw / View)
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

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
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={cn(
              'inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
              isSelected
                ? 'bg-white dark:bg-white text-gray-700 dark:text-gray-300' // White background when selected
                : 'bg-transparent text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
