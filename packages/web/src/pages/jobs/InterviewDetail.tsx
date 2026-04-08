import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/authFetch';
import {
  ArrowRight, Users, Calendar, Clock, User, Briefcase, MapPin,
  GraduationCap, CheckCircle, XCircle, Edit, AlertTriangle, X,
  Car, Monitor, Globe, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PermissionGate from '../../components/PermissionGate';

interface InterviewDetail {
  id: number;
  applicationId: number;
  interviewType: 'HR Interview' | 'Technical Interview';
  interviewNumber: 'First Interview' | 'Second Interview';
  interviewerName: string;
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
  interviewerName: string;
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

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    interviewDate: '', interviewTime: '', interviewerName: '',
    interviewType: 'HR Interview', interviewNumber: 'First Interview', internalNotes: '',
  });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Result modal
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

  const openEdit = () => {
    if (!detail) return;
    setEditForm({
      interviewDate: detail.interviewDate ? detail.interviewDate.split('T')[0] : '',
      interviewTime: detail.interviewTime || '',
      interviewerName: detail.interviewerName,
      interviewType: detail.interviewType,
      interviewNumber: detail.interviewNumber,
      internalNotes: detail.internalNotes || '',
    });
    setEditError('');
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    setEditError('');
    if (!editForm.interviewDate) { setEditError('تاريخ المقابلة مطلوب'); return; }
    if (!editForm.interviewTime) { setEditError('وقت المقابلة مطلوب'); return; }
    if (!editForm.interviewerName.trim()) { setEditError('اسم المقابِل مطلوب'); return; }
    setEditSaving(true);
    try {
      const res = await authFetch(`/api/admin/interviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewDate: editForm.interviewDate,
          interviewTime: editForm.interviewTime,
          interviewerName: editForm.interviewerName,
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
      {/* Back + Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/jobs/interviews')}
          className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
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
          {/* Section 1: Interview Info */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-500" /> بيانات المقابلة
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <IRow label="نوع المقابلة" value={detail.interviewType === 'HR Interview' ? 'مقابلة HR' : 'مقابلة تقنية'} />
              <IRow label="رقم المقابلة" value={detail.interviewNumber === 'First Interview' ? 'الأولى' : 'الثانية'} />
              <IRow label="المقابِل" value={detail.interviewerName} />
              <IRow label="التاريخ" value={detail.interviewDate ? new Date(detail.interviewDate).toLocaleDateString('ar-IQ') : '—'} icon={<Calendar className="w-3.5 h-3.5" />} />
              <IRow label="الوقت" value={detail.interviewTime || '—'} icon={<Clock className="w-3.5 h-3.5" />} />
              <IRow label="تاريخ الإنشاء" value={new Date(detail.createdAt).toLocaleDateString('ar-IQ')} />
              {detail.internalNotes && <IRow label="ملاحظات" value={detail.internalNotes} className="col-span-2" />}
            </div>
          </div>

          {/* Section 2: Applicant Info */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
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

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Section 3: Vacancy Info */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-sky-500" /> بيانات الشاغر
            </h3>
            <div className="space-y-3 text-sm">
              <IRow label="#" value={detail.vacancy.id.toString()} />
              <IRow label="عنوان الوظيفة" value={detail.vacancy.title} />
              <IRow label="الفرع" value={detail.vacancy.branch} icon={<MapPin className="w-3.5 h-3.5" />} />
              <button onClick={() => navigate(`/jobs/vacancies/${detail.vacancy.id}`)}
                className="text-xs text-sky-500 hover:text-sky-600 underline mt-1">
                عرض تفاصيل الشاغر
              </button>
            </div>
          </div>

          {/* Actions */}
          {isScheduled && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-4">الإجراءات</h3>
              <div className="space-y-2">
                <PermissionGate permission="jobs.interviews.edit">
                  <button onClick={openEdit} disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold bg-sky-500 hover:bg-sky-600 text-white shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50">
                    <Edit className="w-4 h-4" /> تعديل المقابلة
                  </button>
                </PermissionGate>
                <PermissionGate permission="jobs.interviews.record_result">
                  <button onClick={() => { setResultStatus('Interview Completed'); setResultNotes(''); setShowResultModal(true); }}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/25 transition-all disabled:opacity-50">
                    <CheckCircle className="w-4 h-4" /> تسجيل النتيجة
                  </button>
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

      {/* Edit Modal */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowEditModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-slate-800">تعديل المقابلة</h3>
                <button onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
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
                    <select value={editForm.interviewType} onChange={e => setEditForm(p => ({ ...p, interviewType: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500">
                      <option value="HR Interview">مقابلة HR</option>
                      <option value="Technical Interview">مقابلة تقنية</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">رقم المقابلة</label>
                    <select value={editForm.interviewNumber} onChange={e => setEditForm(p => ({ ...p, interviewNumber: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500">
                      <option value="First Interview">الأولى</option>
                      <option value="Second Interview">الثانية</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">اسم المقابِل *</label>
                  <input value={editForm.interviewerName} onChange={e => setEditForm(p => ({ ...p, interviewerName: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500" />
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
                <button onClick={() => setShowEditModal(false)} className="px-5 py-2.5 text-sm bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors">إلغاء</button>
                <button onClick={handleSaveEdit} disabled={editSaving}
                  className="px-5 py-2.5 text-sm bg-sky-500 text-white rounded-xl hover:bg-sky-600 font-bold shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50">
                  {editSaving ? 'جاري...' : 'حفظ التعديلات'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record Result Modal */}
      <AnimatePresence>
        {showResultModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowResultModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-slate-800">تسجيل نتيجة المقابلة</h3>
                <button onClick={() => setShowResultModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
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
                <button onClick={() => setShowResultModal(false)} className="px-5 py-2.5 text-sm bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors">إلغاء</button>
                <button onClick={handleRecordResult} disabled={actionLoading}
                  className={`px-5 py-2.5 text-sm text-white rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 ${
                    resultStatus === 'Interview Completed' ? 'bg-teal-500 hover:bg-teal-600 shadow-teal-500/25' : 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                  }`}>
                  {actionLoading ? 'جاري...' : 'حفظ النتيجة'}
                </button>
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
