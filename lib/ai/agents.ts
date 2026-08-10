// Agent registry — presets that pick a default mode + skill set
import type { AiModeId } from './modes' // Mode id type

export interface AiAgent { // Named agent persona / preset
  id: string // Stable id stored on thread.metadata.agentId
  name: string // UI label
  defaultMode: AiModeId // Mode applied when starting a chat with this agent
  skillIds: string[] // Skills auto-attached
  description: string // Short help
  enabled: boolean // Selectable today
}

export const AI_AGENTS: AiAgent[] = [ // Seed agents
  {
    id: 'thinktable-copilot', // Default product agent
    name: 'Thinktable Copilot', // Brand
    defaultMode: 'ask', // Sidebar Ask
    skillIds: ['summarize-page'], // Light default
    description: 'General assistant for this page — answers in the sidebar.', // Copy
    enabled: true,
  },
  {
    id: 'notion-research', // Future Notion-connected researcher
    name: 'Notion research', // UI
    defaultMode: 'ask', // Still Ask for now
    skillIds: ['summarize-page'], // Overlaps until connectors ship tools
    description: 'Uses connected Notion context when available.', // Copy
    enabled: false, // Stub until connector tools land
  },
]

export function getAgent(id: string): AiAgent | undefined { // Lookup
  return AI_AGENTS.find((a) => a.id === id) // First match
}

export function defaultAgent(): AiAgent { // Always have a fallback
  return AI_AGENTS[0] // Thinktable Copilot
}
