'use client'

// New/edit automation window — When trigger + Do action (UI until persistence)

import { useEffect, useState } from 'react' // Load owner name + board title when opened
import { ChevronDown, Plus, X } from 'lucide-react' // Scope chevron, + New, close
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog' // Centered modal over the board
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu' // Scope picker (current board)
import { createClient } from '@/lib/supabase/client' // Profile + board title
import { cn } from '@/lib/utils' // Class merge

type AutomationEditorModalProps = {
  open: boolean // Shown after + New automation
  onOpenChange: (open: boolean) => void // Cancel / X / overlay
  conversationId?: string // Current board — scope label
}

// "{Evan}'s automation" from full_name; fallback when unsigned
function ownerAutomationTitle(fullName: string | null): string {
  const first = (fullName || '').trim().split(/\s+/)[0] // First word of the profile name
  if (!first) return 'Untitled automation' // No profile yet
  const poss = /s$/i.test(first) ? `${first}'` : `${first}'s` // James' vs Evan's
  return `${poss} automation` // Spec title
}

// Dashed add-row used for both trigger and action
function AddStepButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-12 w-full items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white text-sm text-gray-400 hover:bg-gray-50" // Spec empty step box
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2.25} /> {/* Leading + */}
      {label}
    </button>
  )
}

export function AutomationEditorModal({
  open,
  onOpenChange,
  conversationId,
}: AutomationEditorModalProps) {
  const [title, setTitle] = useState('Untitled automation') // Editable heading
  const [boardTitle, setBoardTitle] = useState('This board') // Scope dropdown label

  useEffect(() => {
    if (!open) return // Only fetch while visible
    const supabase = createClient() // Browser client
    void (async () => {
      const { data: auth } = await supabase.auth.getUser() // Signed-in user
      if (auth.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', auth.user.id)
          .maybeSingle() // Owner display name
        setTitle(ownerAutomationTitle(profile?.full_name ?? null)) // "{Name}'s automation"
      }
      if (conversationId) {
        const { data: board } = await supabase
          .from('conversations')
          .select('title')
          .eq('id', conversationId)
          .maybeSingle() // Current board row
        if (board?.title) setBoardTitle(board.title) // Scope = this board
      }
    })()
  }, [open, conversationId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[min(540px,calc(100vw-32px))] max-w-none gap-0 rounded-xl border-gray-200 p-0 shadow-lg', // Spec: wide rounded panel
          '[&>button]:hidden' // Hide stock Dialog X; we draw the circle close
        )}
        onOpenAutoFocus={(e) => e.preventDefault()} // Don't steal into the first button
        onKeyDown={(e) => e.stopPropagation()} // Board shortcuts stay off while typing
      >
        <div className="relative px-6 pt-5 pb-3"> {/* Header */}
          <DialogTitle className="pr-8 text-[17px] font-semibold text-gray-800">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create an automation with a trigger and an action
          </DialogDescription>
          <button
            type="button"
            className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#e3e2e0] text-gray-600 hover:bg-[#d3d1ce]" // Spec circle X
            aria-label="Close"
            onClick={() => onOpenChange(false)} // Same as Cancel
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[13px] text-gray-500"> {/* Scope row */}
            <span>For all frames in</span> {/* Official term: frames on this board */}
            <DropdownMenu modal={false}> {/* Nested menu inside the dialog */}
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 font-medium text-gray-800 hover:bg-gray-100 rounded px-1 py-0.5" // Board name + chevron
                >
                  {boardTitle}
                  <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuItem className="text-sm" onSelect={(e) => e.preventDefault()}>
                  {boardTitle} {/* Only this board until multi-scope exists */}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mx-6 border-t border-gray-200" /> {/* Spec header rule */}

        <div className="px-6 py-5"> {/* When → Do */}
          <div className="text-[13px] text-gray-400 mb-1.5">When</div> {/* Trigger label */}
          <AddStepButton label="New trigger" />
          <div className="mx-auto h-6 w-px bg-gray-200" /> {/* Vertical flow line */}
          <div className="text-[13px] text-gray-400 mb-1.5">Do</div> {/* Action label */}
          <AddStepButton label="New action" />
        </div>

        <div className="flex items-center justify-between px-6 pb-5"> {/* Footer */}
          <button
            type="button"
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50" // Spec Cancel
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled // Empty When/Do cannot enable yet
            className="h-8 rounded-md bg-[#8ec8f0] px-3 text-sm font-medium text-white disabled:cursor-not-allowed" // Spec light Enable
          >
            Enable
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
