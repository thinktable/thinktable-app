'use client'

// Customize agent panel — opened from the chat brand mark (instructions / skills / connections)
import { useCallback, useEffect, useState } from 'react' // Draft hydrate + Notion workspace name
import {
  Check,
  ChevronLeft,
  Link2,
  Plus,
  Sparkles,
  Wrench,
} from 'lucide-react' // Section + action glyphs
import { ThinktableBrandMark } from '@/components/personalize-ai-modal' // Agent icon (top-left)
import {
  AI_CONNECTORS,
  type AiConnector,
} from '@/lib/ai/connectors' // Connections list
import {
  createBlankAgentDraft,
  createWorkspaceAgentDraft,
  defaultWorkspaceAgentName,
  loadAgentDrafts,
  saveAgentDrafts,
  WORKSPACE_AGENT_ID,
  type AiAgentDraft,
} from '@/lib/ai/agents' // Draft model + storage
import { AI_SKILLS, type AiSkill } from '@/lib/ai/skills' // Skills toggles
import { cn } from '@/lib/utils' // Class merge

type CustomizeAgentPanelProps = {
  open: boolean // Shown when the chat brand mark is clicked
  onClose: () => void // Back to the transcript
  sharedDrawingUrl: string | null // Workspace brand mark (default agent icon)
  /** Open personalize for this draft id (workspace → shared logo; custom → draft icon). */
  onRequestPersonalize: (draftId: string) => void
  /** Bump after personalize Done so custom-agent icons reload from storage. */
  iconRevision?: number
}

/** True when the name is still a stock "(…) ThinkTable agent" label. */
function isDefaultWorkspaceLabel(name: string): boolean {
  return /^\([^)]*\)\s*ThinkTable agent$/.test(name.trim()) // Stock pattern only
}

/** Merge saved drafts with a guaranteed workspace default row. */
function hydrateDrafts(workspaceName: string | null): AiAgentDraft[] {
  const saved = loadAgentDrafts() // localStorage
  const workspace =
    saved.find((d) => d.id === WORKSPACE_AGENT_ID) ??
    createWorkspaceAgentDraft(workspaceName) // Seed if missing
  // Refresh Notion workspace label while the name is still the stock default
  if (workspace.isWorkspaceDefault && isDefaultWorkspaceLabel(workspace.name)) {
    workspace.name = defaultWorkspaceAgentName(workspaceName)
  }
  const others = saved.filter((d) => d.id !== WORKSPACE_AGENT_ID) // Custom agents
  return [workspace, ...others]
}

