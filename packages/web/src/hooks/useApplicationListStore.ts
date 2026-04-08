import type { JobApplicationListItem, ApplicationStage, ApplicationStatus } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFilterStore } from '../lib/createFilterStore';
import { createFetchStore } from '../lib/createFetchStore';

const API_BASE = '/api/admin/applications';

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

// ── Server state: list ─────────────────────────────────────────────────────

const useApplicationList = createFetchStore(async () => {
  const f = useApplicationFilters.getState().filters;
  const params = new URLSearchParams();
  if (f.vacancyId)         params.set('vacancyId', f.vacancyId);
  if (f.branch)            params.set('branch', f.branch);
  if (f.gender)            params.set('gender', f.gender);
  if (f.stage)             params.set('stage', f.stage);
  if (f.status)            params.set('status', f.status);
  if (f.search)            params.set('search', f.search);
  if (f.applicationSource) params.set('applicationSource', f.applicationSource);
  params.set('isArchived', f.isArchived);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch applications');
  return res.json() as Promise<JobApplicationListItem[]>;
}, [] as JobApplicationListItem[]);

// ── Public hook — identical API to the old single store ───────────────────

export function useApplicationListStore() {
  const { data: applications, loading, error, fetch: fetchApplications } = useApplicationList();
  const { filters, setFilter, resetFilters } = useApplicationFilters();
  return { applications, loading, error, filters, setFilter, resetFilters, fetchApplications };
}
