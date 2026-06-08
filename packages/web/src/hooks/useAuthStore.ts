import { create } from 'zustand';
import type { AuthUser } from '@golden-crm/shared';

export type { AuthUser };

export interface PermissionGrant {
  permission: string;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: string[];
  grants: PermissionGrant[];
  login: (token: string, user: AuthUser, permissions?: string[], grants?: PermissionGrant[]) => void;
  logout: () => void;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
  /** Returns the scope for a given permission key, or null if not granted. Super admin always returns 'GLOBAL'. */
  getPermissionScope: (key: string) => 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null;
  setPermissions: (permissions: string[]) => void;
}

const storedToken = localStorage.getItem('hr_token');
const storedUser = (() => {
  try {
    const raw = localStorage.getItem('hr_user');
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
})();
const storedPermissions = (() => {
  try {
    const raw = localStorage.getItem('hr_permissions');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
})();
const storedGrants = (() => {
  try {
    const raw = localStorage.getItem('hr_grants');
    return raw ? (JSON.parse(raw) as PermissionGrant[]) : [];
  } catch {
    return [];
  }
})();

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedToken,
  user: storedUser,
  permissions: storedPermissions,
  grants: storedGrants,
  login(token, user, permissions = [], grants = []) {
    localStorage.setItem('hr_token', token);
    localStorage.setItem('hr_user', JSON.stringify(user));
    localStorage.setItem('hr_permissions', JSON.stringify(permissions));
    localStorage.setItem('hr_grants', JSON.stringify(grants));
    set({ token, user, permissions, grants });
  },
  logout() {
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_user');
    localStorage.removeItem('hr_permissions');
    localStorage.removeItem('hr_grants');
    set({ token: null, user: null, permissions: [], grants: [] });
  },
  hasPermission(key: string) {
    if (get().user?.isSuperAdmin === true) return true;
    return get().permissions.includes(key);
  },
  hasAnyPermission(...keys: string[]) {
    if (get().user?.isSuperAdmin === true) return true;
    const perms = get().permissions;
    return keys.some(k => perms.includes(k));
  },
  getPermissionScope(key: string) {
    if (get().user?.isSuperAdmin === true) return 'GLOBAL';
    const grant = get().grants.find(g => g.permission === key);
    return grant?.scope ?? null;
  },
  setPermissions(permissions: string[]) {
    localStorage.setItem('hr_permissions', JSON.stringify(permissions));
    set({ permissions });
  },
}));
