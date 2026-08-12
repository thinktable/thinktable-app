// Main board layout — full-bleed map; AppSidebar mounts as fixed hover popup (not a column)
import React from 'react'
import AppSidebar from '@/components/app-sidebar'
import { SidebarContextProvider } from '@/components/sidebar-context'

// Safe async function that never throws
async function getSafeUser() {
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const result = await supabase.auth.getUser()
    return result?.data?.user || null
  } catch {
    return null
  }
}

export default async function BoardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Always render the layout - handle all errors gracefully
  // Get user safely - if it fails, just render without sidebar
  const user = await getSafeUser()

  // Always render - never throw errors
  return (
    <SidebarContextProvider>
      <div className="flex flex-col" style={{ height: 'calc(var(--vh, 1vh) * 100)' }}>
        <div className="flex-1 flex overflow-hidden relative">
          {user ? <AppSidebar user={user} /> : null}
          <main className="flex-1 overflow-hidden min-w-0">{children}</main>
        </div>
      </div>
    </SidebarContextProvider>
  )
}
