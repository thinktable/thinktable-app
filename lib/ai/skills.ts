// Skill registry — user-attached behaviors (not model tools). Tools = model-invoked functions;
// skills = pills that shape the turn + unlock sidebar UI (e.g. Tasks smart list / Learn quiz).
export interface AiSkill {
  id: string // Stable id referenced from request / thread metadata.skillIds
  name: string // Pill + menu label
  description: string // + menu subtitle
  systemHint: string // Injected into the system prompt when attached
  enabled: boolean // Whether selectable today
}

export const AI_SKILLS: AiSkill[] = [
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Concise summary of frames on this board',
    systemHint:
      'The Summarize skill is attached. Prefer a concise summary of the current page frames; lead with the main points.',
    enabled: true,
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Track changes with a sidebar smart list',
    systemHint:
      'The Tasks skill is attached. Extract and maintain a clear task checklist from the board and conversation; keep items actionable. Do not claim to have placed tasks on the board unless Edit mode creates frames.',
    enabled: true,
  },
  {
    id: 'search-board',
    name: 'Search board',
    description: 'What stands out across frames here',
    systemHint:
      'The Search board skill is attached. Highlight what stands out across frames on this board; call out themes, gaps, and connections.',
    enabled: true,
  },
  {
    id: 'flashcards',
    name: 'Flashcards',
    description: 'Generate cards with hideable Q/A sides',
    systemHint:
      'The Flashcards skill is attached. Create frames with a clear question block and answer block. Hide one side with [[hide]]…[[/hide]] or haze spans (blur until click). Default: hide the answer. When asked to switch which side is hidden, edit existing cards — do not duplicate frames.',
    enabled: true,
  },
  {
    id: 'learn',
    name: 'Learn',
    description: 'Quiz yourself and explore answers',
    systemHint:
      'The Learn skill is attached. Quiz the user on page content: ask one question at a time, wait for their answer, then explain and continue. Encourage exploring answers, not just scoring.',
    enabled: true,
  },
]

export function getSkill(id: string): AiSkill | undefined {
  return AI_SKILLS.find((s) => s.id === id)
}

export function skillHintsForIds(ids: string[] | undefined | null): string[] {
  if (!ids?.length) return []
  return ids
    .map((id) => getSkill(id))
    .filter((s): s is AiSkill => Boolean(s?.enabled))
    .map((s) => s.systemHint)
}
