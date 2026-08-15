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

/** Editable customize-panel draft (UI-first; not yet wired into /api/ai/chat). */
export interface AiAgentDraft {
  id: string // Stable client id
  name: string // Header name — default "(workspace) ThinkTable agent"
  instructions: string // System-style instructions textarea
  skillIds: string[] // Attached skill ids from AI_SKILLS
  connectorIds: string[] // Attached connector ids from AI_CONNECTORS
  defaultMode: 'ask' | 'edit' // Composer mode when chatting with this agent
  iconDrawing: string | null // Optional per-agent PNG; null = shared brand mark
  isWorkspaceDefault: boolean // True for the built-in workspace agent
}

/** localStorage key for customize drafts */
export const TT_AI_AGENT_DRAFTS_KEY = 'thinktable-ai-agent-drafts'

/** Built-in workspace agent id (always present as the default customize target). */
export const WORKSPACE_AGENT_ID = 'workspace-thinktable-agent'

/** Default display name — `(workspace) ThinkTable agent`, or Notion workspace when known. */
export function defaultWorkspaceAgentName(workspaceName?: string | null): string {
  const ws = (workspaceName || '').trim() || 'workspace' // Literal fallback when no Notion name
  return `(${ws}) ThinkTable agent` // Product default label
}

/** Fresh draft for Create new + (personalize popup sets iconDrawing). */
export function createBlankAgentDraft(): AiAgentDraft {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `agent-${Date.now()}`, // Client UUID
    name: 'Untitled agent', // Editable until the user renames
    instructions: '', // Empty instructions
    skillIds: [], // No skills yet
    connectorIds: [], // No connections yet
    defaultMode: 'ask', // Sidebar Ask
    iconDrawing: null, // Personalize modal fills this on Create new
    isWorkspaceDefault: false, // Custom agent
  }
}

/** Seed the workspace default agent (shared brand mark; summarize skill on). */
export function createWorkspaceAgentDraft(workspaceName?: string | null): AiAgentDraft {
  return {
    id: WORKSPACE_AGENT_ID, // Stable default id
    name: defaultWorkspaceAgentName(workspaceName), // "(workspace) ThinkTable agent"
    instructions: '', // Empty until the user writes instructions
    skillIds: ['summarize'], // Light default like AI_AGENTS[0]
    connectorIds: [], // Connections opted in via the panel
    defaultMode: 'ask', // Sidebar Ask
    iconDrawing: null, // Uses shared logoDrawing from personalize
    isWorkspaceDefault: true, // Built-in
  }
}

export function loadAgentDrafts(): AiAgentDraft[] {
  if (typeof window === 'undefined') return [] // SSR
  try {
    const raw = localStorage.getItem(TT_AI_AGENT_DRAFTS_KEY) // Persisted JSON
    if (!raw) return [] // Nothing saved
    const parsed = JSON.parse(raw) as AiAgentDraft[] // Trust shape for UI
    return Array.isArray(parsed) ? parsed : [] // Guard non-array
  } catch {
    return [] // Corrupt storage
  }
}

export function saveAgentDrafts(drafts: AiAgentDraft[]): void {
  if (typeof window === 'undefined') return // SSR
  try {
    localStorage.setItem(TT_AI_AGENT_DRAFTS_KEY, JSON.stringify(drafts)) // Persist all drafts
  } catch {
    // Quota / private mode — ignore
  }
}

export const AI_AGENTS: AiAgent[] = [ // Seed agents
  {
    id: 'thinktable-copilot', // Default product agent
    name: 'Thinktable Copilot', // Brand
    defaultMode: 'ask', // Sidebar Ask
    skillIds: ['summarize'], // Light default
    description: 'General assistant for this board — answers in the sidebar.', // Copy
    enabled: true,
  },
  {
    id: 'notion-research', // Future Notion-connected researcher
    name: 'Notion research', // UI
    defaultMode: 'ask', // Still Ask for now
    skillIds: ['summarize'], // Overlaps until connector tools land
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
