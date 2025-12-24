import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Delete the user account using admin client with secret key
    // Use new secret key (sb_secret_...) - recommended by Supabase
    // Falls back to legacy service_role key for compatibility
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    
    // Debug: Log all Supabase-related env vars (without values for security)
    const supabaseEnvVars = Object.keys(process.env)
      .filter(k => k.includes('SUPABASE'))
      .map(k => `${k}=${process.env[k]?.substring(0, 20)}...`)
    console.log('🔍 Supabase env vars found:', supabaseEnvVars)
    console.log('🔍 Looking for: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
    console.log('🔍 SUPABASE_SECRET_KEY exists:', !!process.env.SUPABASE_SECRET_KEY)
    console.log('🔍 SUPABASE_SERVICE_ROLE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
    
    if (!secretKey) {
      console.error('❌ Supabase secret key not found in environment variables')
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')))
      
      // Sign out the user anyway as a fallback
      await supabase.auth.signOut()
      
      return NextResponse.json(
        { 
          error: 'Account deletion requires SUPABASE_SECRET_KEY in .env.local. Get it from: https://supabase.com/dashboard/project/_/settings/api-keys (Create new API Keys → Secret key). Please add it and restart the server.',
          signedOut: true
        },
        { status: 403 }
      )
    }

    // Create admin client with secret key
    // According to Supabase docs, secret keys work exactly like service_role for admin operations
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      secretKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    )

    // Test admin client by getting user first
    console.log('🔍 Testing admin client access...')
    console.log('🔍 User ID:', user.id)
    console.log('🔍 Secret key format:', secretKey.startsWith('sb_secret_') ? 'New format (sb_secret_)' : secretKey.startsWith('eyJ') ? 'Legacy JWT format' : 'Unknown format')
    
    const { data: testUser, error: testError } = await adminClient.auth.admin.getUserById(user.id)
    if (testError) {
      console.error('❌ Admin client test failed:', testError)
      console.error('❌ This means the secret key is not working for admin operations')
      await supabase.auth.signOut()
      return NextResponse.json(
        { 
          error: `Admin API access failed: ${testError.message}. Please verify your SUPABASE_SECRET_KEY is correct and has admin privileges.`,
          signedOut: true
        },
        { status: 500 }
      )
    }
    console.log('✅ Admin client access confirmed - can read user:', testUser.user?.email)
    
    // Delete user via admin API
    // This will cascade delete all related data (profiles, subscriptions, conversations, messages, etc.)
    // due to ON DELETE CASCADE constraints in the schema
    console.log('🔍 Attempting to delete user:', user.id)
    const { data: deleteData, error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)

    console.log('🔍 Delete response:', { 
      deleteData: deleteData ? JSON.stringify(deleteData) : 'null', 
      deleteError: deleteError ? JSON.stringify(deleteError) : 'null'
    })

    if (deleteError) {
      console.error('❌ Delete account error:', deleteError)
      console.error('❌ Error details:', JSON.stringify(deleteError, null, 2))
      console.error('❌ Error name:', deleteError.name)
      console.error('❌ Error message:', deleteError.message)
      
      // Check if it's a storage ownership issue
      if (deleteError.message?.includes('storage') || deleteError.message?.includes('objects')) {
        // Try to delete user's storage objects first
        try {
          const { data: buckets } = await adminClient.storage.listBuckets()
          for (const bucket of buckets || []) {
            const { data: files } = await adminClient.storage.from(bucket.name).list(user.id)
            if (files && files.length > 0) {
              const filePaths = files.map(f => `${user.id}/${f.name}`)
              await adminClient.storage.from(bucket.name).remove(filePaths)
            }
          }
          // Retry deletion
          const { error: retryError } = await adminClient.auth.admin.deleteUser(user.id)
          if (retryError) {
            throw retryError
          }
        } catch (storageError: any) {
          console.error('Storage cleanup error:', storageError)
          await supabase.auth.signOut()
          return NextResponse.json(
            { 
              error: 'Failed to delete account. Please contact support if this persists.',
              signedOut: true
            },
            { status: 500 }
          )
        }
      } else {
        // If deletion fails, still sign out the user
        await supabase.auth.signOut()
        
        return NextResponse.json(
          { 
            error: deleteError.message || 'Failed to delete account. You have been signed out.',
            signedOut: true
          },
          { status: 500 }
        )
      }
    }

    // Verify deletion by checking if user still exists
    const { data: verifyUser, error: verifyError } = await adminClient.auth.admin.getUserById(user.id)
    
    if (verifyUser?.user) {
      console.error('❌ User still exists after deletion attempt!')
      await supabase.auth.signOut()
      return NextResponse.json(
        { 
          error: 'Failed to delete account. User still exists in database.',
          signedOut: true
        },
        { status: 500 }
      )
    }

    console.log('✅ User account deleted successfully:', user.id)
    console.log('✅ All related data (profiles, subscriptions, conversations, messages) deleted via CASCADE')

    // Sign out the user after successful deletion
    await supabase.auth.signOut()

    return NextResponse.json({ 
      success: true, 
      message: 'Account and all associated data deleted successfully' 
    })
  } catch (error: any) {
    console.error('Delete account error:', error)
    
    // Try to sign out even if there's an error
    try {
      const supabase = await createClient()
      await supabase.auth.signOut()
    } catch (signOutError) {
      console.error('Failed to sign out:', signOutError)
    }
    
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error. You have been signed out.',
        signedOut: true
      },
      { status: 500 }
    )
  }
}

