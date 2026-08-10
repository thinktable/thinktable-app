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
    'You may SUGGEST placements or edits, but you must NOT claim you placed or edited anything on the page.',
    'The user places content by dragging chat blocks onto the page.',
    'Be concise unless the user asks for depth.',
  ]
  if (extraSkillHints.length) {
    base.push('Additional skill hints:')
    for (const h of extraSkillHints) base.push(`- ${h}`)
  }
  return base.join('\n')
}

/** Edit-mode system prompt — propose surgical page edits; user reviews before save. */
export function editSystemPrompt(extraSkillHints: string[] = []): string {
  const base = [
    'You are Thinktable Copilot in Edit mode.',
    'Thinktable is a spatial mind-map: pages hold frames; frames hold blocks; threads connect frames.',
    'Propose the SMALLEST possible edits. Prefer one-word or short phrase replacements.',
    'For each edit, use replacements: [{ oldText, newText }] with exact substrings from the frame text.',
    'oldText MUST appear verbatim in the frame text from the context pack. newText is only what changes.',
    'Example: to change "cat" to "dog" in a longer sentence, replacements: [{ "oldText": "cat", "newText": "dog" }] and contentHtml: "".',
    'Do NOT rewrite the whole frame unless the user explicitly asks for a full rewrite.',
    'Only use contentHtml (full frame HTML) as a last resort when a full rewrite is required; otherwise set contentHtml to "".',
    'Prefer editing selected frames when listed. Do not invent frame ids.',
    'Also include a short reply summarizing what you changed.',
    'If nothing should change, return an empty edits array and explain why in reply.',
    'Edits are proposals — the user will review, save, or discard them on the page.',
  ]
  if (extraSkillHints.length) {
    base.push('Additional skill hints:')
    for (const h of extraSkillHints) base.push(`- ${h}`)
  }
  return base.join('\n')
}

