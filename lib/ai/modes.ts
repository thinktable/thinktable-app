// AI mode registry — Ask + Edit (Plan removed from product UI)
export type AiModeId = 'ask' | 'edit' | 'plan' // plan kept for legacy DB rows only

export interface AiMode {
  id: 'ask' | 'edit' // Selectable modes
  label: string
  description: string
  enabled: boolean
}

export const AI_MODES: AiMode[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Answer in the sidebar. Drag blocks onto the page or onto the input as context.',
    enabled: true,
  },
  {
    id: 'edit',
    label: 'Edit',
    description: 'Propose edits and create frames/threads on the page — review with rainbow highlights, then save or remove.',
    enabled: true,
  },
]

export function getAiMode(id: string): AiMode {
  return AI_MODES.find((m) => m.id === id) ?? AI_MODES[0]
}

export function isAiModeId(value: string): value is AiModeId {
  return value === 'ask' || value === 'edit' || value === 'plan'
}

export function isSelectableAiMode(value: string): value is 'ask' | 'edit' {
  return value === 'ask' || value === 'edit'
}
