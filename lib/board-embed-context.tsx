'use client'

// Marks when a board is rendered inside another board (item page preview).
// Nested boards hide their own in-page preview to avoid infinite board-in-board nesting.

import { createContext, useContext } from 'react' // Lightweight embed flag

type BoardEmbedContextValue = {
  embedded: boolean // True when this board is a preview inside a parent map item
}

const BoardEmbedContext = createContext<BoardEmbedContextValue>({ embedded: false })

export function BoardEmbedProvider({
  embedded,
  children,
}: {
  embedded: boolean
  children: React.ReactNode
}) {
  return (
    <BoardEmbedContext.Provider value={{ embedded }}>{children}</BoardEmbedContext.Provider>
  )
}

export function useBoardEmbed() {
  return useContext(BoardEmbedContext) // Default: not embedded
}
