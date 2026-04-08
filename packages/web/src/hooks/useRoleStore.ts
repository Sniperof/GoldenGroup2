import { create } from 'zustand';
import { trpc } from '../lib/trpc';
import type { Role, Permission, HrUser } from '@golden-crm/shared';

// Re-export so existing page components that `import { Role } from '../hooks/useRoleStore'`
// continue to work without any changes.
export type { Role, Permission, HrUser };

// ── Store interface ────────────────────────────────────────────────────────
// Identical to the previous interface — page components are unaffected.

interface RoleStore {
  roles: Role[];
  allPermissions: Permission[];
  hrUsers: HrUser[];
  loading: boolean;
  error: string | null;

  fetchRoles: () => Promise<void>;
  fetchPermissions: () => Promise<void>;
  fetchHrUsers: () => Promise<void>;

  createRole: (data: { name: string; displayName: string; description?: string }) => Promise<Role>;
  updateRole: (id: number, data: { displayName?: string; description?: string; isActive?: boolean }) => Promise<void>;
  deleteRole: (id: number) => Promise<void>;
  updateRolePermissions: (roleId: number, permissionIds: number[]) => Promise<void>;

  createHrUser: (data: { name: string; username: string; password: string; roleId: number }) => Promise<void>;
  updateHrUser: (id: number, data: { name?: string; username?: string; password?: string; roleId?: number; isActive?: boolean }) => Promise<void>;
}

// ── Store implementation ───────────────────────────────────────────────────
// Replaces all `authFetch` calls with typed tRPC procedures.
// No manual snake_case normalizers needed — the tRPC router returns camelCase.

export const useRoleStore = create<RoleStore>((set) => ({
  roles: [],
  allPermissions: [],
  hrUsers: [],
  loading: false,
  error: null,

  async fetchRoles() {
    set({ loading: true, error: null });
    try {
      const roles = await trpc.roles.list.query();
      set({ roles, loading: false });
    } catch (err: unknown) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async fetchPermissions() {
    try {
      const allPermissions = await trpc.roles.allPermissions.query();
      set({ allPermissions });
    } catch (err: unknown) {
      set({ error: (err as Error).message });
    }
  },

  async fetchHrUsers() {
    try {
      const hrUsers = await trpc.roles.hrUsersList.query();
      set({ hrUsers });
    } catch (err: unknown) {
      set({ error: (err as Error).message });
    }
  },

  async createRole(data) {
    const role = await trpc.roles.create.mutate(data);
    set(s => ({ roles: [...s.roles, role] }));
    return role;
  },

  async updateRole(id, data) {
    const updated = await trpc.roles.update.mutate({ id, ...data });
    set(s => ({ roles: s.roles.map(r => r.id === id ? { ...r, ...updated } : r) }));
  },

  async deleteRole(id) {
    await trpc.roles.delete.mutate({ id });
    set(s => ({ roles: s.roles.filter(r => r.id !== id) }));
  },

  async updateRolePermissions(roleId, permissionIds) {
    await trpc.roles.setPermissions.mutate({ roleId, permissionIds });
    set(s => ({
      roles: s.roles.map(r => r.id === roleId ? { ...r, permissionCount: permissionIds.length } : r),
    }));
  },

  async createHrUser(data) {
    const user = await trpc.roles.createHrUser.mutate(data);
    set(s => ({ hrUsers: [...s.hrUsers, user] }));
  },

  async updateHrUser(id, data) {
    const updated = await trpc.roles.updateHrUser.mutate({ id, ...data });
    set(s => ({ hrUsers: s.hrUsers.map(u => u.id === id ? { ...u, ...updated } : u) }));
  },
}));
