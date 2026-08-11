// Mint a role-bearing copy link (token hashed at rest; plaintext returned once)

import { NextResponse } from 'next/server' // JSON responses
import { createClient } from '@/lib/supabase/server' // Session + RLS
import { isShareRole, type ShareRole } from '@/lib/share/roles' // Role guard
import {
  assertOwnsBoard,
  buildShareUrl,
  hashShareToken,
  mintShareToken,
} from '@/lib/share/server' // Helpers

type RouteContext = { params: Promise<{ boardId: string }> } // Dynamic route params

export async function POST(request: Request, context: RouteContext) {
  try {
    const { boardId } = await context.params // Target Thinktable page
    const supabase = await createClient() // Cookie session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Require auth

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const owns = await assertOwnsBoard(supabase, boardId, user.id) // Owner-only mint
    if (!owns) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 }) // No existence leak
    }

    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown // Expected ShareRole
      revokeOthers?: unknown // Optional: revoke prior active links for this role
    }

    if (!isShareRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const role = body.role as ShareRole // Narrowed
    const revokeOthers = body.revokeOthers === true // Rotate family

    if (revokeOthers) {
      await supabase
        .from('board_share_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('board_id', boardId)
        .eq('role', role)
        .is('revoked_at', null)
    }

    const token = mintShareToken() // Fresh opaque secret
    const tokenHash = hashShareToken(token) // Store only hash

    const { data: inserted, error } = await supabase
      .from('board_share_links')
      .insert({
        board_id: boardId, // Shared page
        created_by: user.id, // Owner
        role, // Permission attached to this link
        token_hash: tokenHash, // One-way hash at rest
      })
      .select('id, role, created_at')
      .single()

    if (error || !inserted) {
      console.error('Share link mint failed:', error)
      return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 })
    }

    // Plaintext token returned once for clipboard — never persisted
    return NextResponse.json({
      link: {
        id: inserted.id,
        role: inserted.role as ShareRole,
        url: buildShareUrl(boardId, token), // Role-bearing URL
        createdAt: inserted.created_at,
      },
    })
  } catch (error) {
    console.error('Share link POST failed:', error)
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 })
  }
}
