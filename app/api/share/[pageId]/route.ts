// Page share state: list people + active links; invite / update / remove people

import { NextResponse } from 'next/server' // JSON responses
import { createClient } from '@/lib/supabase/server' // Session + RLS
import { isShareRole, type ShareRole } from '@/lib/share/roles' // Role guard
import { assertOwnsPage, findUserIdByEmail } from '@/lib/share/server' // Ownership + bind

type RouteContext = { params: Promise<{ pageId: string }> } // Next.js dynamic params

const PERSON_SELECT =
  'id, role, email, notion_user_id, display_name, avatar_url, grantee_user_id, created_at' // Shared select list

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { pageId } = await context.params // Target page
    const supabase = await createClient() // User session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Auth gate

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const owns = await assertOwnsPage(supabase, pageId, user.id) // Owner-only share UI
    if (!owns) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 }) // No leak
    }

    const [{ data: people, error: peopleError }, { data: links, error: linksError }] =
      await Promise.all([
        supabase
          .from('page_share_people') // Invited people
          .select(PERSON_SELECT)
          .eq('page_id', pageId)
          .order('created_at', { ascending: true }),
        supabase
          .from('page_share_links') // Active role links (no secrets)
          .select('id, role, created_at')
          .eq('page_id', pageId)
          .is('revoked_at', null)
          .order('created_at', { ascending: false }),
      ])

    if (peopleError || linksError) {
      console.error('Share load failed:', peopleError || linksError)
      return NextResponse.json({ error: 'Failed to load share state' }, { status: 500 })
    }

    return NextResponse.json({
      people: people || [], // Grants
      links: (links || []).map((row) => ({
        id: row.id, // Link row id
        role: row.role as ShareRole, // Attached permission
        createdAt: row.created_at, // Mint time — URLs never re-exposed
      })),
    })
  } catch (error) {
    console.error('Share GET failed:', error)
    return NextResponse.json({ error: 'Failed to load share state' }, { status: 500 })
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { pageId } = await context.params // Target page
    const supabase = await createClient() // User session
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser() // Auth gate

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const owns = await assertOwnsPage(supabase, pageId, user.id) // Owner-only invites
    if (!owns) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = (await request.json()) as {
      role?: unknown
      email?: unknown
      notionUserId?: unknown
      displayName?: unknown
      avatarUrl?: unknown
    }

    if (!isShareRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const email =
      typeof body.email === 'string' && body.email.trim()
        ? body.email.trim().toLowerCase()
        : null
    const notionUserId =
      typeof body.notionUserId === 'string' && body.notionUserId.trim()
        ? body.notionUserId.trim()
        : null
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null
    const avatarUrl =
      typeof body.avatarUrl === 'string' && body.avatarUrl.trim()
        ? body.avatarUrl.trim()
        : null

    if (!email && !notionUserId) {
      return NextResponse.json({ error: 'Email or Notion user required' }, { status: 400 })
    }

    // Bind to existing Thinktable account when email matches
    const granteeUserId = email ? await findUserIdByEmail(email) : null

    let existingId: string | null = null
    if (email) {
      const { data } = await supabase
        .from('page_share_people')
        .select('id')
        .eq('page_id', pageId)
        .ilike('email', email)
        .maybeSingle()
      existingId = data?.id ?? null
    }
    if (!existingId && notionUserId) {
      const { data } = await supabase
        .from('page_share_people')
        .select('id')
        .eq('page_id', pageId)
        .eq('notion_user_id', notionUserId)
        .maybeSingle()
      existingId = data?.id ?? null
    }
    if (!existingId && granteeUserId) {
      const { data } = await supabase
        .from('page_share_people')
        .select('id')
        .eq('page_id', pageId)
        .eq('grantee_user_id', granteeUserId)
        .maybeSingle()
      existingId = data?.id ?? null
    }

    if (existingId) {
      const { data: updated, error: updErr } = await supabase
        .from('page_share_people')
        .update({
          role: body.role,
          email,
          notion_user_id: notionUserId,
          display_name: displayName,
          avatar_url: avatarUrl,
          grantee_user_id: granteeUserId,
        })
        .eq('id', existingId)
        .select(PERSON_SELECT)
        .single()
      if (updErr) {
        console.error('Share people update failed:', updErr)
        return NextResponse.json({ error: 'Failed to update invite' }, { status: 500 })
      }
      return NextResponse.json({ person: updated })
    }

    const { data: inserted, error: insErr } = await supabase
      .from('page_share_people')
      .insert({
        page_id: pageId,
        created_by: user.id,
        role: body.role,
        email,
        notion_user_id: notionUserId,
        display_name: displayName,
        avatar_url: avatarUrl,
        grantee_user_id: granteeUserId,
      })
      .select(PERSON_SELECT)
      .single()

    if (insErr) {
      console.error('Share people insert failed:', insErr)
      return NextResponse.json({ error: 'Failed to invite' }, { status: 500 })
    }

    return NextResponse.json({ person: inserted })
  } catch (error) {
    console.error('Share POST failed:', error)
    return NextResponse.json({ error: 'Failed to invite' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { pageId } = await context.params
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const owns = await assertOwnsPage(supabase, pageId, user.id)
    if (!owns) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = (await request.json()) as { personId?: unknown; role?: unknown }
    if (typeof body.personId !== 'string' || !isShareRole(body.role)) {
      return NextResponse.json({ error: 'Invalid person or role' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('page_share_people')
      .update({ role: body.role })
      .eq('id', body.personId)
      .eq('page_id', pageId)
      .select(PERSON_SELECT)
      .single()

    if (error) {
      console.error('Share role patch failed:', error)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }

    return NextResponse.json({ person: data })
  } catch (error) {
    console.error('Share PATCH failed:', error)
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { pageId } = await context.params
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const owns = await assertOwnsPage(supabase, pageId, user.id)
    if (!owns) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const personId = searchParams.get('personId')
    const revokeLinks = searchParams.get('revokeLinks') === '1' // Optional: kill all active links

    if (revokeLinks) {
      const { error } = await supabase
        .from('page_share_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('page_id', pageId)
        .is('revoked_at', null)
      if (error) {
        console.error('Share links revoke failed:', error)
        return NextResponse.json({ error: 'Failed to revoke links' }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    if (!personId) {
      return NextResponse.json({ error: 'personId required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('page_share_people')
      .delete()
      .eq('id', personId)
      .eq('page_id', pageId)

    if (error) {
      console.error('Share people delete failed:', error)
      return NextResponse.json({ error: 'Failed to remove invite' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Share DELETE failed:', error)
    return NextResponse.json({ error: 'Failed to remove invite' }, { status: 500 })
  }
}
