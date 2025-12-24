import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  // Validate environment variables first
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    // Return a mock client that will fail gracefully instead of throwing
    // This prevents 500 errors when env vars are missing
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: 'Supabase not configured' } }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }) }),
        insert: async () => ({ error: { message: 'Supabase not configured' } }),
      }),
    } as any
  }

  try {
  const cookieStore = await cookies()

  return createServerClient(
      supabaseUrl,
      supabaseKey,
    {
      cookies: {
        getAll() {
            try {
          return cookieStore.getAll()
            } catch {
              return []
            }
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
  } catch (error) {
    // If cookies() fails, return a mock client that fails gracefully
    // This prevents 500 errors from cookie access issues
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: 'Cookie access failed' } }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'Cookie access failed' } }) }) }),
        insert: async () => ({ error: { message: 'Cookie access failed' } }),
      }),
    } as any
  }
}



