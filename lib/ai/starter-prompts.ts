// Suggested prompts for an empty AI chat — compact bars seed the composer
export interface AiStarterPrompt {
  id: string // Stable key for the bar / list row
  label: string // Truncated row text in the hover list
  prompt: string // Full text inserted into the composer
}

export const AI_STARTER_PROMPTS: AiStarterPrompt[] = [
  {
    id: 'summarize', // Skill-aligned starter
    label: 'Summarize this board', // Short list label
    prompt: 'Summarize this board.', // Composer seed
  },
  {
    id: 'tasks', // Skill-aligned starter
    label: 'Turn notes into tasks', // Short list label
    prompt: 'Turn the notes on this board into a task list.', // Composer seed
  },
  {
    id: 'search', // Skill-aligned starter
    label: 'What stands out here', // Short list label
    prompt: 'What stands out across the frames on this board?', // Composer seed
  },
  {
    id: 'next', // Follow-up planning starter
    label: 'What should I do next', // Short list label
    prompt: 'What should I do next on this board?', // Composer seed
  },
  {
    id: 'gaps', // Gap-finding starter
    label: 'Find gaps on this board', // Short list label
    prompt: 'What gaps or missing pieces stand out on this board?', // Composer seed
  },
  {
    id: 'structure', // Structure starter
    label: 'Explain how this board is structured', // Short list label
    prompt: 'Explain how this board is structured and how the frames relate.', // Composer seed
  },
]
