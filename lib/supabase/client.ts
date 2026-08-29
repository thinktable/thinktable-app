'use client'

import { createBrowserClient } from '@supabase/ssr'

// One board load used to issue ~97 requests / 14.5s of cumulative network time, because this factory
// built a *new* client per call (23 call sites in board-flow alone, 10 more inside the per-frame
// ChatPanelNode). Each client carries its own GoTrue instance and session fetch, so the same row was
// read over and over: 15 identical `profiles?select=metadata` GETs all starting in the same
// millisecond, 19 `conversations?select=metadata`, 25 `/auth/v1/user`. Two changes fix that without
// touching a single call site: share one client, and collapse identical in-flight GETs.

type FetchArgs = Parameters<typeof fetch>

const inflight = new Map<string, Promise<Response>>() // Identical GETs still awaiting a response

/** Request key: same URL + same identity/shape headers ⇒ same response. */
function coalesceKey(url: string, init?: RequestInit): string | null {
  const method = (init?.method || 'GET').toUpperCase()
  if (method !== 'GET') return null // Never dedupe writes
  if (init?.signal) return null // One caller aborting must not reject the others sharing the promise
  const h = new Headers(init?.headers)
  // Authorization/apikey scope the row set (RLS); Prefer/Range/Accept change the body shape.
  return [
    url,
    h.get('authorization') || '',
    h.get('apikey') || '',
    h.get('prefer') || '',
    h.get('range') || '',
    h.get('accept') || '',
  ].join('\n')
}

/**
 * Collapse concurrent identical GETs into one network request.
 * In-flight only — nothing is cached past resolution, so a read after a write is never stale.
 */
function coalescingFetch(...args: FetchArgs): Promise<Response> {
  const [input, init] = args
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const key = coalesceKey(url, init)
  if (!key) return fetch(...args)
  const pending = inflight.get(key)
  // Response bodies read once — hand every caller its own clone and keep the original untouched.
  if (pending) return pending.then((res) => res.clone())
  const request = fetch(...args).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, request)
  return request.then((res) => res.clone())
}

// Generics spelled out: passing a third options argument stops inference from defaulting Database to
// `any` / schema to 'public', and every call site is typed against the default-schema client.
type BrowserClient = ReturnType<typeof createBrowserClient<any, 'public'>>

let browserClient: BrowserClient | null = null

const USER_TTL_MS = 15_000 // Identity only; auth state changes invalidate immediately

export function createClient(): BrowserClient {
  if (browserClient) return browserClient
  const client = createBrowserClient<any, 'public'>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: coalescingFetch } }
  )

  // `getUser()` always revalidates against /auth/v1/user, and near enough every mount effect awaits it
  // before its real query — 25 round trips (1.8s) per board load. GoTrue serializes them behind its
  // own lock, so they never overlap and the fetch coalescer above can't see them; memoize here
  // instead. Explicit-JWT calls bypass the cache, and any auth transition clears it.
  type GetUser = typeof client.auth.getUser
  const passthrough = client.auth.getUser.bind(client.auth) as GetUser
  let cached: { at: number; value: Awaited<ReturnType<GetUser>> } | null = null
  let pending: ReturnType<GetUser> | null = null
  client.auth.getUser = ((jwt?: string) => {
    if (jwt) return passthrough(jwt)
    if (cached && Date.now() - cached.at < USER_TTL_MS) return Promise.resolve(cached.value)
    if (pending) return pending
    pending = passthrough().then(
      (value) => {
        cached = { at: Date.now(), value }
        pending = null
        return value
      },
      (error) => {
        pending = null
        throw error
      }
    )
    return pending
  }) as GetUser
  client.auth.onAuthStateChange(() => {
    cached = null // Sign in / out / token refresh — never serve the previous identity
    pending = null
  })

  browserClient = client
  return browserClient
}
