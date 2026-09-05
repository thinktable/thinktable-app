'use client'

// Connected frames always push Thinktable → Notion (debounced).
// Notion → Thinktable is detect-only (notification UI designed later).

import { useCallback, useEffect, useRef } from 'react'

const PUSH_DEBOUNCE_MS = 2000
const DETECT_INTERVAL_MS = 60_000

export function useNotionPageBodySync(opts: {
  pageId: string | null
  lastEditedTime: string | null | undefined
  onNotionUpdatesAvailable: (payload: { lastEditedTime: string }) => void
  onLastEditedTime: (iso: string) => void
}) {
  const { pageId, lastEditedTime, onNotionUpdatesAvailable, onLastEditedTime } = opts

  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPushedHtmlRef = useRef<string | null>(null)
  const detectingRef = useRef(false)
  const pushingRef = useRef(false)

  const detectUpdates = useCallback(async () => {
    if (!pageId || detectingRef.current) return
    detectingRef.current = true
    try {
      const res = await fetch(`/api/notion/page/${encodeURIComponent(pageId)}/content`)
      const json = (await res.json().catch(() => ({}))) as {
        lastEditedTime?: string | null
        error?: string
      }
      if (!res.ok) {
        console.warn('Notion page update check failed:', json.error)
        return
      }
      const remoteTime = json.lastEditedTime ?? null
      if (!remoteTime) return
      if (lastEditedTime && remoteTime <= lastEditedTime) return
      onNotionUpdatesAvailable({ lastEditedTime: remoteTime })
    } finally {
      detectingRef.current = false
    }
  }, [pageId, lastEditedTime, onNotionUpdatesAvailable])

  const push = useCallback(
    async (htmlToPush: string) => {
      if (!pageId) return
      if (pushingRef.current) return
      if (htmlToPush === lastPushedHtmlRef.current) return
      pushingRef.current = true
      try {
        const res = await fetch(`/api/notion/page/${encodeURIComponent(pageId)}/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: htmlToPush }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          lastEditedTime?: string | null
          error?: string
        }
        if (!res.ok) {
          console.warn('Notion page push failed:', json.error)
          return
        }
        lastPushedHtmlRef.current = htmlToPush
        if (json.lastEditedTime) onLastEditedTime(json.lastEditedTime)
      } finally {
        pushingRef.current = false
      }
    },
    [pageId, onLastEditedTime]
  )

  const schedulePush = useCallback(
    (htmlToPush: string) => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
      pushTimerRef.current = setTimeout(() => {
        void push(htmlToPush)
      }, PUSH_DEBOUNCE_MS)
    },
    [push]
  )

  useEffect(() => {
    if (!pageId) return
    void detectUpdates()
    const intervalId = setInterval(() => void detectUpdates(), DETECT_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [pageId, detectUpdates])

  useEffect(() => {
    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    }
  }, [])

  return { schedulePush, detectUpdates }
}
