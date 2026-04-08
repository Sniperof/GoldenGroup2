import type { Interview } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFilterStore } from '../lib/createFilterStore';
import { createFetchStore } from '../lib/createFetchStore';

const API_BASE = '/api/admin/interviews';

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

// ── Server state: list ─────────────────────────────────────────────────────

type EnrichedInterview = Interview & {
  applicantFirstName?: string;
  applicantLastName?: string;
  vacancyTitle?: string;
};

const useInterviewList = createFetchStore(async () => {
  const f = useInterviewFilters.getState().filters;
  const params = new URLSearchParams();
  if (f.applicationId)   params.set('applicationId', f.applicationId);
  if (f.jobVacancyId)    params.set('jobVacancyId', f.jobVacancyId);
  if (f.interviewerName) params.set('interviewerName', f.interviewerName);
  if (f.date)            params.set('date', f.date);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch interviews');
  return res.json() as Promise<EnrichedInterview[]>;
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

// ── Public hook — identical API to the old single store ───────────────────

export function useInterviewStore() {
  const { data: interviews, loading, error, fetch: fetchInterviews } = useInterviewList();
  const { filters, setFilter, resetFilters } = useInterviewFilters();
  return {
    interviews,
    loading,
    error,
    filters,
    setFilter,
    resetFilters,
    fetchInterviews,
    scheduleInterview,
    recordResult,
  };
}
