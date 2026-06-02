/**
 * AuthUser — the JWT payload shape shared between:
 *   - packages/api  (minted on login, decoded in requireAuth middleware)
 *   - packages/web  (stored in useAuthStore, attached to every authFetch call)
 *
 * Keep this type minimal — only fields that belong in the token.
 *
 * Multi-branch fields (migration 013+):
 *   - isSuperAdmin: HQ super admin — bypasses branch scoping, sees all data.
 *   - branchId:     null for super admins; numeric for branch-bound users.
 */
export interface AuthUser {
  id: number;
  name: string;
  role: string;
  roleId?: number;
  roleDisplayName?: string | null;
  isSuperAdmin?: boolean;
  branchId?: number | null;
  /** Optional link to `employees.id` — used by the Field Team view to match
   *  the logged-in user against `team_snapshot` employee IDs. */
  employeeId?: number | null;
}
