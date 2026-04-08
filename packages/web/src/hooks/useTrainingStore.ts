import { create } from 'zustand';
import type { TrainingCourseListItem, TrainingCourseDetail, CreateTrainingCourseRequest } from '../lib/types';
import { authFetch } from '../lib/authFetch';
import { createFetchStore } from '../lib/createFetchStore';

const API = '/api/admin/training-courses';

// ── UI state: filters + pagination ────────────────────────────────────────
// Combined because setFilter / resetFilters must also reset currentPage.

interface TrainingFilters {
  branch: string; start_date: string; end_date: string; trainer: string;
  device_name: string; training_status: string; job_vacancy_id: string; search: string;
}

const defaultFilters: TrainingFilters = {
  branch: '', start_date: '', end_date: '', trainer: '',
  device_name: '', training_status: '', job_vacancy_id: '', search: '',
};

const useTrainingUI = create<{
  filters: TrainingFilters;
  currentPage: number;
  perPage: number;
  setFilter: (key: keyof TrainingFilters, value: string) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
}>()((set) => ({
  filters: { ...defaultFilters },
  currentPage: 1,
  perPage: 25,
  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value }, currentPage: 1 })),
  resetFilters: () => set({ filters: { ...defaultFilters }, currentPage: 1 }),
  setPage: (page) => set({ currentPage: page }),
}));

// ── Server state: course list ─────────────────────────────────────────────

type ListPayload = { courses: TrainingCourseListItem[]; totalCount: number };

const useTrainingList = createFetchStore(async (): Promise<ListPayload> => {
  const { filters, currentPage, perPage } = useTrainingUI.getState();
  const params = new URLSearchParams({ page: String(currentPage), per_page: String(perPage) });
  if (filters.branch)          params.set('branch', filters.branch);
  if (filters.start_date)      params.set('start_date', filters.start_date);
  if (filters.end_date)        params.set('end_date', filters.end_date);
  if (filters.trainer)         params.set('trainer', filters.trainer);
  if (filters.device_name)     params.set('device_name', filters.device_name);
  if (filters.training_status) params.set('training_status', filters.training_status);
  if (filters.job_vacancy_id)  params.set('job_vacancy_id', filters.job_vacancy_id);
  if (filters.search)          params.set('search', filters.search);
  const res = await authFetch(`${API}?${params}`);
  if (!res.ok) throw new Error('فشل تحميل الدورات التدريبية');
  return res.json();
}, { courses: [], totalCount: 0 });

// ── Server state: course detail (own loading/error, different endpoint) ───

const useTrainingDetail = create<{
  selectedCourse: TrainingCourseDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  fetchCourseDetail: (id: number) => Promise<void>;
}>()((set) => ({
  selectedCourse: null,
  detailLoading: false,
  detailError: null,
  async fetchCourseDetail(id) {
    set({ detailLoading: true, detailError: null });
    try {
      const res = await authFetch(`${API}/${id}`);
      if (!res.ok) throw new Error('فشل تحميل تفاصيل الدورة');
      set({ selectedCourse: await res.json(), detailLoading: false });
    } catch (e: unknown) {
      set({ detailError: (e as Error).message, detailLoading: false });
    }
  },
}));

// ── Mutation helpers ──────────────────────────────────────────────────────

type Opts = { performedByRole?: string; performedByUserId?: number };

async function post(url: string, body: unknown) {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'خطأ في الخادم');
  return json;
}

async function patch(url: string, body: unknown) {
  const res = await authFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'خطأ في الخادم');
  return json;
}

// ── Mutations ─────────────────────────────────────────────────────────────

async function createCourse(
  data: CreateTrainingCourseRequest & Opts,
): Promise<TrainingCourseDetail> {
  const json = await post(API, data);
  await useTrainingList.getState().fetch();
  return json;
}

async function startCourse(id: number, opts: Opts = {}): Promise<void> {
  await patch(`${API}/${id}/start`, opts);
  await Promise.all([
    useTrainingDetail.getState().fetchCourseDetail(id),
    useTrainingList.getState().fetch(),
  ]);
}

async function completeCourse(id: number, opts: Opts = {}): Promise<void> {
  await patch(`${API}/${id}/complete`, opts);
  await Promise.all([
    useTrainingDetail.getState().fetchCourseDetail(id),
    useTrainingList.getState().fetch(),
  ]);
}

async function recordAttendance(
  courseId: number,
  attendance_date: string,
  attendance: Array<{ application_id: number; status: 'Present' | 'Absent' }>,
  opts: Opts = {},
): Promise<void> {
  await post(`${API}/${courseId}/attendance`, { attendance_date, attendance, ...opts });
  await useTrainingDetail.getState().fetchCourseDetail(courseId);
}

async function recordTraineeResult(
  courseId: number,
  applicationId: number,
  result: 'Passed' | 'Retraining' | 'Rejected' | 'Retreated',
  opts: Opts = {},
): Promise<void> {
  await patch(`${API}/${courseId}/trainees/${applicationId}/result`, { result, ...opts });
  await useTrainingDetail.getState().fetchCourseDetail(courseId);
}

async function addTrainees(
  courseId: number,
  application_ids: number[],
  opts: Opts = {},
): Promise<void> {
  await post(`${API}/${courseId}/trainees`, { application_ids, ...opts });
  await useTrainingDetail.getState().fetchCourseDetail(courseId);
}

async function fetchEligibleTrainees(jobVacancyId: number): Promise<Array<{
  applicationId: number; firstName: string; lastName: string;
  mobileNumber: string; applicationStatus: string;
}>> {
  const res = await authFetch(`${API}/eligible/${jobVacancyId}`);
  if (!res.ok) throw new Error('فشل تحميل المرشحين المؤهلين');
  return res.json();
}

// ── Public hook — identical API to the old single store ───────────────────

export function useTrainingStore() {
  const { data: { courses, totalCount }, loading, error, fetch: fetchCourses } = useTrainingList();
  const { filters, currentPage, perPage, setFilter, resetFilters, setPage } = useTrainingUI();
  const { selectedCourse, detailLoading, detailError, fetchCourseDetail } = useTrainingDetail();
  return {
    courses, totalCount, currentPage, perPage,
    filters, loading, error,
    selectedCourse, detailLoading, detailError,
    fetchCourses, fetchCourseDetail,
    setFilter, resetFilters, setPage,
    createCourse, startCourse, completeCourse,
    recordAttendance, recordTraineeResult, addTrainees, fetchEligibleTrainees,
  };
}
