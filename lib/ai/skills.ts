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
    description: 'Concise summary of frames on this page',
    systemHint:
      'The Summarize skill is attached. Prefer a concise summary of the current page frames; lead with the main points.',
    enabled: true,
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Track changes with a sidebar smart list',
    systemHint:
      'The Tasks skill is attached. Extract and maintain a clear task checklist from the page and conversation; keep items actionable. Do not claim to have placed tasks on the page unless Edit mode creates frames.',
    enabled: true,
  },
  {
    id: 'search-page',
    name: 'Search page',
    description: 'What stands out across frames here',
    systemHint:
      'The Search page skill is attached. Highlight what stands out across frames on this page; call out themes, gaps, and connections.',
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
