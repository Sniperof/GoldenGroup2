import { create } from 'zustand';
import type { Interview } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFilterStore } from '../lib/createFilterStore';
import { createFetchStore } from '../lib/createFetchStore';

const API_BASE = '/api/admin/interviews';
const PAGE_LIMIT = 25;

// ── UI state: filters ──────────────────────────────────────────────────────

interface InterviewFilters {
  applicationId: string;
  jobVacancyId: string;
  interviewerName: string;
  date: string;
}

const defaultFilters: InterviewFilters = {
  applicationId: '', jobVacancyId: '', interviewerName: '', date: '',
};

const useInterviewFilters = createFilterStore(defaultFilters);

// ── Pagination state ───────────────────────────────────────────────────────

const useInterviewPagination = create<{
  page: number; total: number; totalPages: number;
  setPage: (p: number) => void;
  setMeta: (meta: { total: number; totalPages: number }) => void;
}>()((set) => ({
  page: 1, total: 0, totalPages: 1,
  setPage: (page) => set({ page }),
  setMeta: ({ total, totalPages }) => set({ total, totalPages }),
}));

// ── Server state: list ─────────────────────────────────────────────────────

type EnrichedInterview = Interview & {
  applicantFirstName?: string;
  applicantLastName?: string;
  vacancyTitle?: string;
};

const useInterviewList = createFetchStore(async () => {
  const f = useInterviewFilters.getState().filters;
  const { page } = useInterviewPagination.getState();
  const params = new URLSearchParams();
  if (f.applicationId)   params.set('applicationId', f.applicationId);
  if (f.jobVacancyId)    params.set('jobVacancyId', f.jobVacancyId);
  if (f.interviewerName) params.set('interviewerName', f.interviewerName);
  if (f.date)            params.set('date', f.date);
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  const res = await authFetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch interviews');
  const result = await res.json();
  if (result && result.data && result.total !== undefined) {
    useInterviewPagination.getState().setMeta({ total: result.total, totalPages: result.totalPages });
    return result.data as EnrichedInterview[];
  }
  return result as EnrichedInterview[];
}, [] as EnrichedInterview[]);

// ── Mutations ──────────────────────────────────────────────────────────────

async function scheduleInterview(data: Partial<Interview>): Promise<Interview> {
  const res = await authFetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to schedule interview');
  }
  const interview: EnrichedInterview = await res.json();
  useInterviewList.setState((s) => ({ data: [interview, ...s.data] }));
  return interview;
}

async function recordResult(
  id: number,
  interviewStatus: string,
  internalNotes?: string,
): Promise<Interview> {
  const res = await authFetch(`${API_BASE}/${id}/result`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewStatus, internalNotes }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to record result');
  }
  const updated: EnrichedInterview = await res.json();
  useInterviewList.setState((s) => ({
    data: s.data.map((i) => (i.id === id ? { ...i, ...updated } : i)),
  }));
  return updated;
}

// ── Public hook ────────────────────────────────────────────────────────────

export function useInterviewStore() {
  const { data: interviews, loading, error, fetch: _fetch } = useInterviewList();
  const { filters, setFilter: _setFilter, resetFilters: _resetFilters } = useInterviewFilters();
  const { page, total, totalPages } = useInterviewPagination();

  function fetchInterviews() {
    useInterviewList.getState().fetch();
  }

  function setFilter<K extends keyof InterviewFilters>(key: K, value: InterviewFilters[K]) {
    useInterviewPagination.setState({ page: 1 });
    _setFilter(key, value);
  }

  function resetFilters() {
    useInterviewPagination.setState({ page: 1 });
    _resetFilters();
  }

  function goToPage(p: number) {
    useInterviewPagination.setState({ page: p });
    useInterviewList.getState().fetch();
  }

  return {
    interviews, loading, error,
    filters, setFilter, resetFilters, fetchInterviews,
    scheduleInterview, recordResult,
    page, total, totalPages, limit: PAGE_LIMIT, goToPage,
  };
}
