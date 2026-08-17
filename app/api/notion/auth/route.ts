// Start Notion OAuth — redirect (or JSON) to Notion's hosted page-picker authorize URL

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildNotionAuthorizeUrl, isNotionOAuthConfigured } from '@/lib/notion/config'
import { randomBytes } from 'crypto'

/** Set CSRF cookie + return Notion authorize URL (redirect or JSON). */
async function prepareNotionAuthorize(request: NextRequest): Promise<
  | { ok: true; authorizeUrl: string; state: string }
  | { ok: false; response: NextResponse }
> {
  if (!isNotionOAuthConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Notion OAuth is not configured. Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env.local.',
        },
        { status: 503 }
      ),
    }
  }

  const supabase = await createClient() // Cookie session client
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser() // Require signed-in Thinktable user

  if (userError || !user) {
    const loginUrl = new URL('/login', request.url) // Send anonymous users to login
    loginUrl.searchParams.set('next', '/api/notion/auth') // Resume Notion connect after login
    return { ok: false, response: NextResponse.redirect(loginUrl) }
  }

  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/' // Where to land after connect
  const nonce = randomBytes(16).toString('hex') // CSRF nonce
  const state = Buffer.from(JSON.stringify({ nonce, returnTo, userId: user.id })).toString(
    'base64url'
  ) // Opaque state blob
  const authorizeUrl = buildNotionAuthorizeUrl(state) // https://api.notion.com/v1/oauth/authorize?…
  return { ok: true, authorizeUrl, state }
}

/** Attach the OAuth state cookie used by /api/notion/callback. */
function withOAuthStateCookie(response: NextResponse, state: string): NextResponse {
  response.cookies.set('notion_oauth_state', state, {
    httpOnly: true, // JS cannot read CSRF cookie
    sameSite: 'lax', // Allow top-level return from Notion
    secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod
    path: '/', // Available on callback path
    maxAge: 60 * 10, // 10 minutes to finish page picker
  })
  return response
}

export async function GET(request: NextRequest) {
  try {
    const prepared = await prepareNotionAuthorize(request)
    if (!prepared.ok) return prepared.response

    const wantJson =
      request.nextUrl.searchParams.get('format') === 'json' ||
      request.headers.get('accept')?.includes('application/json')

    // JSON: client navigates straight to Notion’s page picker (no intermediate redirect chain)
    if (wantJson) {
      return withOAuthStateCookie(
        NextResponse.json({ authorizeUrl: prepared.authorizeUrl }),
        prepared.state
      )
    }

    // Browser / <a href>: 302 to Notion authorize (Select pages → Allow access)
    return withOAuthStateCookie(NextResponse.redirect(prepared.authorizeUrl), prepared.state)
  } catch (error) {
    console.error('Notion auth start failed:', error) // Server log
    return NextResponse.json({ error: 'Failed to start Notion authorization' }, { status: 500 })
  }
}
