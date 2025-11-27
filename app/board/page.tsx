// Default board page - shows centered chat input when no board is selected
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChatInput } from '@/components/chat-input'
import { BoardFlow } from '@/components/board-flow'

export default async function BoardPage() {
  const supabase = await createClient()
  let user = null
  
  try {
    // Add timeout protection to prevent hanging
    const getUserPromise = supabase.auth.getUser()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Auth timeout')), 5000)
    )
    
    const result = await Promise.race([getUserPromise, timeoutPromise])
    user = result.data?.user || null
  } catch (error) {
    // If auth check fails or times out, treat as unauthenticated
    console.warn('Auth check failed on board page:', error)
    user = null
  }

  // Middleware handles auth, but we need user for the query
  if (!user) {
    return null // Middleware will redirect
  }

  // Verify email is confirmed
  if (!user.email_confirmed_at) {
    await supabase.auth.signOut()
    redirect('/login?error=email_not_verified')
  }

  // Verify profile exists
  let { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, subscription_tier')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    // Profile missing - try to create it
    const { error: createError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
      })

    if (createError) {
      console.error('Failed to create profile:', createError)
      await supabase.auth.signOut()
      redirect('/login?error=profile_missing')
    }

    // Refetch profile after creation
    const { data: newProfile } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier')
      .eq('id', user.id)
      .single()
    
    profile = newProfile
  }

  return (
    <div className="h-full relative">
      {/* React Flow board behind input */}
      <div className="absolute inset-0">
        <BoardFlow />
      </div>
      
      {/* Centered input overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="w-full max-w-3xl px-8 pointer-events-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome to Thinkable!
            </h1>
            <p className="text-xl text-gray-600 mb-2">
              Start a conversation to create your first board
            </p>
            <p className="text-sm text-gray-500">
              Your visual mind mapping workspace is ready.
            </p>
          </div>
          <ChatInput />
        </div>
      </div>
    </div>
  )
}
