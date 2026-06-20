import { create } from 'zustand';
import type { AuthUser } from '@golden-crm/shared';
import { useBranchContextStore } from './useBranchContextStore';

export type { AuthUser };

export interface PermissionGrant {
  permission: string;
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
}

function derivePermissionsFromGrants(grants: PermissionGrant[]): string[] {
  return Array.from(new Set(grants.map(grant => grant.permission)));
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: string[];
  grants: PermissionGrant[];
  login: (token: string, user: AuthUser, permissions?: string[], grants?: PermissionGrant[]) => void;
  logout: () => void;
  refreshSession: () => Promise<void>;
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
    const normalizedPermissions = grants.length > 0 ? derivePermissionsFromGrants(grants) : permissions;
    localStorage.setItem('hr_token', token);
    localStorage.setItem('hr_user', JSON.stringify(user));
    localStorage.setItem('hr_permissions', JSON.stringify(normalizedPermissions));
    localStorage.setItem('hr_grants', JSON.stringify(grants));
    // A fresh login may be a different account — reset the admin branch filter so
    // the new user never inherits the previous user's selected branch (which they
    // may not be allowed to access, producing a 403 / empty list). null = the safe
    // default: "all branches" for GLOBAL, server-scoped for branch users.
    useBranchContextStore.getState().clear();
    set({ token, user, permissions: normalizedPermissions, grants });
  },
  logout() {
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_user');
    localStorage.removeItem('hr_permissions');
    localStorage.removeItem('hr_grants');
    // The admin branch filter must never survive an account boundary.
    useBranchContextStore.getState().clear();
    set({ token: null, user: null, permissions: [], grants: [] });
  },
  async refreshSession() {
    const token = get().token;
    if (!token) return;

    const res = await fetch('/api/auth/session', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      get().logout();
      return;
    }

    if (!res.ok) {
      throw new Error('تعذر تحديث جلسة المستخدم');
    }

    const data = await res.json();
    const grants = (data.grants ?? []) as PermissionGrant[];
    const permissions = grants.length > 0
      ? derivePermissionsFromGrants(grants)
      : ((data.permissions ?? []) as string[]);

    localStorage.setItem('hr_user', JSON.stringify(data.user));
    localStorage.setItem('hr_permissions', JSON.stringify(permissions));
    localStorage.setItem('hr_grants', JSON.stringify(grants));
    set({ user: data.user, permissions, grants });
  },
  hasPermission(key: string) {
    if (get().user?.isSuperAdmin === true) return true;
    const grants = get().grants;
    if (grants.length > 0) {
      return grants.some(grant => grant.permission === key);
    }
    return get().permissions.includes(key);
  },
  hasAnyPermission(...keys: string[]) {
    if (get().user?.isSuperAdmin === true) return true;
    const grants = get().grants;
    if (grants.length > 0) {
      return keys.some(k => grants.some(grant => grant.permission === k));
    }
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
