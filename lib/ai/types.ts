// Shared AI types for API + UI (mirror DB columns without generated types yet)
import type { AiModeId } from './modes' // Mode enum

export interface AiThread { // Row shape for ai_threads
  id: string // UUID
  user_id: string // Owner
  title: string // Display title
  mode: AiModeId // ask | plan | edit
  page_id: string | null // Optional page association
  metadata: Record<string, unknown> // agentId, skillIds, ...
  created_at: string // ISO
  updated_at: string // ISO
}

export type AiMessageRole = 'user' | 'assistant' | 'system' | 'tool' // Role check
export type AiMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' // Status check

export interface AiMessagePart { // Structured chunk for drag-to-page
  type: 'text' // Only text parts in this slice
  text: string // Plain / markdown text
}

export interface AiMessage { // Row shape for ai_messages
  id: string // UUID
  thread_id: string // Parent
  user_id: string // Owner
  role: AiMessageRole // Role
  content: string // Body
  parts: AiMessagePart[] // Drag blocks
  parent_id: string | null // Branching later
  status: AiMessageStatus // Lifecycle
  metadata: Record<string, unknown> // Extra
  created_at: string // ISO
  updated_at: string // ISO
}

export interface AiContextSnapshot { // Row shape for ai_context_snapshots
  id: string // UUID
  user_id: string // Owner
  thread_id: string | null // Origin thread
  message_id: string | null // Anchor turn
  name: string // Label
  payload: Record<string, unknown> // Packed context
  created_at: string // ISO
  updated_at: string // ISO
}

/** DnD MIME for dragging a chat turn onto the page as a frame. */
export const AI_CHAT_BLOCK_MIME = 'application/tt-ai-chat-block' // Custom MIME

export interface AiChatBlockDragPayload { // Serialized drag data
  source: 'ai-chat-block' // Discriminator
  messageId: string // Origin turn
  plain: string // Plain text
  html: string // TipTap-ready HTML
  role?: 'user' | 'assistant' | 'system' | 'tool' // So page drop only marks AI responses
}

/** SSE event shapes for /api/ai/chat streaming. */
export type AiProposedEditKind = 'update_frame' | 'create_frame' | 'create_thread'

export type AiProposedEdit = {
  kind?: AiProposedEditKind // Default update_frame for legacy
  frameId?: string // messages.id for update/create_frame
  edgeId?: string // panel_edges.id for create_thread
  tempId?: string // Model temp id for creates (debug / linking)
  sourceFrameId?: string // create_thread source message id
  targetFrameId?: string // create_thread target message id
  contentHtml?: string
  summary: string
  actionLogId?: string
  originalContent?: string
  replacements?: Array<{ oldText: string; newText: string }>
}

export type AiStreamEvent =
  | { type: 'message'; message: AiMessage }
  | { type: 'text'; text: string }
  | { type: 'edits'; edits: AiProposedEdit[] }
  | { type: 'done'; message: AiMessage }
  | { type: 'error'; error: string }
