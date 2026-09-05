// Push / pull Notion page body content (blocks ↔ TipTap HTML)

import {
  fetchBlockChildren,
  fetchNotionPageBlockTree,
  type NotionBlock,
} from './blocks'
import { notionPageBodyToHtml } from './blocks-to-html'
import { htmlToNotionBlocks, type NotionBlockCreate } from './html-to-blocks'
import { NOTION_VERSION } from './config'

const NOTION_API = 'https://api.notion.com/v1'

function notionHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

/** Read a Notion page's last_edited_time (ISO). */
export async function fetchNotionPageLastEdited(
  accessToken: string,
  pageId: string
): Promise<string | null> {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'GET',
    headers: notionHeaders(accessToken),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.message || `Failed to retrieve Notion page ${pageId}`)
  }
  return typeof payload.last_edited_time === 'string' ? payload.last_edited_time : null
}

/** Archive every top-level child block on a page (prepare for replace). */
async function archivePageChildren(accessToken: string, pageId: string): Promise<void> {
  const children = await fetchBlockChildren(accessToken, pageId)
  await Promise.all(
    children.map(async (block) => {
      const res = await fetch(`${NOTION_API}/blocks/${block.id}`, {
        method: 'DELETE',
        headers: notionHeaders(accessToken),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.message || `Failed to archive block ${block.id}`)
      }
    })
  )
}

/** Append new blocks as page children (Notion batches up to 100 per request). */
async function appendPageChildren(
  accessToken: string,
  pageId: string,
  children: NotionBlockCreate[]
): Promise<void> {
  if (children.length === 0) return
  const BATCH = 100
  for (let i = 0; i < children.length; i += BATCH) {
    const slice = children.slice(i, i + BATCH)
    const res = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: notionHeaders(accessToken),
      body: JSON.stringify({ children: slice }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(payload?.message || `Failed to append blocks to page ${pageId}`)
    }
  }
}

/** Replace page body in Notion with HTML from Thinktable. */
export async function pushNotionPageBody(
  accessToken: string,
  pageId: string,
  html: string
): Promise<{ lastEditedTime: string | null }> {
  const children = htmlToNotionBlocks(html)
  await archivePageChildren(accessToken, pageId)
  await appendPageChildren(accessToken, pageId, children)
  const lastEditedTime = await fetchNotionPageLastEdited(accessToken, pageId)
  return { lastEditedTime }
}

/** Pull page body from Notion as TipTap HTML. */
export async function pullNotionPageBody(
  accessToken: string,
  pageId: string,
  maxDepth = 4
): Promise<{ html: string; lastEditedTime: string | null; blocks: NotionBlock[] }> {
  const [tree, lastEditedTime] = await Promise.all([
    fetchNotionPageBlockTree(accessToken, pageId, maxDepth),
    fetchNotionPageLastEdited(accessToken, pageId),
  ])
  const html = notionPageBodyToHtml(tree)
  return { html, lastEditedTime, blocks: tree }
}
