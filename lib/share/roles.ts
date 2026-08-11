// Share roles for Thinktable pages (copy-link + people grants)

export const SHARE_ROLES = ['view', 'comment', 'edit'] as const // Ordered by power (weak → strong)

export type ShareRole = (typeof SHARE_ROLES)[number] // Single role string union

export type BoardAccessRole = ShareRole | 'owner' // Resolved access including ownership

export const SHARE_ROLE_LABELS: Record<ShareRole, string> = {
  view: 'Can view', // Read-only page access
  comment: 'Can comment', // Read + comment (reserved; treated as view until comments ship)
  edit: 'Can edit', // Full edit of page content / layout
}

export const BOARD_ACCESS_ROLE_RANK: Record<BoardAccessRole, number> = {
  view: 1, // Read
  comment: 2, // Read (+ future comment)
  edit: 3, // Write
  owner: 4, // Full control + share management
}

export function isShareRole(value: unknown): value is ShareRole {
  return typeof value === 'string' && (SHARE_ROLES as readonly string[]).includes(value) // Guard API bodies
}

export function isBoardAccessRole(value: unknown): value is BoardAccessRole {
  return value === 'owner' || isShareRole(value) // Includes owner
}

/** Numeric rank for comparing roles (higher = more power). */
export function shareRoleRank(role: BoardAccessRole | null | undefined): number {
  if (!role) return 0 // No access
  return BOARD_ACCESS_ROLE_RANK[role] ?? 0 // Known ranks only
}

/** Pick the stronger of two roles (null-safe). */
export function maxShareRole(
  a: ShareRole | null | undefined,
  b: ShareRole | null | undefined
): ShareRole | null {
  if (!a) return b ?? null // Only b
  if (!b) return a // Only a
  return shareRoleRank(a) >= shareRoleRank(b) ? a : b // Stronger wins
}

export function canViewBoard(role: BoardAccessRole | null | undefined): boolean {
  return shareRoleRank(role) >= 1 // view+
}

export function canEditBoard(role: BoardAccessRole | null | undefined): boolean {
  return shareRoleRank(role) >= 3 // edit or owner
}

export function canManageShare(role: BoardAccessRole | null | undefined): boolean {
  return role === 'owner' // Share settings are owner-only
}
