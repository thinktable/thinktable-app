'use client'

// Popup when converting a nested/parent DB row to Card view — bring related rows.

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_CARD_CONVERT_BRING_PREFS,
  loadCardConvertBringPrefs,
  saveCardConvertBringPrefs,
  type CardConvertBringPrefs,
} from '@/lib/notion/card-convert-bring'
import { cn } from '@/lib/utils'

type CardConvertBringDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Confirm with current checkbox picks (already persisted). */
  onConfirm: (prefs: CardConvertBringPrefs) => void
  /** Optional row title for the dialog heading. */
  rowTitle?: string
}

function BringCheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-2 text-[13px] text-gray-800 hover:bg-gray-50">
      <span>{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-blue-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function CardConvertBringDialog({
  open,
  onOpenChange,
  onConfirm,
  rowTitle,
}: CardConvertBringDialogProps) {
  const [prefs, setPrefs] = useState<CardConvertBringPrefs>(DEFAULT_CARD_CONVERT_BRING_PREFS)

  // Seed from localStorage whenever the dialog opens
  useEffect(() => {
    if (!open) return
    setPrefs(loadCardConvertBringPrefs())
  }, [open])

  const patch = (partial: Partial<CardConvertBringPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...partial }))
  }

  const handleConfirm = () => {
    saveCardConvertBringPrefs(prefs) // Remember for next convert
    onConfirm(prefs)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-w-sm gap-3 p-4 sm:rounded-xl',
          '[&>button]:hidden' // Custom footer; hide stock X
        )}
      >
        <DialogTitle className="text-[15px] font-semibold text-gray-900">
          Bring related rows?
        </DialogTitle>
        <DialogDescription className="text-[13px] text-gray-500">
          {rowTitle
            ? `Convert “${rowTitle}” to Card view and optionally stack related rows.`
            : 'Convert to Card view and optionally stack related rows. Highest parent sits on top.'}
        </DialogDescription>
        <div className="mt-1 divide-y divide-gray-100 border-y border-gray-100">
          <BringCheckRow
            label="Bring sub-rows"
            checked={prefs.subRows}
            onChange={(subRows) => patch({ subRows })}
          />
          <BringCheckRow
            label="Bring parent rows"
            checked={prefs.parentRows}
            onChange={(parentRows) => patch({ parentRows })}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
            onClick={handleConfirm}
          >
            Convert
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
