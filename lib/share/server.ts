// Shared helpers for page share APIs (ownership, tokens, hashing, rate limits)

import { createHash, randomBytes, timingSafeEqual } from 'crypto' // Crypto primitives
import type { SupabaseClient, User } from '@supabase/supabase-js' // Typed clients
import { getSiteUrl } from '@/lib/notion/config' // Public app origin
import { createAdminClient } from '@/lib/supabase/admin' // Service-role for token lookup
import {
  isBoardAccessRole,
  maxShareRole,
  type BoardAccessRole,
  type ShareRole,
} from '@/lib/share/roles' // Role helpers

const REDEEM_WINDOW_MS = 15 * 60 * 1000 // 15-minute rate-limit window
const REDEEM_MAX_PER_USER = 30 // Max redeem attempts per user per window
const REDEEM_MAX_PER_IP = 60 // Max redeem attempts per IP hash per window

/** Ensure the signed-in user owns this Thinktable page (conversation). */
export async function assertOwnsBoard(
  supabase: SupabaseClient, // User-scoped client (RLS)
  boardId: string, // conversations.id
  userId: string // auth.users.id
): Promise<boolean> {
  const { data, error } = await supabase
    .from('conversations') // Pages table
    .select('id') // Existence only
    .eq('id', boardId) // Target page
    .eq('user_id', userId) // Must be owner
    .maybeSingle() // Zero or one
  return Boolean(!error && data?.id) // Owned when row present
}

/** Resolve access role via SECURITY DEFINER RPC (owner | edit | comment | view | null). */
export async function resolveBoardAccessRole(
  supabase: SupabaseClient, // User-scoped client
  boardId: string // conversations.id
): Promise<BoardAccessRole | null> {
  const { data, error } = await supabase.rpc('user_board_access_role', {
    p_board_id: boardId, // Matches SQL arg name
  })
  if (error) {
    console.error('user_board_access_role failed:', error) // Do not leak details to client
    return null
  }
  return isBoardAccessRole(data) ? data : null // Narrow unknown RPC payload
}

/** Mint an opaque URL-safe share token (192-bit). */
export function mintShareToken(): string {
  return randomBytes(24).toString('base64url') // Unguessable; URL-safe
}

/** SHA-256 hex hash for storing tokens at rest. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex') // One-way
}

/** Reject absurd / non-token strings before hashing (DoS / probe guard). */
export function isPlausibleShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(token) // base64url length band
}

/** Build the public share URL; role is bound server-side via token_hash → role. */
export function buildShareUrl(boardId: string, token: string): string {
  const base = getSiteUrl().replace(/\/$/, '') // Strip trailing slash
  return `${base}/board/${boardId}?s=${encodeURIComponent(token)}` // Opaque ?s=
}

/** Hash client IP for rate-limit keys (never store raw IP). */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null // Unknown
  return createHash('sha256').update(ip, 'utf8').digest('hex') // One-way
}

/** Extract best-effort client IP from standard proxy headers. */
export function clientIpFromRequest(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for') // First hop list
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() // Left-most client
    if (first) return first
  }
  return request.headers.get('x-real-ip') // Alternate proxy header
}

type RedeemResult =
  | { ok: true; role: ShareRole } // Bound grant
  | { ok: false; reason: 'invalid' | 'rate_limited' } // Uniform failure classes

