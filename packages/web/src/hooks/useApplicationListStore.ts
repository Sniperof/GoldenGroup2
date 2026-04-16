import { create } from 'zustand';
import type { JobApplicationListItem, ApplicationStage, ApplicationStatus } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFilterStore } from '../lib/createFilterStore';
import { createFetchStore } from '../lib/createFetchStore';

const API_BASE = '/api/admin/applications';
const PAGE_LIMIT = 25;

// ── UI state: filters ──────────────────────────────────────────────────────

interface ApplicationFilters {
  vacancyId: string;
  branch: string;
  gender: string;
  stage: ApplicationStage | '';
  status: ApplicationStatus | '';
  search: string;
  applicationSource: string;
  isArchived: string;
}

const defaultFilters: ApplicationFilters = {
  vacancyId: '', branch: '', gender: '', stage: '', status: '', search: '',
  applicationSource: '', isArchived: 'false',
};

const useApplicationFilters = createFilterStore(defaultFilters);

// ── Pagination state ───────────────────────────────────────────────────────

const useApplicationPagination = create<{
  page: number; total: number; totalPages: number;
  setPage: (p: number) => void;
  setMeta: (meta: { total: number; totalPages: number }) => void;
}>()((set) => ({
  page: 1, total: 0, totalPages: 1,
  setPage: (page) => set({ page }),
  setMeta: ({ total, totalPages }) => set({ total, totalPages }),
}));

// ── Server state: list ─────────────────────────────────────────────────────

const useApplicationList = createFetchStore(async () => {
  const f = useApplicationFilters.getState().filters;
  const { page } = useApplicationPagination.getState();
  const params = new URLSearchParams();
  if (f.vacancyId)         params.set('vacancyId', f.vacancyId);
  if (f.branch)            params.set('branch', f.branch);
  if (f.gender)            params.set('gender', f.gender);
  if (f.stage)             params.set('stage', f.stage);
  if (f.status)            params.set('status', f.status);
  if (f.search)            params.set('search', f.search);
  if (f.applicationSource) params.set('applicationSource', f.applicationSource);
  params.set('isArchived', f.isArchived);
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  const res = await authFetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch applications');
  const result = await res.json();
  if (result && result.data && result.total !== undefined) {
    useApplicationPagination.getState().setMeta({ total: result.total, totalPages: result.totalPages });
    return result.data as JobApplicationListItem[];
  }
  return result as JobApplicationListItem[];
}, [] as JobApplicationListItem[]);

// ── Public hook — identical API to the old single store ───────────────────

export function useApplicationListStore() {
  const { data: applications, loading, error, fetch: _fetch } = useApplicationList();
  const { filters, setFilter: _setFilter, resetFilters: _resetFilters } = useApplicationFilters();
  const { page, total, totalPages } = useApplicationPagination();

  function fetchApplications() {
    useApplicationList.getState().fetch();
  }

  function setFilter<K extends keyof ApplicationFilters>(key: K, value: ApplicationFilters[K]) {
    useApplicationPagination.setState({ page: 1 });
    _setFilter(key, value);
  }

  function resetFilters() {
    useApplicationPagination.setState({ page: 1 });
    _resetFilters();
  }

  function goToPage(p: number) {
    useApplicationPagination.setState({ page: p });
    useApplicationList.getState().fetch();
  }

  return {
    applications, loading, error,
    filters, setFilter, resetFilters, fetchApplications,
    page, total, totalPages, limit: PAGE_LIMIT, goToPage,
  };
}
