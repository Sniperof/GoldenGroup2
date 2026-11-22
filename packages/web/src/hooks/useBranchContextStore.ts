import { create } from 'zustand';

/**
 * The external branch filter (sidebar switcher) for cross-branch users.
 *
 * Two values, deliberately separate:
 *  - `preferredBranchId` — what the user picked in the switcher. Persisted, and
 *    kept as-is while they move between sections.
 *  - `branchId` — the EFFECTIVE branch for the current section: the preferred
 *    one when this section's grant reaches it, otherwise null ("all the
 *    branches you can see here"). Every page and the X-Branch-Id header read
 *    this, so a section whose grant is BRANCH-scoped never sends a branch the
 *    server would refuse (empty list / 403) just because another section
 *    allowed it. Returning to a section that reaches the preferred branch
 *    restores it automatically.
 *
 * `sectionBranchIds` is set by <SectionBranchScopeSync> on every navigation
 * (lib/sectionBranchReach.ts): null = no limit, an array = only these.
 * Single-branch users never get a switcher; the server scopes them.
 */

const STORAGE_KEY = 'hr_branch_context';

interface BranchContextState {
  /** Effective branch for the current section (null = all reachable branches). */
  branchId: number | null;
  /** The user's own choice in the switcher, independent of the section. */
  preferredBranchId: number | null;
  /** Branches the current section's grant reaches; null = every branch. */
  sectionBranchIds: number[] | null;
  setBranchId: (id: number | null) => void;
  setSectionBranchIds: (ids: number[] | null) => void;
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

function effectiveBranch(preferred: number | null, limit: number[] | null): number | null {
  if (preferred == null) return null;
  return limit == null || limit.includes(preferred) ? preferred : null;
}

function sameIds(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true;
  if (a == null || b == null || a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

const initialPreferred = loadInitial();

export const useBranchContextStore = create<BranchContextState>((set, get) => ({
  branchId: initialPreferred,
  preferredBranchId: initialPreferred,
  sectionBranchIds: null,
  setBranchId(id) {
    try {
      if (id == null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(id));
    } catch { /* storage unavailable — the in-memory value still applies */ }
    set({ preferredBranchId: id, branchId: effectiveBranch(id, get().sectionBranchIds) });
  },
  setSectionBranchIds(ids) {
    const state = get();
    if (sameIds(state.sectionBranchIds, ids)) return;
    const branchId = effectiveBranch(state.preferredBranchId, ids);
    set({ sectionBranchIds: ids, branchId });
  },
  clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    set({ branchId: null, preferredBranchId: null, sectionBranchIds: null });
  },
}));

/** The effective branch for the current section (for the X-Branch-Id header). */
export function getCurrentBranchContext(): number | null {
  return useBranchContextStore.getState().branchId;
}