/** Redeem a share link token into a bound people grant for the signed-in user. */
export async function redeemShareToken(opts: {
  boardId: string // Must match link.board_id
  token: string // Raw ?s= value
  user: User // Authenticated redeemer
  request?: Request // Optional — for IP from route handlers
  ip?: string | null // Optional — when redeeming from a Server Component
}): Promise<RedeemResult> {
  const admin = createAdminClient() // Bypass RLS for hashed token lookup
  const ipHash = hashIp(
    opts.ip ?? (opts.request ? clientIpFromRequest(opts.request) : null)
  ) // Rate-limit key
  const since = new Date(Date.now() - REDEEM_WINDOW_MS).toISOString() // Window start

  // Rate limit by user
  const { count: userCount } = await admin
    .from('board_share_redeem_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', opts.user.id)
    .gte('created_at', since)

  if ((userCount ?? 0) >= REDEEM_MAX_PER_USER) {
    await admin.from('board_share_redeem_attempts').insert({
      board_id: opts.boardId,
      user_id: opts.user.id,
      ip_hash: ipHash,
      ok: false,
    })
    return { ok: false, reason: 'rate_limited' }
  }

  // Rate limit by IP hash when present
  if (ipHash) {
    const { count: ipCount } = await admin
      .from('board_share_redeem_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since)
    if ((ipCount ?? 0) >= REDEEM_MAX_PER_IP) {
      await admin.from('board_share_redeem_attempts').insert({
        board_id: opts.boardId,
        user_id: opts.user.id,
        ip_hash: ipHash,
        ok: false,
      })
      return { ok: false, reason: 'rate_limited' }
    }
  }

  // Uniform invalid path for malformed tokens (no DB distinction)
  if (!isPlausibleShareToken(opts.token)) {
    await admin.from('board_share_redeem_attempts').insert({
      board_id: opts.boardId,
      user_id: opts.user.id,
      ip_hash: ipHash,
      ok: false,
    })
    return { ok: false, reason: 'invalid' }
  }

  const tokenHash = hashShareToken(opts.token) // Lookup key
  const { data: link } = await admin
    .from('board_share_links')
    .select('id, board_id, role, token_hash, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle()

  // Constant-ish reject: require page match + valid hash compare
  const pageMatches = Boolean(link && link.board_id === opts.boardId)
  const hashMatches =
    Boolean(link?.token_hash) &&
    timingSafeEqual(
      Buffer.from(link!.token_hash, 'utf8'),
      Buffer.from(tokenHash, 'utf8')
    )

  if (!link || !pageMatches || !hashMatches) {
    await admin.from('board_share_redeem_attempts').insert({
      board_id: opts.boardId,
      user_id: opts.user.id,
      ip_hash: ipHash,
      ok: false,
    })
    return { ok: false, reason: 'invalid' }
  }

  const role = link.role as ShareRole // Attached permission
  const email = (opts.user.email || '').trim().toLowerCase() || null // Bind email when present

  // Attribute grants to the page owner (redeemer is grantee_user_id)
  const { data: pageRow } = await admin
    .from('conversations')
    .select('user_id')
    .eq('id', opts.boardId)
    .maybeSingle()
  const ownerId = pageRow?.user_id || opts.user.id // Fallback shouldn't happen for valid links

  // Upsert bound grant for this user (upgrade role if stronger)
  const { data: existing } = await admin
    .from('board_share_people')
    .select('id, role')
    .eq('board_id', opts.boardId)
    .eq('grantee_user_id', opts.user.id)
    .maybeSingle()

  if (existing?.id) {
    const nextRole = maxShareRole(existing.role as ShareRole, role) || role // Never downgrade
    await admin
      .from('board_share_people')
      .update({
        role: nextRole,
        email: email || undefined, // Refresh email if known
      })
      .eq('id', existing.id)
  } else if (email) {
    // Merge with email-only invite if owner already added this address
    const { data: byEmail } = await admin
      .from('board_share_people')
      .select('id, role')
      .eq('board_id', opts.boardId)
      .ilike('email', email)
      .maybeSingle()

    if (byEmail?.id) {
      const nextRole = maxShareRole(byEmail.role as ShareRole, role) || role
      await admin
        .from('board_share_people')
        .update({
          role: nextRole,
          grantee_user_id: opts.user.id, // Bind account
        })
        .eq('id', byEmail.id)
    } else {
      await admin.from('board_share_people').insert({
        board_id: opts.boardId,
        created_by: ownerId, // Page owner
        role,
        email,
        grantee_user_id: opts.user.id,
        display_name: opts.user.user_metadata?.full_name || email,
      })
    }
  } else {
    await admin.from('board_share_people').insert({
      board_id: opts.boardId,
      created_by: ownerId,
      role,
      grantee_user_id: opts.user.id,
      display_name: opts.user.user_metadata?.full_name || 'Shared user',
    })
  }

  await admin.from('board_share_redeem_attempts').insert({
    board_id: opts.boardId,
    user_id: opts.user.id,
    ip_hash: ipHash,
    ok: true,
  })

  return { ok: true, role }
}

/** Look up a Thinktable user id by email for invite binding. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient() // profiles is readable with service role
  const normalized = email.trim().toLowerCase()
  const { data } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', normalized)
    .maybeSingle()
  return data?.id ?? null
}
