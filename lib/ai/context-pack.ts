// Build a structured context pack for Ask mode (page frames + selection + snapshots)
import type { SupabaseClient } from '@supabase/supabase-js' // Server/browser client

export interface FrameSummary { // Compact frame for the model
  id: string // messages.id
  title: string | null // metadata.blockTitle when present
  text: string // Truncated plain text from content HTML
}

export interface AiContextPack { // Sent as a system/user context block
  pageId: string | null // Current page
  pageTitle: string | null // conversations.title
  frames: FrameSummary[] // Page frame summaries
  selectedFrameIds: string[] // Client selection
  snapshots: Array<{ id: string; name: string; payload: Record<string, unknown> }> // Attached snapshots
}

const MAX_FRAMES = 40 // Cap context size
const MAX_TEXT_CHARS = 800 // Per-frame truncation

/** Strip HTML to plain text for model context. */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return '' // Empty
  return html // Raw HTML
    .replace(/<br\s*\/?>/gi, '\n') // Breaks → newlines
    .replace(/<\/p>/gi, '\n') // Paragraph ends
    .replace(/<[^>]+>/g, '') // Drop tags
    .replace(/&nbsp;/g, ' ') // nbsp
    .replace(/&amp;/g, '&') // amp
    .replace(/&lt;/g, '<') // lt
    .replace(/&gt;/g, '>') // gt
    .replace(/\n{3,}/g, '\n\n') // Collapse blank lines
    .trim() // Edges
}

