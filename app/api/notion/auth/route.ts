// Start Notion OAuth — redirects user to Notion's Mindmap.so-style connect screen

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildNotionAuthorizeUrl, isNotionOAuthConfigured } from '@/lib/notion/config'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  try {
    if (!isNotionOAuthConfigured()) {
      return NextResponse.json(
        { error: 'Notion OAuth is not configured. Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env.local.' },
        { status: 503 }
      ) // Block start until secrets exist
    }

    const supabase = await createClient() // Cookie session client
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Require signed-in Thinktable user

    if (userError || !user) {
      const loginUrl = new URL('/login', request.url) // Send anonymous users to login
      loginUrl.searchParams.set('next', '/api/notion/auth') // Resume Notion connect after login
      return NextResponse.redirect(loginUrl) // Redirect instead of 401 for browser nav
    }

    const returnTo = request.nextUrl.searchParams.get('returnTo') || '/' // Where to land after connect
    const nonce = randomBytes(16).toString('hex') // CSRF nonce
    const state = Buffer.from(JSON.stringify({ nonce, returnTo, userId: user.id })).toString('base64url') // Opaque state blob

    const authorizeUrl = buildNotionAuthorizeUrl(state) // Notion-hosted OAuth UI
    const response = NextResponse.redirect(authorizeUrl) // Leave Thinktable for Notion
    response.cookies.set('notion_oauth_state', state, {
      httpOnly: true, // JS cannot read CSRF cookie
      sameSite: 'lax', // Allow top-level return from Notion
      secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod
      path: '/', // Available on callback path
      maxAge: 60 * 10, // 10 minutes to finish page picker
    })
    return response // Browser follows to Notion
  } catch (error) {
    console.error('Notion auth start failed:', error) // Server log
    return NextResponse.json({ error: 'Failed to start Notion authorization' }, { status: 500 })
  }
}
