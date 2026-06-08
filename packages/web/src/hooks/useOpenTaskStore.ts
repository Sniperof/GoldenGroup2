import { create } from 'zustand';
import type { OpenTask, OpenTaskStatus, OpenTaskType } from '@golden-crm/shared';
import { authFetch } from '../lib/authFetch';

interface OpenTaskState {
  tasks: OpenTask[];
  loading: boolean;
  updating: boolean;
  error: string | null;
  fetchTasks: (branchId: number, filters?: { status?: OpenTaskStatus; taskType?: OpenTaskType }) => Promise<void>;
  updateTaskStatus: (id: number, status: OpenTaskStatus, notes?: string) => Promise<void>;
  clearError: () => void;
}

export const useOpenTaskStore = create<OpenTaskState>((set) => ({
  tasks: [],
  loading: false,
  updating: false,
  error: null,

  fetchTasks: async (branchId, filters) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams({ branchId: String(branchId) });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.taskType) params.set('taskType', filters.taskType);

      const res = await authFetch(`/api/open-tasks?${params}`);
      if (!res.ok) throw new Error('فشل في تحميل المهام');
      const data = await res.json();
      set({ tasks: data, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  updateTaskStatus: async (id, status, notes) => {
    set({ updating: true });
    try {
      const res = await authFetch(`/api/open-tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes }),
      });
      if (!res.ok) throw new Error('فشل في تحديث المهمة');
      const updated = await res.json();
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)),
        updating: false,
      }));
    } catch (err: any) {
      set({ error: err.message, updating: false });
    }
  },

  clearError: () => set({ error: null }),
}));
