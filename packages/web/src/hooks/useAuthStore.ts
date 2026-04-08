import { create } from 'zustand';
import type { AuthUser } from '@golden-crm/shared';

export type { AuthUser };

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: string[];
  login: (token: string, user: AuthUser, permissions?: string[]) => void;
  logout: () => void;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedToken,
  user: storedUser,
  permissions: storedPermissions,
  login(token, user, permissions = []) {
    localStorage.setItem('hr_token', token);
    localStorage.setItem('hr_user', JSON.stringify(user));
    localStorage.setItem('hr_permissions', JSON.stringify(permissions));
    set({ token, user, permissions });
  },
  logout() {
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_user');
    localStorage.removeItem('hr_permissions');
    set({ token: null, user: null, permissions: [] });
  },
  hasPermission(key: string) {
    if (get().user?.role === 'ADMIN') return true;
    return get().permissions.includes(key);
  },
  hasAnyPermission(...keys: string[]) {
    if (get().user?.role === 'ADMIN') return true;
    const perms = get().permissions;
    return keys.some(k => perms.includes(k));
  },
  setPermissions(permissions: string[]) {
    localStorage.setItem('hr_permissions', JSON.stringify(permissions));
    set({ permissions });
  },
}));
