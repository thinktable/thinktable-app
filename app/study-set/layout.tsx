// Study set layout with sidebar structure - same as board layout
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

export default async function StudySetLayout({
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
      <div className="h-screen flex flex-col">
        <div className="flex-1 flex overflow-hidden">
          {user ? <AppSidebar user={user} /> : <div className="w-0" />}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarContextProvider>
  )
}
