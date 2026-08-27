// Board body font — Default / Serif / Mono (More menu + conversations.metadata)

export const BOARD_FONT_IDS = ['default', 'serif', 'mono'] as const
export type BoardFontId = (typeof BOARD_FONT_IDS)[number]

export function parseBoardFontId(value: unknown): BoardFontId | null {
  return typeof value === 'string' && (BOARD_FONT_IDS as readonly string[]).includes(value)
    ? (value as BoardFontId)
    : null
}
