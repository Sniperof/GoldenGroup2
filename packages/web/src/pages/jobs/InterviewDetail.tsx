import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/authFetch';
import type { InterviewerOption } from '../../lib/types';
import {
  ArrowRight, Users, Calendar, Clock, User, Briefcase, MapPin,
  GraduationCap, CheckCircle, XCircle, Edit, AlertTriangle, X,
  Car, Monitor, Globe, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import IconButton from '../../components/ui/IconButton';
import PermissionGate from '../../components/PermissionGate';
import Button from '../../components/ui/Button';
import { fetchInterviewersForApplication } from './interviewerLookup';
import Select from '../../components/ui/Select';

interface InterviewDetail {
  id: number;
  applicationId: number;
  interviewType: 'HR Interview' | 'Technical Interview';
  interviewNumber: 'First Interview' | 'Second Interview';
  interviewerName: string;
  interviewerUserId?: number | null;
  interviewerUsername?: string | null;
  interviewerRoleDisplayName?: string | null;
  interviewDate: string;
  interviewTime: string;
  interviewStatus: 'Interview Scheduled' | 'Interview Completed' | 'Interview Failed';
  internalNotes: string | null;
  createdAt: string;
  applicant: {
    firstName: string; lastName: string; dob: string;
    governorate: string; cityOrArea: string;
    academicQualification: string; previousEmployment: string;
    drivingLicense: string | null; expectedSalary: number | null;
    foreignLanguages: string | null; computerSkills: string | null;
    yearsOfExperience: number | null;
  };
  vacancy: { id: number; title: string; branch: string };
}

interface EditForm {
  interviewDate: string;
  interviewTime: string;
  interviewerUserId: string;
  interviewType: 'HR Interview' | 'Technical Interview';
  interviewNumber: 'First Interview' | 'Second Interview';
  internalNotes: string;
}

const STATUS_COLORS: Record<string, string> = {
  'Interview Scheduled': 'bg-amber-100 text-amber-700',
  'Interview Completed': 'bg-teal-100 text-teal-700',
  'Interview Failed': 'bg-red-100 text-red-700',
};
const STATUS_LABELS: Record<string, string> = {
  'Interview Scheduled': 'مجدولة',
  'Interview Completed': 'مكتملة',
  'Interview Failed': 'فشلت',
};

export default function InterviewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [interviewers, setInterviewers] = useState<InterviewerOption[]>([]);
  const [loadingInterviewers, setLoadingInterviewers] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    interviewDate: '', interviewTime: '', interviewerUserId: '',
    interviewType: 'HR Interview', interviewNumber: 'First Interview', internalNotes: '',
  });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [showResultModal, setShowResultModal] = useState(false);
  const [resultStatus, setResultStatus] = useState<'Interview Completed' | 'Interview Failed'>('Interview Completed');
  const [resultNotes, setResultNotes] = useState('');

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/interviews/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);

  const loadInterviewers = async (applicationId: number, currentInterviewerUserId?: number | null) => {
    setLoadingInterviewers(true);
    try {
      const rows = await fetchInterviewersForApplication(applicationId, currentInterviewerUserId);
      setInterviewers(rows);
      return rows;
    } finally {
      setLoadingInterviewers(false);
    }
  };

  const openEdit = async () => {
    if (!detail) return;
    setEditError('');
    try {
      const rows = await loadInterviewers(detail.applicationId, detail.interviewerUserId ?? null);
      setEditForm({
        interviewDate: detail.interviewDate ? detail.interviewDate.split('T')[0] : '',
        interviewTime: detail.interviewTime || '',
        interviewerUserId:
          detail.interviewerUserId != null
            ? String(detail.interviewerUserId)
            : rows[0]
              ? String(rows[0].id)
              : '',
        interviewType: detail.interviewType,
        interviewNumber: detail.interviewNumber,
        internalNotes: detail.internalNotes || '',
      });
      setShowEditModal(true);
    } catch (err: any) {
      setEditError(err.message || 'تعذر تحميل قائمة المقابلين المؤهلين حالياً.');
      setShowEditModal(true);
    }
  };

  const handleSaveEdit = async () => {
    setEditError('');
    if (!editForm.interviewDate) { setEditError('تاريخ المقابلة مطلوب'); return; }
    if (!editForm.interviewTime) { setEditError('وقت المقابلة مطلوب'); return; }
    if (!editForm.interviewerUserId.trim()) { setEditError('يجب اختيار المقابِل من القائمة'); return; }
    setEditSaving(true);
    try {
      const res = await authFetch(`/api/admin/interviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewDate: editForm.interviewDate,
          interviewTime: editForm.interviewTime,
          interviewerUserId: Number(editForm.interviewerUserId),
          interviewType: editForm.interviewType,
          interviewNumber: editForm.interviewNumber,
          internalNotes: editForm.internalNotes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setShowEditModal(false);
      await fetchDetail();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleRecordResult = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/interviews/${id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewStatus: resultStatus, internalNotes: resultNotes || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setShowResultModal(false);
      setResultNotes('');
      await fetchDetail();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <p>المقابلة غير موجودة</p>
      </div>
    );
  }

  const isScheduled = detail.interviewStatus === 'Interview Scheduled';

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/jobs/interviews')}
          className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-500" />
            مقابلة #{detail.id} — {detail.applicant.firstName} {detail.applicant.lastName}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">طلب #{detail.applicationId} — {detail.vacancy.title}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${STATUS_COLORS[detail.interviewStatus]}`}>
          {STATUS_LABELS[detail.interviewStatus]}
        </span>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {actionError}
          <button onClick={() => setActionError('')} className="mr-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-500" /> بيانات المقابلة
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <IRow label="نوع المقابلة" value={detail.interviewType === 'HR Interview' ? 'مقابلة HR' : 'مقابلة تقنية'} />
              <IRow label="رقم المقابلة" value={detail.interviewNumber === 'First Interview' ? 'الأولى' : 'الثانية'} />
              <IRow
                label="المقابِل"
                value={
                  detail.interviewerUsername
                    ? `${detail.interviewerName} (@${detail.interviewerUsername})`
                    : detail.interviewerName
                }
              />
              <IRow label="التاريخ" value={detail.interviewDate ? new Date(detail.interviewDate).toLocaleDateString('ar-IQ') : '—'} icon={<Calendar className="w-3.5 h-3.5" />} />
              <IRow label="الوقت" value={detail.interviewTime || '—'} icon={<Clock className="w-3.5 h-3.5" />} />
              <IRow label="تاريخ الإنشاء" value={new Date(detail.createdAt).toLocaleDateString('ar-IQ')} />
              {detail.interviewerRoleDisplayName ? <IRow label="دور المقابِل" value={detail.interviewerRoleDisplayName} /> : null}
              {detail.internalNotes && <IRow label="ملاحظات" value={detail.internalNotes} className="col-span-2" />}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-sky-500" /> بيانات المتقدم
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <IRow label="الاسم الكامل" value={`${detail.applicant.firstName} ${detail.applicant.lastName}`} />
              <IRow label="تاريخ الميلاد" value={detail.applicant.dob ? new Date(detail.applicant.dob).toLocaleDateString('ar-IQ') : '—'} />
              <IRow label="المحافظة" value={detail.applicant.governorate || '—'} />
              <IRow label="المدينة / المنطقة" value={detail.applicant.cityOrArea || '—'} />
              <IRow label="المؤهل الدراسي" value={detail.applicant.academicQualification || '—'} icon={<GraduationCap className="w-3.5 h-3.5" />} />
              <IRow label="جهة العمل السابقة" value={detail.applicant.previousEmployment || '—'} />
              <IRow label="سنوات الخبرة" value={detail.applicant.yearsOfExperience?.toString() || '—'} />
              <IRow label="الراتب المتوقع" value={detail.applicant.expectedSalary ? `${detail.applicant.expectedSalary} د.ع` : '—'} icon={<DollarSign className="w-3.5 h-3.5" />} />
              <IRow label="مهارات الحاسب" value={detail.applicant.computerSkills || '—'} icon={<Monitor className="w-3.5 h-3.5" />} />
              <IRow label="اللغات الأجنبية" value={detail.applicant.foreignLanguages || '—'} icon={<Globe className="w-3.5 h-3.5" />} />
              <IRow label="رخصة القيادة" value={detail.applicant.drivingLicense || '—'} icon={<Car className="w-3.5 h-3.5" />} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-sky-500" /> بيانات الشاغر
            </h3>
            <div className="space-y-3 text-sm">
              <IRow label="#" value={detail.vacancy.id.toString()} />
              <IRow label="عنوان الوظيفة" value={detail.vacancy.title} />
              <IRow label="الفرع" value={detail.vacancy.branch} icon={<MapPin className="w-3.5 h-3.5" />} />
              <Button variant="ghost" size="sm" onClick={() => navigate(`/jobs/vacancies/${detail.vacancy.id}`)} className="text-sky-500 hover:text-sky-600 hover:bg-sky-50 px-2 mt-1">
                عرض تفاصيل الشاغر
              </Button>
            </div>
          </div>

          {isScheduled && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-800 mb-4">الإجراءات</h3>
              <div className="space-y-2">
                <PermissionGate permission="jobs.interviews.edit">
                  <Button fullWidth icon={Edit} onClick={openEdit} disabled={actionLoading}>
                    تعديل المقابلة
                  </Button>
                </PermissionGate>
                <PermissionGate permission="jobs.interviews.record_result">
                  <Button fullWidth icon={CheckCircle} onClick={() => { setResultStatus('Interview Completed'); setResultNotes(''); setShowResultModal(true); }} disabled={actionLoading} className="bg-teal-500 hover:bg-teal-600">
                    تسجيل النتيجة
                  </Button>
                </PermissionGate>
              </div>
            </div>
          )}

          {!isScheduled && (
            <div className={`rounded-2xl border p-4 text-center text-sm font-bold ${
              detail.interviewStatus === 'Interview Completed'
                ? 'bg-teal-50 border-teal-200 text-teal-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {STATUS_LABELS[detail.interviewStatus]}
              <p className="text-xs font-normal mt-1 opacity-70">لا يمكن تعديل هذه المقابلة</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showEditModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowEditModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-slate-800">تعديل المقابلة</h3>
                <IconButton icon={X} label="إغلاق" size="sm" onClick={() => setShowEditModal(false)} />
              </div>
              {editError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {editError}
                </div>
              )}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">نوع المقابلة</label>
                    <Select<'HR Interview' | 'Technical Interview'>
                      value={editForm.interviewType}
                      onChange={v => setEditForm(p => ({ ...p, interviewType: v }))}
                      ariaLabel="نوع المقابلة"
                      className="w-full"
                      options={[
                        { value: 'HR Interview', label: 'مقابلة HR' },
                        { value: 'Technical Interview', label: 'مقابلة تقنية' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">رقم المقابلة</label>
                    <Select<'First Interview' | 'Second Interview'>
                      value={editForm.interviewNumber}
                      onChange={v => setEditForm(p => ({ ...p, interviewNumber: v }))}
                      ariaLabel="رقم المقابلة"
                      className="w-full"
                      options={[
                        { value: 'First Interview', label: 'الأولى' },
                        { value: 'Second Interview', label: 'الثانية' },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">المقابِل *</label>
                  <Select
                    value={editForm.interviewerUserId}
                    onChange={v => setEditForm(p => ({ ...p, interviewerUserId: v }))}
                    disabled={loadingInterviewers}
                    placeholder={loadingInterviewers
                      ? 'جاري تحميل المقابلين...'
                      : interviewers.length === 0
                        ? 'لا يوجد مقابِلون مؤهلون'
                        : 'اختر المقابِل...'}
                    ariaLabel="المقابِل"
                    className="w-full"
                    options={interviewers.map(option => ({
                      value: String(option.id),
                      label: `${option.name}${option.username ? ` (@${option.username})` : ''}${option.roleDisplayName ? ` — ${option.roleDisplayName}` : ''}`,
                    }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">التاريخ *</label>
                    <input type="date" value={editForm.interviewDate} onChange={e => setEditForm(p => ({ ...p, interviewDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">الوقت *</label>
                    <input type="time" value={editForm.interviewTime} onChange={e => setEditForm(p => ({ ...p, interviewTime: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">ملاحظات</label>
                  <textarea value={editForm.internalNotes} onChange={e => setEditForm(p => ({ ...p, internalNotes: e.target.value }))}
                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-5">
                <Button variant="secondary" onClick={() => setShowEditModal(false)}>إلغاء</Button>
                <Button loading={editSaving} onClick={handleSaveEdit}>
                  {editSaving ? 'جاري...' : 'حفظ التعديلات'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showResultModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowResultModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-slate-800">تسجيل نتيجة المقابلة</h3>
                <IconButton icon={X} label="إغلاق" size="sm" onClick={() => setShowResultModal(false)} />
              </div>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <button onClick={() => setResultStatus('Interview Completed')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                      resultStatus === 'Interview Completed' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
                    <CheckCircle className="w-4 h-4" /> مكتملة
                  </button>
                  <button onClick={() => setResultStatus('Interview Failed')}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                      resultStatus === 'Interview Failed' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
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
                <Button variant="secondary" onClick={() => setShowResultModal(false)}>إلغاء</Button>
                <Button loading={actionLoading} onClick={handleRecordResult} className={resultStatus === 'Interview Completed' ? 'bg-teal-500 hover:bg-teal-600' : 'bg-red-500 hover:bg-red-600'}>
                  {actionLoading ? 'جاري...' : 'حفظ النتيجة'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IRow({ label, value, icon, className }: { label: string; value: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="text-xs text-slate-400 block mb-0.5">{label}</span>
      <span className="text-slate-700 flex items-center gap-1.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        {value}
      </span>
    </div>
  );
}
