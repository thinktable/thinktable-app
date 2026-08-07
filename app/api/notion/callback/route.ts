// Notion OAuth callback — exchange code, persist connection, import pages onto open/new board

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeNotionCode } from '@/lib/notion/oauth'
import { getSiteUrl } from '@/lib/notion/config'

export async function GET(request: NextRequest) {
  const siteUrl = getSiteUrl() // Canonical origin for safe redirects
  try {
    const errorParam = request.nextUrl.searchParams.get('error') // User cancelled or Notion error
    if (errorParam) {
      return NextResponse.redirect(`${siteUrl}/?notion=error&reason=${encodeURIComponent(errorParam)}`) // Surface cancel
    }

    const code = request.nextUrl.searchParams.get('code') // Temporary authorization code
    const state = request.nextUrl.searchParams.get('state') // CSRF + return path
    const cookieState = request.cookies.get('notion_oauth_state')?.value // Cookie set in /auth

    if (!code || !state || !cookieState || state !== cookieState) {
      return NextResponse.redirect(`${siteUrl}/?notion=error&reason=invalid_state`) // Reject CSRF / missing code
    }

    let returnTo = '/' // Default landing if state lacks path
    let stateUserId: string | null = null // User id baked into state
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
        returnTo?: string
        userId?: string
      }
      if (parsed.returnTo && parsed.returnTo.startsWith('/')) {
        returnTo = parsed.returnTo // Only allow relative paths
      }
      stateUserId = parsed.userId || null // Compare to session
    } catch {
      return NextResponse.redirect(`${siteUrl}/?notion=error&reason=bad_state`) // Malformed state
    }

    const supabase = await createClient() // Session client
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Must still be signed in

    if (userError || !user || (stateUserId && stateUserId !== user.id)) {
      return NextResponse.redirect(`${siteUrl}/login?next=/api/notion/auth`) // Re-auth then retry
    }

    const token = await exchangeNotionCode(code) // Trade code for access token
    const admin = createAdminClient() // Bypass RLS to write secrets

    const { error: upsertError } = await admin.from('notion_connections').upsert(
      {
        user_id: user.id, // Thinktable owner
        access_token: token.access_token, // Secret token
        refresh_token: token.refresh_token ?? null, // Optional refresh
        workspace_id: token.workspace_id ?? null, // Workspace id
        workspace_name: token.workspace_name ?? null, // Display name
        workspace_icon: token.workspace_icon ?? null, // Icon
        bot_id: token.bot_id ?? null, // Bot id
        duplicated_template_id: token.duplicated_template_id ?? null, // Template if any
        owner: token.owner ?? null, // Owner blob
        raw_token_response: token, // Full payload for future fields
        updated_at: new Date().toISOString(), // Touch timestamp
      },
      { onConflict: 'user_id' } // Reconnect replaces prior install
    )

    if (upsertError) {
      console.error('Failed to store Notion connection:', upsertError) // DB failure
      return NextResponse.redirect(`${siteUrl}/?notion=error&reason=store_failed`)
    }

    // After connect, land on the board and open the page picker (don't auto-dump every page)
    let boardId: string | null = null
    try {
      const match = returnTo.match(/^\/board\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
      if (match) {
        const { data: existing } = await admin
          .from('conversations')
          .select('id, user_id')
          .eq('id', match[1])
          .maybeSingle()
        if (existing && existing.user_id === user.id) boardId = existing.id
      }
      if (!boardId) {
        const { data: created } = await admin
          .from('conversations')
          .insert({
            user_id: user.id,
            title: token.workspace_name || 'Notion',
            metadata: { position: -1, source: 'notion' },
          })
          .select('id')
          .single()
        boardId = created?.id ?? null
      }
    } catch (boardError) {
      console.error('Notion board resolve failed:', boardError)
    }

    const destPath = boardId ? `/board/${boardId}` : returnTo.startsWith('/board') ? returnTo : '/board'
    const dest = new URL(destPath, siteUrl)
    dest.searchParams.set('notion', 'connected') // Triggers connected UI refresh
    dest.searchParams.set('picker', '1') // Opens import modal with page tree
    const response = NextResponse.redirect(dest.toString())
    response.cookies.set('notion_oauth_state', '', { path: '/', maxAge: 0 })
    return response
  } catch (error) {
    console.error('Notion callback failed:', error) // Log exchange errors
    return NextResponse.redirect(`${siteUrl}/?notion=error&reason=callback_failed`)
  }
}
