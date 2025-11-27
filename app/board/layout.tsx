// Main board layout with sidebar structure
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppSidebar from '@/components/app-sidebar'

export default async function BoardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let user = null
  try {
    const supabase = await createClient()
    // Add timeout protection to prevent hanging
    const getUserPromise = supabase.auth.getUser()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Auth timeout')), 5000)
    )
    
    const result = await Promise.race([getUserPromise, timeoutPromise])
    user = result.data?.user || null
  } catch (error) {
    // If auth check fails or times out, redirect to login
    console.warn('Auth check failed in board layout:', error)
    redirect('/login')
  }

  // Middleware already handles redirect, but we need user for the sidebar
  // If no user, middleware will redirect, so this is just for type safety
  if (!user) {
    // This shouldn't happen due to middleware, but handle gracefully
    return null
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <AppSidebar user={user} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
