// Skill registry — system hints composable into the Ask (and later Edit/Plan) prompt
export interface AiSkill { // One reusable skill definition
  id: string // Stable id referenced from thread metadata.skillIds
  name: string // UI label
  systemHint: string // Injected into the system prompt when attached
  enabled: boolean // Whether selectable today
}

export const AI_SKILLS: AiSkill[] = [ // Seed skills; marketplace later
  {
    id: 'summarize-page', // Summarize current page frames
    name: 'Summarize page', // UI
    systemHint: 'Prefer concise summaries of the current page frames when asked to summarize.', // Hint
    enabled: true, // Available to attach via metadata later
  },
  {
    id: 'tasks-from-notes', // Turn notes into task lists in chat (not on page)
    name: 'Tasks from notes', // UI
    systemHint: 'When asked for tasks, output a clear checklist in chat; do not claim to have placed them on the page.', // Hint
    enabled: true,
  },
]

export function getSkill(id: string): AiSkill | undefined { // Lookup by id
  return AI_SKILLS.find((s) => s.id === id) // First match
}

export function skillHintsForIds(ids: string[] | undefined | null): string[] { // Resolve attached skills
  if (!ids?.length) return [] // Nothing attached
  return ids // Caller-provided ids
    .map((id) => getSkill(id)) // Resolve
    .filter((s): s is AiSkill => Boolean(s?.enabled)) // Drop unknown/disabled
    .map((s) => s.systemHint) // Collect hints only
}
