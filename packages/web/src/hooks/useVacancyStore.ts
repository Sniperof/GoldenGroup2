import { create } from 'zustand';
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

// ── Pagination state ───────────────────────────────────────────────────────

const useVacancyPagination = create<{
  page: number; total: number; totalPages: number; limit: number;
  setPage: (p: number) => void;
  setLimit: (limit: number) => void;
  setMeta: (meta: { total: number; totalPages: number }) => void;
}>()((set) => ({
  page: 1, total: 0, totalPages: 1, limit: 25,
  setPage: (page) => set({ page }),
  setLimit: (limit) => set({ limit, page: 1 }),
  setMeta: ({ total, totalPages }) => set({ total, totalPages }),
}));

// ── Server state: list ─────────────────────────────────────────────────────

const useVacancyList = createFetchStore(async () => {
  const { status, branch, search } = useVacancyFilters.getState().filters;
  const { page, limit } = useVacancyPagination.getState();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (branch)  params.set('branch', branch);
  if (search)  params.set('search', search);
  params.set('page', String(page));
  params.set('limit', String(limit));
  const res = await authFetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch vacancies');
  const result = await res.json();
  if (result && result.data && result.total !== undefined) {
    useVacancyPagination.getState().setMeta({ total: result.total, totalPages: result.totalPages });
    return result.data as JobVacancy[];
  }
  return result as JobVacancy[];
}, [] as JobVacancy[]);

// ── Mutations ──────────────────────────────────────────────────────────────

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

// ── Public hook ────────────────────────────────────────────────────────────

export function useVacancyStore() {
  const { data: vacancies, loading, error, fetch: _fetch } = useVacancyList();
  const { filters, setFilter: _setFilter, resetFilters: _resetFilters } = useVacancyFilters();
  const { page, total, totalPages, limit } = useVacancyPagination();

  function fetchVacancies() {
    useVacancyList.getState().fetch();
  }

  function setFilter<K extends keyof VacancyFilters>(key: K, value: VacancyFilters[K]) {
    useVacancyPagination.setState({ page: 1 });
    _setFilter(key, value);
  }

  function resetFilters() {
    useVacancyPagination.setState({ page: 1 });
    _resetFilters();
  }

  function goToPage(p: number) {
    useVacancyPagination.setState({ page: p });
    useVacancyList.getState().fetch();
  }

  function setLimit(nextLimit: number) {
    useVacancyPagination.getState().setLimit(nextLimit);
    useVacancyList.getState().fetch();
  }

  return {
    vacancies, loading, error,
    filters, setFilter, resetFilters, fetchVacancies,
    createVacancy, updateVacancy, updateVacancyStatus,
    page, total, totalPages, limit, goToPage, setLimit,
  };
}
