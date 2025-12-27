'use client'

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from 'react'
import { BoardFlow } from '@/components/board-flow'
import { ReactFlowContextProvider } from '@/components/react-flow-context'
import { EditorProvider } from '@/components/editor-context'

// Homepage - displays public homepage board (read-only)
// To edit: Navigate to /board/[homepage-board-id] as system user
export default function Home() {
  const [homepageBoardId, setHomepageBoardId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch homepage board ID from API route (server-side env vars)
  useEffect(() => {
    async function fetchHomepageBoard() {
      try {
        const response = await fetch('/api/homepage-board')
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || `HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        if (data.conversation?.id) {
          setHomepageBoardId(data.conversation.id)
        } else {
          throw new Error('Homepage board not found in response')
        }
      } catch (e: any) {
        console.error("Failed to fetch homepage board:", e)
        setError(e.message)
      } finally {
        setIsLoading(false)
      }
    }
    fetchHomepageBoard()
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation - sticky banner matching dashboard top bar height (52px) */}
      <nav className="sticky top-0 z-50 h-[52px] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
        <div className="container mx-auto h-full px-6 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image
            src="/thinkable-logo.svg"
            alt="Thinkable"
            width={24}
            height={24}
            className="h-6 w-6"
            priority
          />
          <span className="text-xl font-semibold text-foreground leading-6">Thinkable</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/product" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Product
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Login
          </Link>
          <Link 
            href="/signup" 
            className="bg-primary text-primary-foreground px-4 h-8 rounded-lg hover:opacity-90 transition-opacity text-sm font-medium flex items-center justify-center"
          >
            Get Started
          </Link>
        </div>
        </div>
      </nav>

      {/* React Flow board - displays homepage board (read-only, no topbar) */}
      {isLoading ? (
        <div className="h-[calc(100vh-52px)] flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">Loading homepage...</p>
          </div>
        </div>
      ) : error ? (
        <div className="h-[calc(100vh-52px)] flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground mb-4">Homepage board not configured</p>
            <p className="text-sm text-muted-foreground">
              {error}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Set NEXT_PUBLIC_HOMEPAGE_BOARD_ID in your environment variables
            </p>
          </div>
        </div>
      ) : homepageBoardId ? (
        <EditorProvider>
          <ReactFlowContextProvider conversationId={homepageBoardId}>
            <div className="h-[calc(100vh-52px)] relative">
              <BoardFlow conversationId={homepageBoardId} />
            </div>
          </ReactFlowContextProvider>
        </EditorProvider>
      ) : null}
    </div>
  );
}
