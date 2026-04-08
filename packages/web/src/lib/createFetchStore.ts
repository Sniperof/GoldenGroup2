import { create } from 'zustand';

/**
 * Factory for server-state Zustand slices.
 *
 * Eliminates the repeated `loading / error / fetch` boilerplate that
 * appears in every store that calls an API.  The returned store manages
 * exactly one piece of remote data plus its request lifecycle.
 *
 * The `fetcher` is called with no arguments each time `fetch()` is
 * invoked — close over any dynamic parameters (e.g., current filter
 * values via `someFilterStore.getState()`) inside the function body.
 *
 * @example
 * const useVacancyList = createFetchStore(
 *   () => authFetch('/api/admin/vacancies').then(r => r.json()),
 *   [] as JobVacancy[],
 * );
 */
export function createFetchStore<T>(fetcher: () => Promise<T>, initial: T) {
  return create<{
    data: T;
    loading: boolean;
    error: string | null;
    fetch: () => Promise<void>;
  }>()((set) => ({
    data: initial,
    loading: false,
    error: null,
    async fetch() {
      set({ loading: true, error: null });
      try {
        const data = await fetcher();
        set({ data, loading: false });
      } catch (e: unknown) {
        set({ error: (e as Error).message, loading: false });
      }
    },
  }));
}
