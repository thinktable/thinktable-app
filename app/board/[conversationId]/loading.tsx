// Shown while middleware + RSC auth/role resolve — avoids blank wait before BoardFlow mounts
export default function BoardConversationLoading() {
  return (
    <div
      className="relative h-full w-full bg-gray-50 dark:bg-[#0f0f0f]" // Same board fill as map column
      aria-busy="true"
      aria-label="Loading board"
    >
      {/* Top bar placeholder — holds chrome height while page gates */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-3 px-3">
        <div className="h-7 w-7 animate-pulse rounded-md bg-gray-200/80 dark:bg-white/10" />
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200/80 dark:bg-white/10" />
      </div>
      {/* Soft map plane — frame shimmer takes over after client hydrate */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-[12%] top-[22%] h-24 w-48 animate-pulse rounded-md bg-gray-200/70 dark:bg-white/10" />
        <div className="absolute left-[42%] top-[38%] h-32 w-56 animate-pulse rounded-md bg-gray-200/70 dark:bg-white/10" />
        <div className="absolute left-[28%] top-[58%] h-20 w-40 animate-pulse rounded-md bg-gray-200/70 dark:bg-white/10" />
      </div>
    </div>
  )
}