export function CustomizeAgentPanel({
  open,
  onClose,
  sharedDrawingUrl,
  onRequestPersonalize,
  iconRevision = 0,
}: CustomizeAgentPanelProps) {
  const [workspaceName, setWorkspaceName] = useState<string | null>(null) // Notion label
  const [drafts, setDrafts] = useState<AiAgentDraft[]>([]) // All agents
  const [activeId, setActiveId] = useState(WORKSPACE_AGENT_ID) // Currently editing
  const [hydrated, setHydrated] = useState(false) // Avoid flash before load

  // Load Notion workspace name once when the panel opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/notion/status') // Same status as Connections
        if (!res.ok) return
        const data = (await res.json()) as { workspaceName?: string | null; connected?: boolean }
        if (!cancelled && data.connected) setWorkspaceName(data.workspaceName ?? null)
      } catch {
        // Offline — keep literal "workspace"
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Hydrate drafts when opened (re-read storage + workspace name + icon saves)
  useEffect(() => {
    if (!open) {
      setHydrated(false)
      return
    }
    const next = hydrateDrafts(workspaceName)
    setDrafts(next)
    setActiveId((prev) => (next.some((d) => d.id === prev) ? prev : WORKSPACE_AGENT_ID))
    setHydrated(true)
  }, [open, workspaceName, iconRevision])

  const active = drafts.find((d) => d.id === activeId) ?? drafts[0] // Editing target

  /** Persist drafts whenever they change while the panel is open. */
  const commit = useCallback((next: AiAgentDraft[]) => {
    setDrafts(next)
    saveAgentDrafts(next)
  }, [])

  const patchActive = useCallback(
    (patch: Partial<AiAgentDraft>) => {
      if (!active) return
      commit(drafts.map((d) => (d.id === active.id ? { ...d, ...patch } : d)))
    },
    [active, commit, drafts]
  )

  const toggleSkill = (skill: AiSkill) => {
    if (!active) return
    const has = active.skillIds.includes(skill.id)
    patchActive({
      skillIds: has
        ? active.skillIds.filter((id) => id !== skill.id)
        : [...active.skillIds, skill.id],
    })
  }

  const toggleConnector = (connector: AiConnector) => {
    if (!active || !connector.enabled) return // Disabled stubs stay off
    const has = active.connectorIds.includes(connector.id)
    patchActive({
      connectorIds: has
        ? active.connectorIds.filter((id) => id !== connector.id)
        : [...active.connectorIds, connector.id],
    })
  }

  /** Create new + → blank draft + personalize popup for the icon. */
  const handleCreateNew = () => {
    const blank = createBlankAgentDraft()
    commit([...drafts, blank])
    setActiveId(blank.id)
    onRequestPersonalize(blank.id) // Current personalize draw modal
  }

  /** Icon in the header opens personalize for the active draft. */
  const handleIconClick = () => {
    if (!active) return
    onRequestPersonalize(active.id)
  }

  if (!open || !hydrated || !active) return null

  const iconUrl = active.isWorkspaceDefault
    ? sharedDrawingUrl
    : active.iconDrawing ?? sharedDrawingUrl

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-[#0f0f0f]">
      {/* Back to chat */}
      <div className="flex-shrink-0 flex items-center px-2 h-9">
        <button
          type="button"
          onClick={onClose}
          className="h-7 px-1.5 rounded-md flex items-center gap-0.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          aria-label="Back to chat"
        >
          <ChevronLeft className="h-4 w-4" />
          Chat
        </button>
      </div>

      {/* Icon top-left + name + Create new + */}
      <div className="flex-shrink-0 flex items-center gap-2.5 px-4 pb-3">
        <button
          type="button"
          onClick={handleIconClick}
          className="flex-shrink-0 rounded-full overflow-visible focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 opacity-95 hover:opacity-100 transition-opacity"
          title="Personalize icon"
          aria-label="Personalize agent icon"
        >
          <ThinktableBrandMark drawingUrl={iconUrl} size={40} />
        </button>
        <input
          type="text"
          value={active.name}
          onChange={(e) => patchActive({ name: e.target.value })}
          className={cn(
            'flex-1 min-w-0 bg-transparent text-[15px] font-semibold tracking-tight',
            'text-gray-900 dark:text-gray-50 outline-none',
            'placeholder:text-gray-400'
          )}
          placeholder="(workspace) ThinkTable agent"
          aria-label="Agent name"
        />
        <button
          type="button"
          onClick={handleCreateNew}
          className="flex-shrink-0 h-8 px-2.5 rounded-md flex items-center gap-1 text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] border border-black/10 dark:border-white/10"
          title="Create new agent"
          aria-label="Create new agent"
        >
          Create new
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {/* Agent switcher when more than the workspace default exists */}
      {drafts.length > 1 && (
        <div className="flex-shrink-0 px-4 pb-2 flex gap-1.5 overflow-x-auto">
          {drafts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              className={cn(
                'flex-shrink-0 max-w-[160px] truncate text-xs px-2.5 py-1 rounded-full border transition-colors',
                d.id === active.id
                  ? 'bg-black/[0.08] dark:bg-white/[0.12] border-black/15 dark:border-white/20 text-gray-900 dark:text-gray-50'
                  : 'bg-transparent border-black/8 dark:border-white/10 text-gray-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              )}
              title={d.name}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-5">
        {/* Instructions */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Instructions
            </h3>
          </div>
          <textarea
            value={active.instructions}
            onChange={(e) => patchActive({ instructions: e.target.value })}
            placeholder="How should this agent behave? Tone, priorities, what to avoid…"
            rows={6}
            className={cn(
              'w-full resize-y rounded-lg px-3 py-2.5 text-sm leading-relaxed',
              'bg-white dark:bg-[#1a1a1a]',
              'border border-black/10 dark:border-white/10',
              'text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
              'outline-none focus:ring-2 focus:ring-blue-500/30'
            )}
          />
        </section>

        {/* Skills */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wrench className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Skills
            </h3>
          </div>
          <ul className="flex flex-col gap-1 rounded-lg border border-black/10 dark:border-white/10 overflow-hidden bg-white dark:bg-[#1a1a1a]">
            {AI_SKILLS.filter((s) => s.enabled).map((skill) => {
              const on = active.skillIds.includes(skill.id)
              return (
                <li key={skill.id} className="border-b border-black/5 dark:border-white/10 last:border-0">
                  <button
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                        on
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-gray-300 dark:border-gray-600'
                      )}
                      aria-hidden
                    >
                      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-50">
                        {skill.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {skill.description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Connections */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link2 className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Connections
            </h3>
          </div>
          <ul className="flex flex-col gap-1 rounded-lg border border-black/10 dark:border-white/10 overflow-hidden bg-white dark:bg-[#1a1a1a]">
            {AI_CONNECTORS.map((connector) => {
              const on = active.connectorIds.includes(connector.id)
              const disabled = !connector.enabled
              return (
                <li key={connector.id} className="border-b border-black/5 dark:border-white/10 last:border-0">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleConnector(connector)}
                    className={cn(
                      'w-full flex items-start gap-2.5 px-3 py-2.5 text-left',
                      disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                        on
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-gray-300 dark:border-gray-600'
                      )}
                      aria-hidden
                    >
                      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-50 flex items-center gap-2">
                        {connector.name}
                        {disabled && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-normal">
                            Soon
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {connector.description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Default mode */}
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1.5">
            Default mode
          </h3>
          <div className="flex gap-1.5">
            {(['ask', 'edit'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patchActive({ defaultMode: mode })}
                className={cn(
                  'flex-1 h-9 rounded-lg text-sm font-medium capitalize border transition-colors',
                  active.defaultMode === mode
                    ? 'bg-black/[0.08] dark:bg-white/[0.12] border-black/15 dark:border-white/20 text-gray-900 dark:text-gray-50'
                    : 'bg-white dark:bg-[#1a1a1a] border-black/10 dark:border-white/10 text-gray-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
