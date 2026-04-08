import type { JobVacancy, VacancyStatus } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFilterStore } from '../lib/createFilterStore';
import { createFetchStore } from '../lib/createFetchStore';

const API_BASE = '/api/admin/vacancies';

// ── UI state: filters ──────────────────────────────────────────────────────

interface VacancyFilters {
  status: VacancyStatus | '';
  branch: string;
  search: string;
}

const defaultFilters: VacancyFilters = { status: '', branch: '', search: '' };

const useVacancyFilters = createFilterStore(defaultFilters);

// ── Server state: list ─────────────────────────────────────────────────────
// Fetcher closes over the filter store — reads current filters at call time.

const useVacancyList = createFetchStore(async () => {
  const { status, branch, search } = useVacancyFilters.getState().filters;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (branch)  params.set('branch', branch);
  if (search)  params.set('search', search);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch vacancies');
  return res.json() as Promise<JobVacancy[]>;
}, [] as JobVacancy[]);

// ── Mutations ──────────────────────────────────────────────────────────────
// Module-level functions — no loading state (callers own their UI feedback).

async function createVacancy(data: Partial<JobVacancy>): Promise<JobVacancy> {
  const res = await authFetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create vacancy');
  }
  const vacancy: JobVacancy = await res.json();
  useVacancyList.setState((s) => ({ data: [vacancy, ...s.data] }));
  return vacancy;
}

async function updateVacancy(
  id: number,
  data: Partial<JobVacancy>,
): Promise<JobVacancy & { editTier: number }> {
  const res = await authFetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update vacancy');
  }
  const updated = await res.json();
  useVacancyList.setState((s) => ({
    data: s.data.map((v) => (v.id === id ? { ...v, ...updated } : v)),
  }));
  return updated;
}

async function updateVacancyStatus(
  id: number,
  status: 'Open' | 'Closed' | 'Archived',
): Promise<void> {
  const res = await authFetch(`${API_BASE}/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update status');
  }
  useVacancyList.setState((s) => ({
    data: s.data.map((v) => (v.id === id ? { ...v, status } : v)),
  }));
}

// ── Public hook — identical API to the old single store ───────────────────

export function useVacancyStore() {
  const { data: vacancies, loading, error, fetch: fetchVacancies } = useVacancyList();
  const { filters, setFilter, resetFilters } = useVacancyFilters();
  return {
    vacancies,
    loading,
    error,
    filters,
    setFilter,
    resetFilters,
    fetchVacancies,
    createVacancy,
    updateVacancy,
    updateVacancyStatus,
  };
}
