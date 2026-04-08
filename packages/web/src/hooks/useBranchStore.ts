import { create } from 'zustand';
import { api } from '../lib/api';
import type { Branch, GeoUnit } from '../lib/types';

interface BranchStore {
  branches: Branch[];
  loading: boolean;
  error: string | null;

  fetchBranches: () => Promise<void>;
  createBranch: (data: Partial<Branch>) => Promise<Branch>;
  updateBranch: (id: number, data: Partial<Branch>) => Promise<Branch>;
  deleteBranch: (id: number) => Promise<void>;
}

export const useBranchStore = create<BranchStore>((set, get) => ({
  branches: [],
  loading: false,
  error: null,

  fetchBranches: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.branches.list();
      set({ branches: data, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createBranch: async (data) => {
    try {
      const branch = await api.branches.create(data);
      set((s) => ({ branches: [branch, ...s.branches] }));
      return branch;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create branch');
    }
  },

  updateBranch: async (id, data) => {
    try {
      const updated = await api.branches.update(id, data);
      set((s) => ({
        branches: s.branches.map((b) => (b.id === id ? { ...b, ...updated } : b)),
      }));
      return updated;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update branch');
    }
  },

  deleteBranch: async (id) => {
    try {
      await api.branches.delete(id);
      set((s) => ({
        branches: s.branches.filter((b) => b.id !== id),
      }));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete branch');
    }
  },
}));
