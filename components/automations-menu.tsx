'use client'

// Actions-bar Automations popover — list, search, and New (UI until persistence)

import { useMemo, useState } from 'react' // Search filter + local list
import {
  AlertTriangle, // Invalid status glyph
  ArrowRight, // Trigger → action connector
  Calendar, // Date trigger/action glyph
  List, // List/property trigger glyph
  Plus, // Page-added trigger + New button
  Sigma, // Formula action glyph
  X, // Close the popover
  Zap, // Toolbar trigger icon
} from 'lucide-react'
import { Button } from '@/components/ui/button' // Same ghost icon button as Filter/Sort
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Anchored panel under the Zap control
import { AutomationEditorModal } from './automation-editor-modal' // + New automation window
import { cn } from '@/lib/utils' // Class merge
import { TOOLBAR_MENU_PLACEMENT } from '@/lib/menu-placement' // Under the trigger, never over the board path
import { ToolbarTitle } from './toolbar-title' // Animated icon-adjacent title

// One listed automation: trigger glyph → action glyph + title/body
type AutomationItem = {
  id: string // Stable key
  title: string // Bold name on the card
  description: string // When… / Then… summary
  invalid?: boolean // Shows the Invalid pill
  trigger: 'plus' | 'list' | 'calendar' // Left glyph
  action: 'sigma' | 'calendar' // Right glyph
}

// Seed list matching the Automations menu spec (not persisted yet)
const SEED_AUTOMATIONS: AutomationItem[] = [
  {
    id: 'parent-tagging', // First card in the spec
    title: 'Parent Tagging', // Spec title
    description: 'When Page added, Change property type or delete to enable this automation', // Spec body
    invalid: true, // Spec shows Invalid on this row
    trigger: 'plus', // Blue + glyph
    action: 'sigma', // Gray Σ glyph
  },
  {
    id: 'add-lead-days', // Second card
    title: "Add lead days to 'Saved due date'", // Spec title
    description: 'When Repeat lead (#) days is edited, Set Due date to My value', // Spec body
    trigger: 'list', // List glyph
    action: 'calendar', // Calendar glyph
  },
  {
    id: 'update-saved-due-date', // Third card
    title: "Update 'Saved due date'", // Spec title
    description: 'When Due date is edited, Set Saved due date to My value', // Spec body
    trigger: 'calendar', // Calendar glyph
    action: 'calendar', // Calendar glyph
  },
]

type AutomationsMenuProps = {
  open: boolean // Controlled by editor-toolbar openDropdown
  onOpenChange: (open: boolean) => void // Keep only one toolbar dropdown open
  conversationId?: string // Current board — passed into the editor modal
  showLabel?: boolean // false when the early title cluster has condensed to icons
}

// 16px glyph inside a 24px rounded square (trigger = blue, action = gray)
function AutomationGlyph({
  kind,
  tone,
}: {
  kind: AutomationItem['trigger'] | AutomationItem['action'] // Which lucide icon
  tone: 'trigger' | 'action' // Blue wash vs gray wash
}) {
  const Icon = kind === 'plus' ? Plus : kind === 'list' ? List : kind === 'sigma' ? Sigma : Calendar // Map kind → icon
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-[5px]', // Spec: small square
        tone === 'trigger' ? 'bg-[#e8f3fc] text-[#2383e2]' : 'bg-[#f1f1ef] text-gray-500' // Trigger blue / action gray
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} /> {/* Compact glyph inside the square */}
    </span>
  )
}

