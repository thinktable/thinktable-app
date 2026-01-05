import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Fetch homepage board using service role (bypasses RLS)
// This allows public access to the homepage board without authentication
export async function GET() {
  try {
    const homepageBoardId = process.env.NEXT_PUBLIC_HOMEPAGE_BOARD_ID || process.env.HOMEPAGE_BOARD_ID
    
    if (!homepageBoardId) {
      return NextResponse.json(
        { error: 'HOMEPAGE_BOARD_ID not configured' },
        { status: 500 }
      )
    }

    // Use secret key or service role key for admin access (bypasses RLS)
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!secretKey) {
      return NextResponse.json(
        { error: 'Supabase secret key not configured' },
        { status: 500 }
      )
    }

    // Check if Supabase URL is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL not configured' },
        { status: 500 }
      )
    }

    // Create admin client that bypasses RLS
    const supabaseAdmin = createClient(
      supabaseUrl,
      secretKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Fetch the homepage board
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id, title, metadata')
      .eq('id', homepageBoardId)
      .single()

    if (convError || !conversation) {
      console.error('Error fetching homepage board:', convError)
      return NextResponse.json(
        { error: 'Homepage board not found' },
        { status: 404 }
      )
    }

    // Fetch messages for the homepage board
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, created_at, metadata')
      .eq('conversation_id', homepageBoardId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error('Error fetching homepage messages:', messagesError)
      return NextResponse.json(
        { error: 'Failed to fetch homepage messages' },
        { status: 500 }
      )
    }

    // Fetch edges (connections) for the homepage board
    const { data: edges, error: edgesError } = await supabaseAdmin
      .from('panel_edges')
      .select('source_message_id, target_message_id')
      .eq('conversation_id', homepageBoardId)

    if (edgesError) {
      console.error('Error fetching homepage edges:', edgesError)
      return NextResponse.json(
        { error: 'Failed to fetch homepage edges' },
        { status: 500 }
      )
    }

    // Fetch canvas nodes (freehand drawings, etc.) for the homepage board
    const { data: canvasNodes, error: canvasNodesError } = await supabaseAdmin
      .from('canvas_nodes')
      .select('id, node_type, position_x, position_y, width, height, data')
      .eq('conversation_id', homepageBoardId)
      .order('created_at', { ascending: true })

    if (canvasNodesError) {
      console.error('Error fetching homepage canvas nodes:', canvasNodesError)
      // Don't fail the request if canvas nodes fail - just log and continue
    }

    return NextResponse.json({
      conversation,
      messages: messages || [],
      edges: edges || [],
      canvasNodes: canvasNodes || [],
    })
  } catch (error) {
    console.error('Error in homepage-board API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

