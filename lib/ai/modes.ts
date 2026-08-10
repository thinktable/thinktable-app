// AI mode registry — Ask is live; Plan/Edit reserved for later tool-using modes
export type AiModeId = 'ask' | 'plan' | 'edit' // Known mode ids stored on ai_threads.mode

export interface AiMode { // UI + runtime descriptor for a mode
  id: AiModeId // Stable id
  label: string // Composer control label
  description: string // Short help text
  enabled: boolean // Whether the composer may select it today
}

export const AI_MODES: AiMode[] = [ // Ordered for the mode switcher
  {
    id: 'ask', // Sidebar Q&A only — never auto-places on the page
    label: 'Ask', // Cursor/Notion-style Ask
    description: 'Answer in the sidebar. Drag blocks onto the page to place.', // Product invariant
    enabled: true, // Live in this slice
  },
  {
    id: 'plan', // Future: produce a plan without mutating the page until applied
    label: 'Plan', // Reserved
    description: 'Propose a plan before changing the page.', // Coming soon
    enabled: false, // Stub
  },
  {
    id: 'edit', // Future: tool-calling edits with ai_action_log undo
    label: 'Edit', // Reserved
    description: 'Apply changes to frames and blocks on the page.', // Coming soon
    enabled: false, // Stub
  },
]

export function getAiMode(id: AiModeId): AiMode { // Lookup with Ask fallback
  return AI_MODES.find((m) => m.id === id) ?? AI_MODES[0] // Default Ask
}

export function isAiModeId(value: string): value is AiModeId { // Runtime guard for API bodies
  return value === 'ask' || value === 'plan' || value === 'edit' // Enum check
}