export function AutomationsMenu({
  open,
  onOpenChange,
  conversationId,
  showLabel = true, // Icon+title until the early cluster condenses
}: AutomationsMenuProps) {
  const [query, setQuery] = useState('') // Filters titles + descriptions
  const [editorOpen, setEditorOpen] = useState(false) // New-automation window

  const items = useMemo(() => {
    const q = query.trim().toLowerCase() // Empty query shows all
    if (!q) return SEED_AUTOMATIONS // No filter
    return SEED_AUTOMATIONS.filter(
      (item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) // Match name or when/then text
    )
  }, [query])

  return (
    <>
    <DropdownMenu
      open={open} // Toolbar owns which menu is open
      onOpenChange={(next) => {
        if (!next) setQuery('') // Clear search on close so reopen is fresh
        onOpenChange(next) // Sync toolbar openDropdown
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] flex-shrink-0 flex items-center',
            'transition-[padding,gap] duration-200 ease-out', // Pad/gap tween with the title width
            showLabel ? 'px-2 gap-1.5' : 'px-1.5 gap-0' // Title condenses first on shrink
          )}
          title="Automations"
        >
          <Zap className="h-4 w-4 flex-shrink-0" /> {/* Actions-bar automations control */}
          <ToolbarTitle show={showLabel}>Automations</ToolbarTitle>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...TOOLBAR_MENU_PLACEMENT} // Same as Filter: start/bottom/8px, no flip over the path
        className="w-[300px] rounded-xl border-gray-200 p-0 shadow-md" // Spec: white rounded panel
        onCloseAutoFocus={(e) => e.preventDefault()} // Don't yank focus back onto the Zap
        onKeyDown={(e) => e.stopPropagation()} // Don't let board shortcuts eat typing
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2"> {/* Header row */}
          <div className="flex items-center gap-1.5"> {/* Title + help */}
            <span className="text-[15px] font-semibold text-gray-900">Automations</span> {/* Spec title */}
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e3e2e0] text-[10px] font-semibold leading-none text-gray-600 hover:bg-[#d3d1ce]" // Gray ? circle
              title="Learn about automations"
              aria-label="Learn about automations"
              onPointerDown={(e) => e.preventDefault()} // Keep the menu open
            >
              ?
            </button>
          </div>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e3e2e0] text-gray-600 hover:bg-[#d3d1ce]" // Gray x circle
            aria-label="Close automations"
            onClick={() => onOpenChange(false)} // Close via the X
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-3 pb-2"> {/* Search row */}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)} // Live-filter the cards
            placeholder="Search automations..."
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300" // Spec search field
            onKeyDown={(e) => e.stopPropagation()} // Keep keys in the field
            onPointerDown={(e) => e.stopPropagation()} // Don't treat as a menu select
          />
        </div>

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-3 pb-2"> {/* Scrollable cards */}
          {items.length === 0 ? (
            <div className="px-1 py-6 text-center text-xs text-gray-400">No automations match</div> // Empty search
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left hover:bg-gray-50" // Spec card chrome
                onPointerDown={(e) => e.preventDefault()} // Stay open until an editor exists
              >
                <div className="mb-1.5 flex items-center gap-1"> {/* Trigger → action */}
                  <AutomationGlyph kind={item.trigger} tone="trigger" />
                  <ArrowRight className="h-3 w-3 text-gray-400" /> {/* Spec arrow */}
                  <AutomationGlyph kind={item.action} tone="action" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5"> {/* Title + optional Invalid */}
                  <span className="text-[13px] font-semibold text-gray-900">{item.title}</span>
                  {item.invalid ? (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-[#f1f1ef] px-1.5 py-0.5 text-[10px] font-medium text-gray-600"> {/* Spec Invalid pill */}
                      <AlertTriangle className="h-3 w-3 text-gray-500" />
                      Invalid
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-gray-500">{item.description}</p> {/* When/then */}
              </button>
            ))
          )}
        </div>

        <div className="px-3 pb-3 pt-1"> {/* Footer */}
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center rounded-md bg-[#2383e2] text-sm font-medium text-white hover:bg-[#1a6fc9]" // Spec + New automation
            onPointerDown={(e) => e.preventDefault()} // Don't let the menu steal the click
            onClick={() => {
              onOpenChange(false) // Close the list first (Radix focus trap)
              setTimeout(() => setEditorOpen(true), 0) // Then open the editor window
            }}
          >
            + New automation
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <AutomationEditorModal
      open={editorOpen}
      onOpenChange={setEditorOpen}
      conversationId={conversationId}
    />
    </>
  )
}
