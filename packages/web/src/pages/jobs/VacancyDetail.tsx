import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { JobVacancy, JobApplicationListItem, ApplicationStage } from '../../lib/types';
import { authFetch } from '../../lib/authFetch';
import {
  ArrowRight, Briefcase, MapPin, Calendar, Users, GraduationCap, Edit,
  XCircle, RotateCcw, Archive, Lock, X, AlertTriangle, CheckCircle,
  ClipboardList, Eye, Mail, Phone, Smartphone, Globe,
  PhoneCall, User, BookOpen, Clock, TrendingUp,
  MessageSquare, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PermissionGate from '../../components/PermissionGate';
import PaginationBar from '../../components/PaginationBar';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import { useBranchStore } from '../../hooks/useBranchStore';
import type { BranchContact, BranchContactType } from '../../lib/types';
import { calculateJobMatchScore } from '../../lib/jobMatch';
import { getUnifiedApplicationState, getUnifiedApplicationStateDotClasses } from '../../lib/applicationState';

interface VacancyDetailData extends JobVacancy {
  applicationsCount: number;
  hiredCount: number;
  remainingSlots: number;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-emerald-100 text-emerald-700',
  Closed: 'bg-red-100 text-red-700',
  Archived: 'bg-slate-100 text-slate-500',
};
const STATUS_LABELS: Record<string, string> = {
  Open: 'مفتوحة', Closed: 'مغلقة', Archived: 'مؤرشفة',
};

/* ── Application table maps (mirrors Applications.tsx) ── */
const STAGE_COLORS: Record<ApplicationStage, string> = {
  'Submitted': 'bg-blue-100 text-blue-700',
  'Shortlisted': 'bg-purple-100 text-purple-700',
  'Interview': 'bg-amber-100 text-amber-700',
  'Training': 'bg-cyan-100 text-cyan-700',
  'Final Decision': 'bg-emerald-100 text-emerald-700',
};
const STAGE_LABELS: Record<ApplicationStage, string> = {
  Submitted: 'استلام الطلب', Shortlisted: 'القائمة القصيرة',
  Interview: 'المقابلة', Training: 'التدريب', 'Final Decision': 'القرار النهائي',
};
const APP_STATUS_LABELS: Record<string, string> = {
  'New': 'جديد', 'In Review': 'قيد المراجعة', 'Qualified': 'مؤهل', 'Rejected': 'مرفوض',
  'Interview Scheduled': 'مقابلة مجدولة', 'Interview Completed': 'مقابلة مكتملة',
  'Interview Failed': 'فشل المقابلة', 'Approved': 'موافق عليه',
  'Training Scheduled': 'تدريب مجدول', 'Training Started': 'تدريب بدأ',
  'Training Completed': 'تدريب مكتمل', 'Retraining': 'إعادة تدريب',
  'Passed': 'ناجح', 'Final Hired': 'تم التوظيف',
  'Final Rejected': 'مرفوض نهائياً', 'Retreated': 'منسحب',
};
const APP_STATUS_DOT: Record<string, string> = {
  'New': 'bg-blue-400', 'In Review': 'bg-indigo-400', 'Qualified': 'bg-emerald-400',
  'Rejected': 'bg-red-400', 'Interview Scheduled': 'bg-amber-400', 'Interview Completed': 'bg-teal-400',
  'Interview Failed': 'bg-red-400', 'Approved': 'bg-green-400', 'Training Scheduled': 'bg-cyan-400',
  'Training Started': 'bg-sky-400', 'Training Completed': 'bg-emerald-400', 'Retraining': 'bg-orange-400',
  'Passed': 'bg-green-400', 'Final Hired': 'bg-emerald-500', 'Final Rejected': 'bg-red-500',
  'Retreated': 'bg-slate-400',
};

const CONTACT_ICONS: Record<BranchContactType, React.ElementType> = {
  email: Mail, phone: Phone, mobile: Smartphone, website: Globe,
};
const CONTACT_LABELS: Record<BranchContactType, string> = {
  email: 'بريد', phone: 'هاتف', mobile: 'موبايل', website: 'موقع',
};
const CONTACT_TAG_COLORS: Record<BranchContactType, string> = {
  email: 'bg-rose-50 text-rose-600 border-rose-100',
  phone: 'bg-sky-50 text-sky-600 border-sky-100',
  mobile: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  website: 'bg-indigo-50 text-indigo-600 border-indigo-100',
};

const AVATAR_COLORS = [
  'bg-sky-100 text-sky-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700', 'bg-rose-100 text-rose-700',
];

/* ── Edit form compact input ── */
function inputCls(locked: boolean) {
  return `w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors ${
    locked ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-100' : 'border-slate-200 bg-white'
  }`;
}

/* ════════════════════════════════════════════════════════════ */
export default function VacancyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<VacancyDetailData | null>(null);
  const [applications, setApplications] = useState<JobApplicationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [applicationsLimit, setApplicationsLimit] = useState(10);
  const [applicationsTotal, setApplicationsTotal] = useState(0);
  const [applicationsTotalPages, setApplicationsTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<Partial<JobVacancy>>({});
  const [editTier, setEditTier] = useState<1 | 2 | 3>(1);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [branchContacts, setBranchContacts] = useState<BranchContact[]>([]);
  const { fetchLists, getValuesByCategory } = useSystemListsStore();
  const { branches, fetchBranches } = useBranchStore();

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const [vacRes, appRes] = await Promise.all([
        authFetch(`/api/admin/vacancies/${id}`),
        authFetch(`/api/admin/applications?vacancyId=${id}&isArchived=false&page=${applicationsPage}&limit=${applicationsLimit}`),
      ]);
      if (vacRes.ok) setDetail(await vacRes.json());
      if (appRes.ok) {
        const result = await appRes.json() as PaginatedResponse<JobApplicationListItem>;
        setApplications(result.data || []);
        setApplicationsTotal(result.total || 0);
        setApplicationsTotalPages(result.totalPages || 1);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchDetail(); fetchLists(); fetchBranches(); }, [id, applicationsPage, applicationsLimit]);

  const handleStatusChange = async (newStatus: 'Open' | 'Closed' | 'Archived') => {
    setActionLoading(true); setActionError('');
    try {
      const res = await authFetch(`/api/admin/vacancies/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      await fetchDetail();
    } catch (err: any) { setActionError(err.message); }
    finally { setActionLoading(false); }
  };

  const openEdit = () => {
    if (!detail) return;
    setFormData({ ...detail });
    const branch = branches.find(b => b.name === detail.branch);
    setBranchContacts(branch?.contactInfo || []);
    setEditTier(1); setFormError(''); setShowModal(true);
  };

  const setField = (k: string, v: any) => setFormData(p => ({ ...p, [k]: v }));
  const isLocked = (f: 'full' | 'partial') => f === 'full' ? editTier >= 2 : editTier >= 3;

  const toggleContact = (contact: BranchContact, checked: boolean) => {
    const cur = formData.contactMethods || [];
    setField('contactMethods', checked ? [...cur, contact] : cur.filter(c => c.id !== contact.id));
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.title?.trim()) { setFormError('عنوان الوظيفة مطلوب'); return; }
    if (!formData.startDate) { setFormError('تاريخ البداية مطلوب'); return; }
    if (!formData.endDate) { setFormError('تاريخ النهاية مطلوب'); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/admin/vacancies/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      const result = await res.json();
      setEditTier(result.editTier as 1 | 2 | 3);
      setShowModal(false); await fetchDetail();
    } catch (err: any) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  /* ── derived stats ── */
  const totalApplications = applications.length;
  const shortlistedCount = applications.filter(a => a.currentStage === 'Shortlisted').length;
  const inInterviewCount = applications.filter(a => a.currentStage === 'Interview').length;
  const inTrainingCount = applications.filter(a => a.currentStage === 'Training').length;
  const hiredCount = applications.filter(a => a.decision === 'Hired' || a.applicationStatus === 'Final Hired').length;
  
  const fillRate = (detail && detail.vacancyCount > 0)
    ? Math.min(100, Math.round((hiredCount / detail.vacancyCount) * 100))
    : 0;

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!detail) return (
    <div className="h-full flex items-center justify-center text-slate-400">
      <p>الشاغر غير موجود</p>
    </div>
  );

  const locationStr = [detail.governorate, detail.cityOrArea, detail.subArea, detail.neighborhood]
    .filter(Boolean).join(' / ');

  const skills = detail.requiredSkills
    ? detail.requiredSkills.split(/[,،\n]/).map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50/50" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/jobs/vacancies')}
          className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors shadow-sm">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-800">إدارة التوظيف</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            إدارة شاغر {detail.title} · المرجع: JOB-2024-{id}
          </p>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />{actionError}
          <button onClick={() => setActionError('')} className="mr-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* ── Statistics Cards – 5 columns ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'إجمالي المرشحين', value: totalApplications, icon: Users,        accent: 'text-sky-600',     bg: 'bg-sky-50',     border: 'border-sky-100'     },
          { label: 'القائمة القصيرة',  value: shortlistedCount,          icon: ClipboardList, accent: 'text-purple-600',  bg: 'bg-purple-50',  border: 'border-purple-100'  },
          { label: 'المقابلات',         value: inInterviewCount,          icon: MessageSquare, accent: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100'   },
          { label: 'قيد التدريب',        value: inTrainingCount,           icon: GraduationCap, accent: 'text-cyan-600',    bg: 'bg-cyan-50',    border: 'border-cyan-100'    },
          { label: 'تم التوظيف',        value: hiredCount,         icon: CheckCircle,   accent: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
        ].map(s => (
          <div key={s.label} className={`bg-white rounded-2xl border ${s.border} p-4 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between">
              <div className={`p-1.5 rounded-lg ${s.bg}`}>
                <s.icon className={`w-4 h-4 ${s.accent}`} />
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{s.label}</span>
            </div>
            <p className={`text-2xl font-bold ${s.accent}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">

        {/* ── Sidebar (right in RTL – first in DOM) ── */}
        <div className="space-y-4">

          {/* Job Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5 text-sky-500" /> معلومات الشاغر
            </h3>
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">نوع العمل</span>
                <span className="text-sm font-medium text-slate-700">{detail.workType || '—'}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-slate-400 shrink-0">المسمى الوظيفي</span>
                <span className="text-sm font-medium text-slate-700 text-end">{detail.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">تاريخ النشر</span>
                <span className="text-sm font-medium text-slate-700">
                  {(detail as any).createdAt
                    ? new Date((detail as any).createdAt).toLocaleDateString('ar-IQ')
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">الحالة</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[detail.status]}`}>
                  {STATUS_LABELS[detail.status]}
                </span>
              </div>
            </div>

            {/* Fill Rate */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>نسبة الإشغال</span>
                <span className="font-bold text-slate-700">{fillRate}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${fillRate}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className={`h-full rounded-full ${fillRate >= 100 ? 'bg-emerald-500' : fillRate >= 60 ? 'bg-sky-500' : 'bg-amber-400'}`}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">{hiredCount} / {detail.vacancyCount} شاغر</p>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <PermissionGate permission="jobs.vacancies.edit">
                {detail.status !== 'Archived' && (
                  <button onClick={openEdit} disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold bg-sky-500 hover:bg-sky-600 text-white shadow-sm shadow-sky-500/25 transition-all disabled:opacity-50">
                    <Edit className="w-4 h-4" /> تعديل
                  </button>
                )}
              </PermissionGate>
              <PermissionGate permission="jobs.vacancies.change_status">
                {detail.status === 'Open' && (
                  <button onClick={() => handleStatusChange('Closed')} disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold border border-red-200 text-red-600 hover:bg-red-50 transition-all disabled:opacity-50">
                    <XCircle className="w-4 h-4" /> إغلاق
                  </button>
                )}
                {detail.status === 'Closed' && (
                  <>
                    <button onClick={() => handleStatusChange('Open')} disabled={actionLoading}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-all disabled:opacity-50">
                      <RotateCcw className="w-4 h-4" /> إعادة فتح
                    </button>
                    <button onClick={() => handleStatusChange('Archived')} disabled={actionLoading}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold border border-amber-200 text-amber-600 hover:bg-amber-50 transition-all disabled:opacity-50">
                      <Archive className="w-4 h-4" /> أرشفة
                    </button>
                  </>
                )}
                {detail.status === 'Archived' && (
                  <button onClick={() => handleStatusChange('Open')} disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-all disabled:opacity-50">
                    <RotateCcw className="w-4 h-4" /> إعادة فتح (مدير HR)
                  </button>
                )}
              </PermissionGate>
            </div>
          </div>

        </div>

        {/* ── Main Content (left in RTL – second in DOM) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Requirements Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <GraduationCap className="w-3.5 h-3.5 text-sky-500" /> متطلبات الشاغر
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                <GraduationCap className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">المؤهل العلمي</p>
                  <p className="text-sm font-medium text-slate-700">{detail.requiredCertificate || '—'}</p>
                  {detail.requiredMajor && <p className="text-xs text-slate-500 mt-0.5">{detail.requiredMajor}</p>}
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                <MapPin className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">الموقع</p>
                  <p className="text-sm font-medium text-slate-700">{locationStr || '—'}</p>
                  {detail.detailedAddress && (
                    <p className="text-xs text-slate-500 mt-0.5">{detail.detailedAddress}</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">الخبرة المطلوبة</p>
                  <p className="text-sm font-medium text-slate-700">
                    {detail.requiredExperienceYears != null
                      ? `${detail.requiredExperienceYears} سنة فأكثر`
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                <User className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">الجنس والعمر</p>
                  <p className="text-sm font-medium text-slate-700">{detail.requiredGender || 'لا يهم'}</p>
                  {(detail.requiredAgeMin || detail.requiredAgeMax) && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {detail.requiredAgeMin || '—'} – {detail.requiredAgeMax || '—'} سنة
                    </p>
                  )}
                </div>
              </div>
            </div>
            {detail.responsibilities && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">المسؤوليات والمهام</p>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{detail.responsibilities}</p>
              </div>
            )}
          </div>

          {/* Skills Tags */}
          {skills.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-sky-500" /> التقنيات المطلوبة
              </h3>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill, i) => (
                  <span key={i}
                    className="px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-100 text-sky-700 text-xs font-semibold">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Contact Methods */}
          {detail.contactMethods && detail.contactMethods.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <PhoneCall className="w-3.5 h-3.5 text-sky-500" /> وسائل التواصل المنشورة مع الشاغر
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {detail.contactMethods.map(c => {
                  const Icon = CONTACT_ICONS[c.type];
                  return (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold border ${CONTACT_TAG_COLORS[c.type]}`}>
                        <Icon className="w-3 h-3" /> {CONTACT_LABELS[c.type]}
                      </span>
                      <span className="font-mono text-sm text-slate-700" dir="ltr">{c.value}</span>
                      {c.label && <span className="text-xs text-slate-400 mr-auto">— {c.label}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Candidates Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <Users className="w-4 h-4 text-sky-500" />
          <h3 className="text-sm font-bold text-slate-700">المرشحون المرتبطون</h3>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold">
            {applications.length}
          </span>
        </div>
        {applications.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا يوجد مرشحون لهذا الشاغر</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pt-4">
              <span className="text-xs text-slate-500">عدد النتائج: {applicationsTotal}</span>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span>لكل صفحة</span>
                <select
                  value={applicationsLimit}
                  onChange={(e) => {
                    setApplicationsLimit(parseInt(e.target.value, 10));
                    setApplicationsPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  {[5, 10, 25, 50].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
            </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">المرشح</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">تاريخ التقديم</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">نسبة التوافق</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">المرحلة</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">الحالة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const matchPct = calculateJobMatchScore(
                    {
                      dob: app.applicantDob || undefined,
                      gender: app.applicantGender,
                      governorate: app.applicantGovernorate || undefined,
                      cityOrArea: app.applicantCityOrArea || undefined,
                      academicQualification: app.applicantAcademicQualification || undefined,
                      specialization: app.applicantSpecialization || undefined,
                      drivingLicense: app.applicantDrivingLicense,
                      computerSkills: app.applicantComputerSkills || undefined,
                      yearsOfExperience: app.applicantYearsOfExperience || 0,
                    },
                    {
                      governorate: app.vacancyGovernorate || undefined,
                      cityOrArea: app.vacancyCityOrArea || undefined,
                      requiredGender: app.vacancyRequiredGender || undefined,
                      requiredAgeMin: app.vacancyRequiredAgeMin ?? undefined,
                      requiredAgeMax: app.vacancyRequiredAgeMax ?? undefined,
                      requiredCertificate: app.vacancyRequiredCertificate || undefined,
                      requiredMajor: app.vacancyRequiredMajor || undefined,
                      requiredExperienceYears: app.vacancyRequiredExperienceYears ?? undefined,
                      requiredSkills: app.vacancyRequiredSkills || undefined,
                      drivingLicenseRequired: Boolean(app.vacancyDrivingLicenseRequired),
                    },
                  ).score;
                  const initials = `${app.applicantFirstName?.[0] || ''}${app.applicantLastName?.[0] || ''}`;
                  const avatarColor = AVATAR_COLORS[app.id % 5];
                  const unifiedState = getUnifiedApplicationState({
                    currentStage: app.currentStage,
                    applicationStatus: app.applicationStatus,
                    stageStatus: app.stageStatus,
                    decision: app.decision,
                    hasScheduledInterview: app.hasScheduledInterview,
                  });
                  const dotColor = getUnifiedApplicationStateDotClasses(unifiedState.tone);
                  return (
                    <tr key={app.id}
                      className="border-b border-slate-100 hover:bg-sky-50/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/jobs/applications/${app.id}`)}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor}`}>
                            {initials || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-800 text-sm">
                              {app.applicantFirstName} {app.applicantLastName}
                            </p>
                            <p className="text-xs text-slate-400">{app.applicantGender || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {new Date(app.createdAt).toLocaleDateString('ar-IQ')}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs font-bold text-slate-700">{matchPct}%</span>
                          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${matchPct >= 80 ? 'bg-emerald-400' : matchPct >= 65 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${matchPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STAGE_COLORS[app.currentStage]}`}>
                          {STAGE_LABELS[app.currentStage]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                          <span className="text-xs text-slate-600">
                            {unifiedState.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/jobs/applications/${app.id}`)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={applicationsPage}
            totalPages={applicationsTotalPages}
            total={applicationsTotal}
            limit={applicationsLimit}
            onPageChange={setApplicationsPage}
          />
          </>
        )}
      </div>

      {/* ── Edit Modal (preserved) ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={() => setShowModal(false)}>
            <motion.div
              initial={{ scale: 0.96, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
              style={{ maxHeight: 'min(90vh, 720px)' }}
              onClick={e => e.stopPropagation()} dir="rtl">

              {/* Header */}
              <div className="px-7 pt-6 pb-4 border-b border-slate-100 shrink-0 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">تعديل الشاغر الوظيفي</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{detail.title} — {detail.branch}</p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5">
                {formError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{formError}
                  </div>
                )}
                {editTier > 1 && (
                  <div className={`rounded-xl p-3 text-sm flex items-center gap-2 ${editTier === 2 ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    <Lock className="w-4 h-4 shrink-0" />
                    {editTier === 2
                      ? 'تعديل مقيد: يمكن تعديل تاريخ الانتهاء والمسؤوليات والمهارات ووسائل التواصل فقط'
                      : 'تعديل مقيد: يمكن تعديل تاريخ الانتهاء فقط'}
                  </div>
                )}

                {/* Basic */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" /> الأساسيات
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">عنوان الوظيفة *</label>
                    <select value={formData.title || ''} onChange={e => setField('title', e.target.value)} disabled={isLocked('full')} className={inputCls(isLocked('full'))}>
                      <option value="">اختر عنوان الوظيفة</option>
                      {getValuesByCategory('job_title').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">الفرع</label>
                      <select value={formData.branch || ''} onChange={e => {
                        setField('branch', e.target.value);
                        const b = branches.find(b => b.name === e.target.value);
                        setBranchContacts(b?.contactInfo || []);
                        setField('contactMethods', []);
                      }} disabled={isLocked('full')} className={inputCls(isLocked('full'))}>
                        {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">نوع العمل</label>
                      <select value={formData.workType || ''} onChange={e => setField('workType', e.target.value || null)} disabled={isLocked('full')} className={inputCls(isLocked('full'))}>
                        <option value="">—</option>
                        {getValuesByCategory('work_type').map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Requirements */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5" /> المتطلبات
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">الشهادة</label>
                      <select value={formData.requiredCertificate || ''} onChange={e => { setField('requiredCertificate', e.target.value || null); setField('requiredMajor', null); }} disabled={isLocked('full')} className={inputCls(isLocked('full'))}>
                        <option value="">—</option>
                        {getValuesByCategory('certificate').map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">الاختصاص</label>
                      <select value={formData.requiredMajor || ''} onChange={e => setField('requiredMajor', e.target.value || null)} disabled={isLocked('full') || !formData.requiredCertificate} className={inputCls(isLocked('full') || !formData.requiredCertificate)}>
                        <option value="">{formData.requiredCertificate ? 'اختر' : 'اختر الشهادة أولاً'}</option>
                        {formData.requiredCertificate && getValuesByCategory(`major:${formData.requiredCertificate}`).map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">سنوات الخبرة</label>
                      <input type="number" value={formData.requiredExperienceYears ?? ''} onChange={e => setField('requiredExperienceYears', e.target.value ? parseInt(e.target.value) : null)} disabled={isLocked('full')} className={inputCls(isLocked('full'))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">الجنس</label>
                      <select value={formData.requiredGender || ''} onChange={e => setField('requiredGender', e.target.value || null)} disabled={isLocked('full')} className={inputCls(isLocked('full'))}>
                        <option value="">لا يهم</option>
                        {getValuesByCategory('gender').map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">المهارات المطلوبة</label>
                    <textarea value={formData.requiredSkills || ''} onChange={e => setField('requiredSkills', e.target.value || null)} rows={2} disabled={isLocked('partial')} className={inputCls(isLocked('partial'))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">المسؤوليات</label>
                    <textarea value={formData.responsibilities || ''} onChange={e => setField('responsibilities', e.target.value || null)} rows={2} disabled={isLocked('partial')} className={inputCls(isLocked('partial'))} />
                  </div>
                </div>

                {/* Contact Methods */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5" /> وسائل التواصل
                  </p>
                  {branchContacts.length > 0 ? (
                    <div className="space-y-2">
                      {branchContacts.map(contact => {
                        const Icon = CONTACT_ICONS[contact.type];
                        const isSelected = (formData.contactMethods || []).some(c => c.id === contact.id);
                        return (
                          <label key={contact.id} className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-sky-400 bg-white' : 'border-transparent bg-white/70 hover:border-slate-200'}`}>
                            <input type="checkbox" checked={isSelected} disabled={isLocked('partial')} onChange={e => toggleContact(contact, e.target.checked)} className="sr-only" />
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-sky-500 border-sky-500' : 'border-slate-300'}`}>
                              {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${CONTACT_TAG_COLORS[contact.type]}`}>
                              <Icon className="w-3 h-3" /> {CONTACT_LABELS[contact.type]}
                            </span>
                            <span className="font-mono text-xs text-slate-700" dir="ltr">{contact.value}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-3">لا توجد وسائل تواصل لهذا الفرع</p>
                  )}
                </div>

                {/* Dates */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> التوقيت
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">البداية *</label>
                      <input type="date" value={formData.startDate || ''} onChange={e => setField('startDate', e.target.value)} disabled={isLocked('full')} className={inputCls(isLocked('full'))} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">الانتهاء *</label>
                      <input type="date" value={formData.endDate || ''} onChange={e => setField('endDate', e.target.value)} className={inputCls(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">عدد الشواغر</label>
                      <input type="number" min={1} value={formData.vacancyCount ?? 1} onChange={e => setField('vacancyCount', parseInt(e.target.value) || 1)} disabled={isLocked('full')} className={inputCls(isLocked('full'))} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-7 py-4 border-t border-slate-100 shrink-0 flex justify-between bg-white">
                <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">إلغاء</button>
                <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-xl shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 flex items-center gap-2">
                  {saving ? 'جاري الحفظ...' : <><CheckCircle className="w-4 h-4" /> حفظ التعديلات</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
