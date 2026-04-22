import { create } from 'zustand';

/**
 * Super-admin branch context: which branch's data to view/write against.
 * Non-super users ignore this entirely — the server always scopes them to
 * their own branch regardless of what header we send.
 *
 * Persisted to localStorage so the selection survives reloads.
 */

const STORAGE_KEY = 'hr_branch_context';

interface BranchContextState {
  branchId: number | null;
  setBranchId: (id: number | null) => void;
  clear: () => void;
}

const loadInitial = (): number | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

export const useBranchContextStore = create<BranchContextState>((set) => ({
  branchId: loadInitial(),
  setBranchId(id) {
    if (id == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
    set({ branchId: id });
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
    set({ branchId: null });
  },
}));

/** Read the current selection synchronously (for attaching to fetch headers). */
export function getCurrentBranchContext(): number | null {
  return useBranchContextStore.getState().branchId;
}
