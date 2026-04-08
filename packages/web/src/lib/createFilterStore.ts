import { create } from 'zustand';

/**
 * Factory for filter-only Zustand slices.
 *
 * Eliminates the repeated `setFilter` / `resetFilters` boilerplate that
 * appears in every mixed store. The returned store holds nothing but UI
 * state — no loading flags, no server data.
 *
 * @example
 * const useVacancyFilters = createFilterStore({ status: '', branch: '', search: '' });
 */
export function createFilterStore<F extends object>(defaults: F) {
  return create<{
    filters: F;
    setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
    resetFilters: () => void;
  }>()((set) => ({
    filters: { ...defaults } as F,
    setFilter: (key, value) =>
      set((s) => ({ filters: { ...s.filters, [key]: value } as F })),
    resetFilters: () => set({ filters: { ...defaults } as F }),
  }));
}
