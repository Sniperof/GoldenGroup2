/**
 * AuthUser — the JWT payload shape shared between:
 *   - packages/api  (minted on login, decoded in requireAuth middleware)
 *   - packages/web  (stored in useAuthStore, attached to every authFetch call)
 *
 * Keep this type minimal — only fields that belong in the token.
 */
export interface AuthUser {
  id: number;
  name: string;
  role: string;
  roleId?: number;
}
