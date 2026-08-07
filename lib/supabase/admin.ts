// Service-role Supabase client for server-only tables (why: notion_connections has no RLS policies for users)

import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL // Project URL
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY // Bypasses RLS
  if (!url || !secretKey) {
    throw new Error('Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY') // Fail closed
  }
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false, // Server jobs don't need session refresh
      persistSession: false, // No cookies for admin client
      detectSessionInUrl: false, // Not a browser client
    },
  })
}
