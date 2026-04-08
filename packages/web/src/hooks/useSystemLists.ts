import { create } from 'zustand';
import { api } from '../lib/api';
import type { SystemList } from '../lib/types';

interface SystemListsStore {
  lists: SystemList[];
  loading: boolean;
  error: string | null;

  fetchLists: (params?: { category?: string; activeOnly?: boolean }) => Promise<void>;
  createList: (data: Partial<SystemList>) => Promise<SystemList>;
  updateList: (id: number, data: Partial<SystemList>) => Promise<SystemList>;
  deleteList: (id: number) => Promise<void>;
  
  // Helper to easily get active values by category
  getValuesByCategory: (category: string) => string[];
}

export const useSystemListsStore = create<SystemListsStore>((set, get) => ({
  lists: [],
  loading: false,
  error: null,

  fetchLists: async (params) => {
    set({ loading: true, error: null });
    try {
      const data = await api.systemLists.list(params);
      set({ lists: data, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createList: async (data) => {
    try {
      const newList = await api.systemLists.create(data);
      set((s) => ({ lists: [...s.lists, newList].sort((a,b) => a.displayOrder - b.displayOrder) }));
      return newList;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create list item');
    }
  },

  updateList: async (id, data) => {
    try {
      const updated = await api.systemLists.update(id, data);
      set((s) => ({
        lists: s.lists.map((l) => (l.id === id ? { ...l, ...updated } : l)).sort((a,b) => a.displayOrder - b.displayOrder),
      }));
      return updated;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update list item');
    }
  },

  deleteList: async (id) => {
    try {
      await api.systemLists.delete(id);
      set((s) => ({
        lists: s.lists.filter((l) => l.id !== id),
      }));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete list item');
    }
  },

  getValuesByCategory: (category: string) => {
    return get().lists
      .filter(l => l.category === category && l.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(l => l.value);
  }
}));
