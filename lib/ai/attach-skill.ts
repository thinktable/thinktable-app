// Open AI chat with a skill pill attached (composer + menu popup).

export type AiAttachSkillDetail = {
  skillId: string
  mode?: 'ask' | 'edit'
  prompt?: string
}

export const AI_ATTACH_SKILL_EVENT = 'thinktable-ai-attach-skill'

/** Open chat, attach the skill, optionally seed the composer. */
export function requestAiSkill(detail: AiAttachSkillDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AiAttachSkillDetail>(AI_ATTACH_SKILL_EVENT, { detail }))
}
