import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrainingStore } from '../../hooks/useTrainingStore';
import type { CreateTrainingCourseRequest, DeviceModel } from '../../lib/types';
import { authFetch } from '../../lib/authFetch';
import { api } from '../../lib/api';
import {
  GraduationCap, Plus, Search, Filter, ChevronDown,
  Calendar, User, Monitor, Building2, Users, CheckCircle, X, Loader2,
} from 'lucide-react';
import PermissionGate from '../../components/PermissionGate';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';

const STATUS_COLORS: Record<string, string> = {
  'Training Scheduled': 'bg-blue-100 text-blue-700',
  'Training Started': 'bg-amber-100 text-amber-700',
  'Training Completed': 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABELS: Record<string, string> = {
  'Training Scheduled': 'مجدولة',
  'Training Started': 'جارية',
  'Training Completed': 'مكتملة',
};

const emptyForm = {
  training_name: '',
  job_vacancy_id: 0,
  branch: '',
  device_name: '',
  trainer: '',
  start_date: '',
  end_date: '',
  notes: '',
  trainee_application_ids: [] as number[],
};

interface Vacancy { id: number; title: string; branch: string; }
interface EligibleTrainee {
  applicationId: number; firstName: string; lastName: string;
  mobileNumber: string; applicationStatus: string;
}

export default function TrainingCourses() {
  const navigate = useNavigate();
  const {
    courses, filters, loading,
    fetchCourses, setFilter, resetFilters, createCourse,
    fetchEligibleTrainees,
  } = useTrainingStore();

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [eligibleTrainees, setEligibleTrainees] = useState<EligibleTrainee[]>([]);
  const [loadingTrainees, setLoadingTrainees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => { fetchCourses(); }, [
    filters.branch, filters.start_date, filters.end_date, filters.trainer,
    filters.device_name, filters.training_status, filters.job_vacancy_id,
    filters.search,
  ]);

  useEffect(() => {
    if (showModal) {
      authFetch('/api/admin/vacancies?status=Open')
        .then(r => r.json())
        .then(data => setVacancies(Array.isArray(data) ? data : []))
        .catch(() => setVacancies([]));

      api.deviceModels.list()
        .then(data => setDeviceModels(data))
        .catch(() => setDeviceModels([]));
    }
  }, [showModal]);

  async function onVacancyChange(vacId: number) {
    const vac = vacancies.find(v => v.id === vacId);
    setForm(f => ({ ...f, job_vacancy_id: vacId, branch: vac?.branch || '', trainee_application_ids: [] }));
    setEligibleTrainees([]);
    if (vacId) {
      setLoadingTrainees(true);
      try { setEligibleTrainees(await fetchEligibleTrainees(vacId)); }
      catch { setEligibleTrainees([]); }
      finally { setLoadingTrainees(false); }
    }
  }

  function toggleTrainee(appId: number) {
    setForm(f => ({
      ...f,
      trainee_application_ids: f.trainee_application_ids.includes(appId)
        ? f.trainee_application_ids.filter(id => id !== appId)
        : [...f.trainee_application_ids, appId],
    }));
  }

  async function handleSubmit() {
    setSubmitError('');
    if (!form.training_name.trim()) { setSubmitError('اسم الدورة مطلوب'); return; }
    if (!form.job_vacancy_id) { setSubmitError('اختر الشاغر الوظيفي'); return; }
    if (!form.branch.trim()) { setSubmitError('الفرع مطلوب'); return; }
    if (!form.trainer.trim()) { setSubmitError('اسم المدرب مطلوب'); return; }
    if (!form.start_date || !form.end_date) { setSubmitError('تواريخ الدورة مطلوبة'); return; }
    if (form.trainee_application_ids.length === 0) { setSubmitError('اختر متدرباً واحداً على الأقل'); return; }
    setSubmitting(true);
    try {
      const payload: CreateTrainingCourseRequest = {
        training_name: form.training_name,
        job_vacancy_id: form.job_vacancy_id,
        branch: form.branch,
        device_name: form.device_name || undefined,
        trainer: form.trainer,
        start_date: form.start_date,
        end_date: form.end_date,
        notes: form.notes || undefined,
        trainee_application_ids: form.trainee_application_ids,
      };
      const created = await createCourse(payload);
      closeModal();
      navigate(`/jobs/training-courses/${created.id}`);
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal() {
    setShowModal(false);
    setForm({ ...emptyForm });
    setEligibleTrainees([]);
    setSubmitError('');
  }

  const hasFilters = Object.values(filters).some(v => v !== '');

  const trainingColumns: ColumnDef<any>[] = [
    {
      key: 'id', label: '#', sortable: true,
      render: (c) => <span className="text-xs font-mono text-slate-400">#{c.id}</span>,
      getValue: (c) => c.id,
    },
    {
      key: 'trainingName', label: 'اسم الدورة', sortable: true,
      render: (c) => <span className="font-medium text-slate-800">{c.trainingName}</span>,
    },
    {
      key: 'deviceName', label: 'الجهاز', sortable: true,
      render: (c) => (
        <span className="flex items-center gap-1.5 text-slate-600">
          <Monitor className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {c.deviceName || '—'}
        </span>
      ),
    },
    {
      key: 'trainer', label: 'المدرب', sortable: true,
      render: (c) => (
        <span className="flex items-center gap-1.5 text-slate-700 font-medium">
          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {c.trainer}
        </span>
      ),
    },
    {
      key: 'startDate', label: 'البداية', sortable: true,
      render: (c) => (
        <span className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {c.startDate ? new Date(c.startDate).toLocaleDateString('ar-IQ') : '—'}
        </span>
      ),
      getValue: (c) => c.startDate || '',
    },
    {
      key: 'endDate', label: 'النهاية', sortable: true,
      render: (c) => (
        <span className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {c.endDate ? new Date(c.endDate).toLocaleDateString('ar-IQ') : '—'}
        </span>
      ),
      getValue: (c) => c.endDate || '',
    },
    {
      key: 'registeredTraineesCount', label: 'المتدربون', sortable: true,
      render: (c) => (
        <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          {c.registeredTraineesCount}
        </span>
      ),
      getValue: (c) => c.registeredTraineesCount,
    },
    {
      key: 'graduatedTraineesCount', label: 'الناجحون', sortable: true,
      render: (c) => (
        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
          <CheckCircle className="w-3.5 h-3.5" />
          {c.graduatedTraineesCount}
        </span>
      ),
      getValue: (c) => c.graduatedTraineesCount,
    },
    {
      key: 'trainingStatus', label: 'الحالة', sortable: true,
      render: (c) => (
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_COLORS[c.trainingStatus] || 'bg-slate-100 text-slate-600'}`}>
          {STATUS_LABELS[c.trainingStatus] || c.trainingStatus}
        </span>
      ),
      getValue: (c) => c.trainingStatus,
    },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <GraduationCap className="w-7 h-7 text-sky-500" />
            الدورات التدريبية
          </h1>
          <p className="text-sm text-slate-500 mt-1">إدارة دورات التدريب وسجلات الحضور والنتائج</p>
        </div>
        <PermissionGate permission="jobs.training.create">
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-semibold hover:bg-sky-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            إنشاء دورة تدريبية
          </button>
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-slate-500">
          <Filter className="w-4 h-4" />
          <span className="text-sm font-medium">تصفية:</span>
        </div>
        <div className="relative">
          <select
            value={filters.training_status}
            onChange={e => setFilter('training_status', e.target.value)}
            className="appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500"
          >
            <option value="">كل الحالات</option>
            <option value="Training Scheduled">مجدولة</option>
            <option value="Training Started">جارية</option>
            <option value="Training Completed">مكتملة</option>
          </select>
          <ChevronDown className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <input type="text" value={filters.branch} onChange={e => setFilter('branch', e.target.value)}
          placeholder="الفرع..." className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500 w-32" />
        <input type="text" value={filters.trainer} onChange={e => setFilter('trainer', e.target.value)}
          placeholder="المدرب..." className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500 w-32" />
        <input type="date" value={filters.start_date} onChange={e => setFilter('start_date', e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500" />
        <input type="date" value={filters.end_date} onChange={e => setFilter('end_date', e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500" />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={filters.search} onChange={e => setFilter('search', e.target.value)}
            placeholder="بحث بالاسم أو الرقم..."
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pr-10 pl-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500" />
        </div>
        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-red-500 transition-colors">
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            <span className="text-sm">جاري التحميل...</span>
          </div>
        </div>
      ) : (
        <SmartTable<any>
          title="الدورات التدريبية"
          icon={GraduationCap}
          hideFilterBar={true}
          data={courses}
          columns={trainingColumns}
          getId={(c) => c.id}
          tableMinWidth={920}
          emptyIcon={GraduationCap}
          emptyMessage="لا توجد دورات تدريبية"
          onRowClick={(c) => navigate(`/jobs/training-courses/${c.id}`)}
        />
      )}

      {/* Create Course Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-sky-500" />
                إنشاء دورة تدريبية جديدة
              </h2>
              <button onClick={closeModal} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {submitError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{submitError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">اسم الدورة *</label>
                  <input type="text" value={form.training_name}
                    onChange={e => setForm(f => ({ ...f, training_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500"
                    placeholder="مثال: دورة صيانة مكيفات المستوى الأول" />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">الشاغر الوظيفي *</label>
                  <select value={form.job_vacancy_id || ''} onChange={e => onVacancyChange(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500">
                    <option value="">اختر الشاغر...</option>
                    {vacancies.map(v => <option key={v.id} value={v.id}>{v.title} — {v.branch}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> الفرع *
                  </label>
                  <input type="text" value={form.branch}
                    readOnly
                    dir="rtl"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm cursor-not-allowed text-slate-500"
                    placeholder="يتم تحديده تلقائياً من الشاغر" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <Monitor className="w-3 h-3" /> الجهاز
                  </label>
                  <select
                    value={form.device_name}
                    onChange={e => setForm(f => ({ ...f, device_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 bg-white"
                  >
                    <option value="">لا يوجد / اختياري</option>
                    {deviceModels.map(d => (
                      <option key={d.id} value={d.name}>
                        {d.name} {d.brand ? `— ${d.brand}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <User className="w-3 h-3" /> المدرب *
                  </label>
                  <input type="text" value={form.trainer}
                    onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> تاريخ البدء *
                  </label>
                  <input type="date" value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> تاريخ الانتهاء *
                  </label>
                  <input type="date" value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">ملاحظات</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 resize-none" />
                </div>
              </div>

              {/* Eligible Trainees */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  المتدربون المؤهلون *
                  {form.trainee_application_ids.length > 0 && (
                    <span className="mr-auto text-xs text-sky-600 font-normal">تم اختيار {form.trainee_application_ids.length}</span>
                  )}
                </label>
                {!form.job_vacancy_id ? (
                  <p className="text-xs text-slate-400 py-2 px-3 bg-slate-50 rounded-lg">اختر الشاغر الوظيفي أولاً لعرض المتدربين المؤهلين.</p>
                ) : loadingTrainees ? (
                  <div className="flex items-center gap-2 text-slate-400 text-xs py-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري التحميل...
                  </div>
                ) : eligibleTrainees.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2 px-3 bg-slate-50 rounded-lg">لا يوجد مرشحون مؤهلون لهذا الشاغر في الوقت الحالي.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    {eligibleTrainees.map(t => {
                      const selected = form.trainee_application_ids.includes(t.applicationId);
                      return (
                        <label key={t.applicationId}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-slate-100 last:border-0 ${selected ? 'bg-sky-50' : 'hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={selected} onChange={() => toggleTrainee(t.applicationId)}
                            className="w-4 h-4 text-sky-500 rounded" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800">{t.firstName} {t.lastName}</p>
                            <p className="text-xs text-slate-400">طلب #{t.applicationId} · {t.mobileNumber}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.applicationStatus === 'Retraining' ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'}`}>
                            {t.applicationStatus === 'Retraining' ? 'إعادة تدريب' : 'مؤهل'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">إلغاء</button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-sky-600 text-white rounded-xl text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 transition-colors">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                إنشاء الدورة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