/** Escape plain text into a single TipTap paragraph for drag-to-page. */
export function plainToHtml(plain: string): string {
  const escaped = plain // User/AI text
    .replace(/&/g, '&amp;') // Escape amp first
    .replace(/</g, '&lt;') // Escape lt
    .replace(/>/g, '&gt;') // Escape gt
    .split(/\n{2,}/) // Paragraphs
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`) // Soft breaks inside
    .join('') // Concat
  return escaped || '<p></p>' // Never empty doc
}

/** Load page title + frame summaries + snapshot payloads for Ask. */
export async function buildContextPack(
  supabase: SupabaseClient, // Authed client
  opts: {
    userId: string // Owner
    pageId?: string | null // Current page
    selectedFrameIds?: string[] // Selection
    snapshotIds?: string[] // Attached snapshot ids
  }
): Promise<AiContextPack> {
  const pageId = opts.pageId || null // Normalize
  let pageTitle: string | null = null // Default
  const frames: FrameSummary[] = [] // Accumulators

  if (pageId) { // Only load page content when associated
    const { data: conv } = await supabase // Page row
      .from('conversations') // Pages table
      .select('id, title, user_id') // Fields
      .eq('id', pageId) // Match
      .eq('user_id', opts.userId) // Ownership
      .maybeSingle() // One or none
    pageTitle = conv?.title ?? null // Title if owned

    if (conv) { // Skip frames if page missing / not owned
      const { data: messages } = await supabase // Frame-bearing messages
        .from('messages') // Page frames live here
        .select('id, content, metadata, role') // Needed fields
        .eq('conversation_id', pageId) // This page
        .order('created_at', { ascending: true }) // Stable order
        .limit(MAX_FRAMES) // Cap

      for (const m of messages || []) { // Map to summaries
        const meta = (m.metadata || {}) as Record<string, unknown> // Metadata bag
        const text = htmlToPlain(m.content).slice(0, MAX_TEXT_CHARS) // Truncate
        if (!text && !meta.blockTitle) continue // Skip empty noise
        frames.push({
          id: m.id, // Frame message id
          title: typeof meta.blockTitle === 'string' ? meta.blockTitle : null, // Optional title
          text, // Plain excerpt
        })
      }
    }
  }

  const snapshots: AiContextPack['snapshots'] = [] // Attached packs
  if (opts.snapshotIds?.length) { // Load only requested
    const { data: rows } = await supabase // Snapshot rows
      .from('ai_context_snapshots') // Snapshots table
      .select('id, name, payload') // Fields
      .eq('user_id', opts.userId) // Own only
      .in('id', opts.snapshotIds) // Filter
    for (const s of rows || []) { // Collect
      snapshots.push({
        id: s.id, // Id
        name: s.name, // Label
        payload: (s.payload || {}) as Record<string, unknown>, // Pack
      })
    }
  }

  return {
    pageId, // Current page
    pageTitle, // Title
    frames, // Summaries
    selectedFrameIds: opts.selectedFrameIds || [], // Selection
    snapshots, // Attached
  }
}

/** Render the pack as a system-side context string for OpenAI. */
export function formatContextPack(pack: AiContextPack): string {
  const lines: string[] = [] // Accumulators
  lines.push('## Current page context') // Header
  lines.push(`Page id: ${pack.pageId ?? '(none)'}`) // Id
  lines.push(`Page title: ${pack.pageTitle ?? '(untitled)'}`) // Title
  if (pack.selectedFrameIds.length) { // Selection section
    lines.push(`Selected frame ids: ${pack.selectedFrameIds.join(', ')}`) // Ids
  }
  if (pack.frames.length) { // Frames
    lines.push('### Frames') // Subhead
    for (const f of pack.frames) { // Each frame
      const title = f.title ? ` (${f.title})` : '' // Optional title
      const mark = pack.selectedFrameIds.includes(f.id) ? ' [selected]' : '' // Mark
      lines.push(`- Frame ${f.id}${title}${mark}: ${f.text || '(empty)'}`) // Line
    }
  } else {
    lines.push('(No frames on this page, or page not provided.)') // Empty
  }
  if (pack.snapshots.length) { // Snapshots
    lines.push('### Attached context snapshots') // Subhead
    for (const s of pack.snapshots) { // Each
      lines.push(`- Snapshot "${s.name}" (${s.id}): ${JSON.stringify(s.payload).slice(0, 2000)}`) // Cap JSON
    }
  }
  return lines.join('\n') // Join
}

/** Ask-mode system prompt — answers in chat; never claims to have placed on the page. */
export function askSystemPrompt(extraSkillHints: string[] = []): string {
  const base = [
    'You are Thinktable Copilot in Ask mode.',
    'Thinktable is a spatial mind-map: pages hold frames; frames hold blocks; threads connect frames.',
    'Respond helpfully in the chat sidebar using clear markdown.',
    'You cannot place, create, edit, or link anything on the page in Ask mode.',
    'Never claim you created frames, linked threads, or edited page content.',
    'If the user asks you to create/link/edit on the page, tell them to switch the mode toggle to Edit.',
    'The user can also place chat text by dragging a chat turn onto the page.',
    'Be concise unless the user asks for depth.',
  ]
  if (extraSkillHints.length) {
    base.push('Additional skill hints:')
    for (const h of extraSkillHints) base.push(`- ${h}`)
  }
  return base.join('\n')
}

/** Edit-mode system prompt — propose page creates/edits/threads; user reviews before save. */
export function editSystemPrompt(extraSkillHints: string[] = []): string {
  const base = [
    'You are Thinktable Copilot in Edit mode.',
    'Thinktable is a spatial mind-map: pages hold frames; frames hold blocks; threads connect frames.',
    'Return JSON with reply, capabilityGap, edits, creates, and threads (arrays may be empty; capabilityGap is "" when none).',
    '',
    'CAPABILITY GAPS — ask before approximating:',
    '- If the user asks for something you cannot do exactly, set capabilityGap to a short plain explanation of what is missing and the closest alternative.',
    '- In that case: leave edits, creates, and threads EMPTY. Put the offer in reply (what you can do instead) and ask them to confirm before you change the page.',
    '- Examples of unsupported / approximate:',
    '  • Real spreadsheet/data tables → no table extension; closest = checkbox checklist (task list) with "Label — detail" text.',
    '  • Notion database embeds, drawings, shapes, flashcards → say you cannot create those yet.',
    '- Only after the user confirms (e.g. "yes", "do it", "go ahead") may you fill edits/creates/threads with the approximation. Then set capabilityGap to "".',
    '- Small supported requests (create frames, link them, edit text, bullet/numbered/checklist lists) → capabilityGap "" and proceed immediately.',
    '',
    'CRITICAL — prefer edits over creates:',
    '- If the user asks to change, reformat, or improve something that already exists on the page, use edits[] with that frame\'s real id from the context pack.',
    '- NEVER create a duplicate frame for content that already exists (e.g. "make ingredients a checklist" → edit the ingredients frame; do not create a second ingredients frame).',
    '- Only use creates[] when the user asks for NEW frames that are not already on the page.',
    '',
    'UPDATE existing frames via edits[]:',
    '- Prefer the SMALLEST possible change: replacements [{ oldText, newText }] with exact substrings from the frame text.',
    '- oldText MUST appear verbatim in the frame text from the context pack.',
    '- Prefer editing selected frames when listed. Do not invent real frame ids.',
    '- Structure/format changes (bullet→checklist, major rewrite) → set contentHtml to the FULL new TipTap HTML and replacements: [].',
    '- Otherwise set contentHtml to "".',
    '',
    'TipTap HTML for structured content (use in contentHtml, or as contentMarkdown for creates — server converts markdown):',
    '- Checklist / todo / checkbox: TipTap task list (each item is its own block with a ⋮⋮ handle).',
    '  Example: <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>1 cup flour</p></div></li></ul>',
    '- Or markdown checkboxes: - [ ] 1 cup flour',
    '- Numbered steps: 1. Mix dry ingredients',
    '- Bullets: - item',
    '- Never emit markdown | pipe | tables as final content; that is a capability gap (offer checklist instead).',
    '',
    'CREATE new frames via creates[] only for genuinely new frames:',
    '- Invent sensible content when the user says to make it up.',
    '- Each create needs a short tempId (e.g. "a", "b"), title (short label), contentMarkdown (body), summary.',
    '- Put the main text in contentMarkdown. For checklists use "- [ ] item" lines.',
    '- Do NOT invent real UUID frame ids for creates — only tempIds.',
    '',
    'LINK frames via threads[]:',
    '- sourceTempId / targetTempId may be a creates[].tempId OR an existing frame UUID from the context pack.',
    '- Use threads when the user asks to link / connect / relate frames.',
    '- Do not create a new frame just to form a link — link to the existing frame id.',
    '',
    'Also include a short reply summarizing what you proposed (or the capability-gap offer).',
    'If nothing should change, leave edits/creates/threads empty and explain in reply.',
    'Proposals appear on the page for the user to Save or Remove.',
  ]
  if (extraSkillHints.length) {
    base.push('Additional skill hints:')
    for (const h of extraSkillHints) base.push(`- ${h}`)
  }
  return base.join('\n')
}

