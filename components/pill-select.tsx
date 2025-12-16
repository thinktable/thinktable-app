'use client'

// Floating pill select component - segmented control with dark grey background
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface PillSelectProps {
  options: { value: string; label: string }[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}

export function PillSelect({ options, value, onChange, className }: PillSelectProps) {
  const [selectedValue, setSelectedValue] = useState(value || options[0]?.value || '')

  const handleSelect = (optionValue: string) => {
    setSelectedValue(optionValue)
    onChange?.(optionValue)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 px-1 py-1 rounded-full bg-blue-50 dark:bg-[#2a2a3a] shadow-sm',
        className
      )}
    >
      {options.map((option) => {
        const isSelected = selectedValue === option.value
        return (
          <button
            key={option.value}
            onClick={() => handleSelect(option.value)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
              isSelected
                ? 'bg-white dark:bg-white text-gray-700 dark:text-gray-300' // White background when selected, match topbar text color
                : 'bg-transparent text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100' // Match topbar text color
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}



