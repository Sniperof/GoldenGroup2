import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInterviewStore } from '../../hooks/useInterviewStore';
import { useVacancyStore } from '../../hooks/useVacancyStore';
import { authFetch } from '../../lib/authFetch';
import {
  Users, Plus, Filter, Calendar, CheckCircle, XCircle, Clock,
  AlertTriangle, X, Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PermissionGate from '../../components/PermissionGate';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';

const STATUS_LABELS: Record<string, string> = {
  'Interview Scheduled': 'مجدولة',
  'Interview Completed': 'مكتملة',
  'Interview Failed': 'فشلت',
};
const STATUS_COLORS: Record<string, string> = {
  'Interview Scheduled': 'bg-amber-100 text-amber-700',
  'Interview Completed': 'bg-teal-100 text-teal-700',
  'Interview Failed': 'bg-red-100 text-red-700',
};

interface ScheduleForm {
  jobVacancyId: string;
  applicationId: string;
  interviewType: 'HR Interview' | 'Technical Interview';
  interviewNumber: 'First Interview' | 'Second Interview';
  interviewerName: string;
  interviewDate: string;
  interviewTime: string;
  internalNotes: string;
}

const emptyForm: ScheduleForm = {
  jobVacancyId: '',
  applicationId: '',
  interviewType: 'HR Interview',
  interviewNumber: 'First Interview',
  interviewerName: '',
  interviewDate: '',
  interviewTime: '',
  internalNotes: '',
};

export default function Interviews() {
  const [searchParams] = useSearchParams();
  const { interviews, filters, loading, fetchInterviews, setFilter, resetFilters, scheduleInterview, recordResult } = useInterviewStore();
  const { vacancies, fetchVacancies } = useVacancyStore();
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [form, setForm] = useState<ScheduleForm>({ ...emptyForm });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultModal, setResultModal] = useState<{ id: number } | null>(null);
  const [resultNotes, setResultNotes] = useState('');
  const [resultStatus, setResultStatus] = useState<'Interview Completed' | 'Interview Failed'>('Interview Completed');
  const [eligibleApps, setEligibleApps] = useState<any[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const highlightedInterviewId = Number(searchParams.get('highlightInterviewId') || 0);

  useEffect(() => {
    fetchVacancies();
  }, []);

  useEffect(() => {
    const nextApplicationId = searchParams.get('applicationId') ?? '';
    const nextJobVacancyId = searchParams.get('jobVacancyId') ?? '';
    const nextInterviewerName = searchParams.get('interviewerName') ?? '';
    const nextDate = searchParams.get('date') ?? '';

    if (filters.applicationId !== nextApplicationId) {
      setFilter('applicationId', nextApplicationId);
    }
    if (filters.jobVacancyId !== nextJobVacancyId) {
      setFilter('jobVacancyId', nextJobVacancyId);
    }
    if (filters.interviewerName !== nextInterviewerName) {
      setFilter('interviewerName', nextInterviewerName);
    }
    if (filters.date !== nextDate) {
      setFilter('date', nextDate);
    }
  }, [searchParams, filters.applicationId, filters.jobVacancyId, filters.interviewerName, filters.date, setFilter]);

  useEffect(() => {
    fetchInterviews();
  }, [filters.applicationId, filters.jobVacancyId, filters.interviewerName, filters.date]);

  async function handleVacancyChange(vacId: string) {
    setForm(p => ({ ...p, jobVacancyId: vacId, applicationId: '' }));
    if (!vacId) {
      setEligibleApps([]);
      return;
    }
    setLoadingEligible(true);
    try {
      const res = await authFetch(`/api/admin/interviews/eligible/${vacId}`);
      if (res.ok) {
        setEligibleApps(await res.json());
      } else {
        setEligibleApps([]);
      }
    } catch {
      setEligibleApps([]);
    } finally {
      setLoadingEligible(false);
    }
  }

  const handleSchedule = async () => {
    if (!form.applicationId.trim()) { setFormError('رقم الطلب مطلوب'); return; }
    if (!form.interviewerName.trim()) { setFormError('اسم المقابِل مطلوب'); return; }
    if (!form.interviewDate) { setFormError('تاريخ المقابلة مطلوب'); return; }
    if (!form.interviewTime) { setFormError('وقت المقابلة مطلوب'); return; }
    setFormError('');
    setSubmitting(true);
    try {
      await scheduleInterview({
        applicationId: Number(form.applicationId),
        interviewType: form.interviewType,
        interviewNumber: form.interviewNumber,
        interviewerName: form.interviewerName,
        interviewDate: form.interviewDate,
        interviewTime: form.interviewTime,
        internalNotes: form.internalNotes || undefined,
      } as any);
      setShowScheduleModal(false);
      setForm({ ...emptyForm });
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordResult = async () => {
    if (!resultModal) return;
    setSubmitting(true);
    try {
      await recordResult(resultModal.id, resultStatus, resultNotes || undefined);
      setResultModal(null);
      setResultNotes('');
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const interviewColumns: ColumnDef<any>[] = [
    {
      key: 'id', label: '#', sortable: true,
      render: (iv) => <span className="text-xs font-mono text-slate-400">#{iv.id}</span>,
      getValue: (iv) => iv.id,
    },
    {
      key: 'applicantFirstName', label: 'المتقدم', sortable: true,
      render: (iv) => (
        <div>
          <p className="font-medium text-slate-800">{iv.applicantFirstName} {iv.applicantLastName}</p>
          <p className="text-xs text-slate-400 mt-0.5">طلب #{iv.applicationId}</p>
        </div>
      ),
    },
    {
      key: 'vacancyTitle', label: 'الوظيفة', sortable: true,
      render: (iv) => <span className="text-slate-600">{iv.vacancyTitle || '—'}</span>,
    },
    {
      key: 'interviewerName', label: 'المقابِل', sortable: true,
      render: (iv) => <span className="font-medium text-slate-700">{iv.interviewerName}</span>,
    },
    {
      key: 'interviewType', label: 'النوع / الرقم',
      render: (iv) => (
        <div className="text-xs text-slate-500">
          <div className="font-medium">{iv.interviewType === 'HR Interview' ? 'مقابلة HR' : 'مقابلة تقنية'}</div>
          <div className="text-slate-400">{iv.interviewNumber === 'First Interview' ? 'الأولى' : 'الثانية'}</div>
        </div>
      ),
    },
    {
      key: 'interviewDate', label: 'التاريخ', sortable: true,
      render: (iv) => (
        <span className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {iv.interviewDate ? new Date(iv.interviewDate).toLocaleDateString('ar-IQ') : '—'}
        </span>
      ),
      getValue: (iv) => iv.interviewDate || '',
    },
    {
      key: 'interviewTime', label: 'الوقت',
      render: (iv) => (
        <span className="flex items-center gap-1 text-xs text-slate-600">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {iv.interviewTime || '—'}
        </span>
      ),
    },
    {
      key: 'interviewStatus', label: 'الحالة', sortable: true,
      render: (iv) => (
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_COLORS[iv.interviewStatus] || 'bg-slate-100 text-slate-600'}`}>
          {STATUS_LABELS[iv.interviewStatus] || iv.interviewStatus}
        </span>
      ),
      getValue: (iv) => iv.interviewStatus,
    },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Users className="w-7 h-7 text-sky-500" />
            إدارة المقابلات
          </h1>
          <p className="text-sm text-slate-500 mt-1">جدولة وتتبع مقابلات التوظيف</p>
        </div>
        <PermissionGate permission="jobs.interviews.schedule">
          <button
            onClick={() => setShowScheduleModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-bold shadow-lg shadow-sky-500/25 text-sm transition-all"
          >
            <Plus className="w-4 h-4" /> جدولة مقابلة
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
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.interviewerName}
            onChange={e => setFilter('interviewerName', e.target.value)}
            placeholder="اسم المقابِل..."
            className="bg-slate-50 border border-slate-200 rounded-lg pr-9 pl-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500 w-44"
          />
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.applicationId}
            onChange={e => setFilter('applicationId', e.target.value)}
            placeholder="رقم الطلب..."
            className="bg-slate-50 border border-slate-200 rounded-lg pr-9 pl-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500 w-36"
          />
        </div>
        <select
          value={filters.jobVacancyId}
          onChange={e => setFilter('jobVacancyId', e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500 w-48"
        >
          <option value="">كل الوظائف</option>
          {vacancies.map(v => (
            <option key={v.id} value={String(v.id)}>{v.title}</option>
          ))}
        </select>
        <input
          type="date"
          value={filters.date}
          onChange={e => setFilter('date', e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500"
        />
        {(filters.interviewerName || filters.applicationId || filters.date || filters.jobVacancyId) && (
          <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-red-500 transition-colors">
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="animate-spin w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full" />
            <span className="text-sm">جاري التحميل...</span>
          </div>
        </div>
      ) : (
        <SmartTable<any>
          title="إدارة المقابلات"
          icon={Users}
          hideFilterBar={true}
          data={interviews}
          columns={interviewColumns}
          getId={(iv) => iv.id}
          tableMinWidth={900}
          emptyIcon={Users}
          emptyMessage="لا توجد مقابلات"
          rowClassName={(iv) =>
            highlightedInterviewId === iv.id
              ? 'bg-sky-50 ring-1 ring-inset ring-sky-200 hover:bg-sky-100'
              : ''
          }
          actions={(iv) =>
            iv.interviewStatus === 'Interview Scheduled' ? (
              <PermissionGate permission="jobs.interviews.record_result">
                <button
                  onClick={() => {
                    setResultModal({ id: iv.id });
                    setResultNotes('');
                    setResultStatus('Interview Completed');
                  }}
                  className="text-xs px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  تسجيل النتيجة
                </button>
              </PermissionGate>
            ) : null
          }
        />
      )}

      {/* Schedule Modal */}
      <AnimatePresence>
        {showScheduleModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowScheduleModal(false)}
          >
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-slate-800">جدولة مقابلة جديدة</h3>
                <button onClick={() => setShowScheduleModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {formError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {formError}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">الشاغر الوظيفي *</label>
                  <select value={form.jobVacancyId} onChange={e => handleVacancyChange(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 bg-white">
                    <option value="">اختر الشاغر...</option>
                    {vacancies.filter(v => v.status === 'Open').map(v => (
                      <option key={v.id} value={v.id}>{v.title} — {v.branch}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">المتقدم (الطلبات المؤهلة) *</label>
                  <select value={form.applicationId} onChange={e => setForm(p => ({ ...p, applicationId: e.target.value }))}
                    disabled={!form.jobVacancyId || loadingEligible}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 bg-white disabled:bg-slate-50 disabled:text-slate-400">
                    <option value="">{loadingEligible ? 'جاري التحميل...' : 'اختر المتقدم...'}</option>
                    {eligibleApps.map(a => (
                      <option key={a.id} value={a.id}>{a.applicantFirstName} {a.applicantLastName} (رقم {a.id})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">نوع المقابلة</label>
                    <select value={form.interviewType}
                      onChange={e => setForm(p => ({ ...p, interviewType: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500">
                      <option value="HR Interview">مقابلة HR</option>
                      <option value="Technical Interview">مقابلة تقنية</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">رقم المقابلة</label>
                    <select value={form.interviewNumber}
                      onChange={e => setForm(p => ({ ...p, interviewNumber: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500">
                      <option value="First Interview">الأولى</option>
                      <option value="Second Interview">الثانية</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">اسم المقابِل *</label>
                  <input value={form.interviewerName}
                    onChange={e => setForm(p => ({ ...p, interviewerName: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">التاريخ *</label>
                    <input type="date" value={form.interviewDate}
                      onChange={e => setForm(p => ({ ...p, interviewDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">الوقت *</label>
                    <input type="time" value={form.interviewTime}
                      onChange={e => setForm(p => ({ ...p, interviewTime: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">ملاحظات</label>
                  <textarea value={form.internalNotes}
                    onChange={e => setForm(p => ({ ...p, internalNotes: e.target.value }))}
                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-5">
                <button onClick={() => setShowScheduleModal(false)}
                  className="px-5 py-2.5 text-sm bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors">
                  إلغاء
                </button>
                <button onClick={handleSchedule} disabled={submitting}
                  className="px-5 py-2.5 text-sm bg-sky-500 text-white rounded-xl hover:bg-sky-600 font-bold shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {submitting ? 'جاري...' : 'جدولة'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record Result Modal */}
      <AnimatePresence>
        {resultModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setResultModal(null)}
          >
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-slate-800">تسجيل نتيجة المقابلة</h3>
                <button onClick={() => setResultModal(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <button
                    onClick={() => setResultStatus('Interview Completed')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                      resultStatus === 'Interview Completed'
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4" /> مكتملة
                  </button>
                  <button
                    onClick={() => setResultStatus('Interview Failed')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                      resultStatus === 'Interview Failed'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <XCircle className="w-4 h-4" /> فشلت
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">ملاحظات</label>
                  <textarea value={resultNotes} onChange={e => setResultNotes(e.target.value)}
                    rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-5">
                <button onClick={() => setResultModal(null)}
                  className="px-5 py-2.5 text-sm bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors">
                  إلغاء
                </button>
                <button onClick={handleRecordResult} disabled={submitting}
                  className={`px-5 py-2.5 text-sm text-white rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 ${
                    resultStatus === 'Interview Completed'
                      ? 'bg-teal-500 hover:bg-teal-600 shadow-teal-500/25'
                      : 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                  }`}>
                  {submitting ? 'جاري...' : 'حفظ النتيجة'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
