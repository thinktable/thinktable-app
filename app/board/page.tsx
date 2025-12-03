// Default board page - shows centered chat input when no board is selected
import { ChatInput } from '@/components/chat-input'
import { BoardFlow } from '@/components/board-flow'

export default function BoardPage() {
  // Simple page component - no async needed
  // Middleware handles authentication
  // Client components handle their own data fetching

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
