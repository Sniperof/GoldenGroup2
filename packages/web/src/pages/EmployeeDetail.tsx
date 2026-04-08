import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  FileText,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  UserCircle2,
  UserRoundCog,
} from 'lucide-react';
import { api } from '../lib/api';
import type { EmployeeDetail as EmployeeDetailType } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';
import { useRoleStore } from '../hooks/useRoleStore';
import { getUnifiedApplicationState, getUnifiedApplicationStateClasses } from '../lib/applicationState';

const ROLE_LABELS: Record<EmployeeDetailType['role'], string> = {
  supervisor: 'مشرفة',
  technician: 'فني',
  telemarketer: 'تيلماركتر',
};

const STATUS_META: Record<EmployeeDetailType['status'], { label: string; className: string }> = {
  active: { label: 'نشط', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  leave: { label: 'إجازة', className: 'bg-amber-50 text-amber-700 border border-amber-100' },
  inactive: { label: 'غير فعال', className: 'bg-slate-100 text-slate-600 border border-slate-200' },
};

const STAGE_LABELS: Record<string, string> = {
  Submitted: 'استلام الطلب',
  Shortlisted: 'القائمة القصيرة',
  Interview: 'المقابلة',
  Training: 'التدريب',
  'Final Decision': 'القرار النهائي',
};

const DECISION_LABELS: Record<string, string> = {
  Qualified: 'مؤهل',
  Approved: 'معتمد',
  Passed: 'اجتاز',
  Hired: 'تم التوظيف',
  Rejected: 'مرفوض',
  Failed: 'راسب',
  Retraining: 'إعادة تدريب',
  Retreated: 'منسحب',
};

const SOURCE_LABELS: Record<string, string> = {
  'Mobile App': 'تطبيق الجوال',
  Website: 'الموقع الإلكتروني',
  'External Platforms': 'منصات خارجية',
  Internal: 'داخلي',
};

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  'Interview Scheduled': 'مجدولة',
  'Interview Completed': 'مكتملة',
  'Interview Failed': 'مرفوضة',
};

const TRAINING_RESULT_LABELS: Record<string, string> = {
  Passed: 'اجتاز',
  Retraining: 'إعادة تدريب',
  Rejected: 'مرفوض',
  Retreated: 'منسحب',
};

type ProfileForm = {
  name: string;
  mobile: string;
  branch: string;
  residence: string;
  jobTitle: string;
  status: EmployeeDetailType['status'];
};

type AccountForm = {
  username: string;
  password: string;
  roleId: string;
  isActive: boolean;
};

export default function EmployeeDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const employeeId = Number(id);
  const { roles, fetchRoles } = useRoleStore();
  const { hasPermission } = usePermissions();
  const canEditEmployee = hasPermission('employees.edit');
  const canManageSystemAccess = hasPermission('admin.roles.manage');

  const [detail, setDetail] = useState<EmployeeDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: '',
    mobile: '',
    branch: '',
    residence: '',
    jobTitle: '',
    status: 'active',
  });
  const [accountForm, setAccountForm] = useState<AccountForm>({
    username: '',
    password: '',
    roleId: '',
    isActive: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadEmployee() {
      if (!employeeId) {
        setError('تعذر تحديد الموظف المطلوب');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const data = await api.employees.get(employeeId) as EmployeeDetailType;
        if (cancelled) return;

        setDetail(data);
        setProfileForm({
          name: data.name,
          mobile: data.mobile,
          branch: data.branch ?? '',
          residence: data.residence ?? '',
          jobTitle: data.jobTitle ?? '',
          status: data.status,
        });
        setAccountForm({
          username: data.systemAccount?.username ?? '',
          password: '',
          roleId: data.systemAccount?.roleId ? String(data.systemAccount.roleId) : '',
          isActive: data.systemAccount?.isActive ?? true,
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? 'تعذر تحميل بيانات الموظف');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadEmployee();
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => {
    if (!canManageSystemAccess) return;
    fetchRoles();
  }, [canManageSystemAccess, fetchRoles]);

  async function handleSaveProfile() {
    if (!detail) return;

    setSavingProfile(true);
    setProfileMessage('');
    setError('');
    try {
      const updated = await api.employees.update(detail.id, profileForm) as EmployeeDetailType;
      setDetail((current) => current ? { ...current, ...updated } : updated);
      setProfileForm({
        name: updated.name,
        mobile: updated.mobile,
        branch: updated.branch ?? '',
        residence: updated.residence ?? '',
        jobTitle: updated.jobTitle ?? '',
        status: updated.status,
      });
      setProfileMessage('تم حفظ بيانات الموظف');
    } catch (err: any) {
      setError(err.message ?? 'تعذر حفظ بيانات الموظف');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveSystemAccount() {
    if (!detail) return;

    setSavingAccount(true);
    setAccountMessage('');
    setError('');
    try {
      const updatedAccount = await api.employees.upsertSystemAccount(detail.id, {
        username: accountForm.username,
        password: accountForm.password,
        roleId: Number(accountForm.roleId),
        isActive: accountForm.isActive,
      });

      setDetail((current) => current ? {
        ...current,
        systemAccount: updatedAccount,
      } : current);
      setAccountForm((current) => ({ ...current, password: '' }));
      setAccountMessage(detail.systemAccount ? 'تم تحديث حساب النظام والدور' : 'تم إنشاء حساب النظام وربطه بالموظف');
    } catch (err: any) {
      setError(err.message ?? 'تعذر حفظ حساب النظام');
    } finally {
      setSavingAccount(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          جاري تحميل ملف الموظف...
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-md w-full">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-4">
            <UserRoundCog className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">تعذر فتح ملف الموظف</h2>
          <p className="text-sm text-slate-500 leading-relaxed mb-5">
            {error || 'الموظف المطلوب غير موجود أو لا يمكن الوصول إليه.'}
          </p>
          <button
            onClick={() => navigate('/employees')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            العودة إلى السجلات
          </button>
        </div>
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[detail.role];
  const statusMeta = STATUS_META[detail.status];
  const activeRoles = roles.filter((role) => role.isActive || role.id === detail.systemAccount?.roleId);
  const isLinkedToHiringApplication = Boolean(detail.hiringApplication);
  const lockedFromHiringSource = !canEditEmployee || isLinkedToHiringApplication;
  const hiringState = detail.hiringApplication
    ? getUnifiedApplicationState({
        currentStage: detail.hiringApplication.currentStage,
        applicationStatus: detail.hiringApplication.applicationStatus,
        stageStatus: detail.hiringApplication.stageStatus,
        decision: detail.hiringApplication.decision,
        hasScheduledInterview: detail.hiringApplication.interviews.some((interview) => interview.interviewStatus === 'Interview Scheduled'),
      })
    : null;

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate('/employees')}
              className="mt-1 inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-sky-600 hover:border-sky-200 transition-colors"
              title="العودة إلى الموظفين"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm shrink-0">
              {detail.avatar ? (
                <img src={detail.avatar} alt={detail.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-sky-50 text-sky-600">
                  <UserCircle2 className="w-8 h-8" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">{detail.name}</h1>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusMeta.className}`}>{statusMeta.label}</span>
              </div>
              <p className="text-sm text-slate-500">{detail.jobTitle || roleLabel || 'بدون مسمى وظيفي محدد'}</p>
              <div className="flex items-center gap-5 text-sm text-slate-500 flex-wrap">
                <span className="inline-flex items-center gap-2">
                  <Phone className="w-4 h-4 text-sky-500" />
                  {detail.mobile}
                </span>
                <span className="inline-flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-500" />
                  {detail.branch || '—'} / {detail.residence || '—'}
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-500" />
                  {detail.systemAccount ? detail.systemAccount.roleDisplayName || 'حساب مرتبط' : 'بدون حساب نظام'}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:w-[320px]">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 mb-1">حالة الوصول</div>
              <div className="text-sm font-bold text-slate-800">
                {detail.systemAccount ? (detail.systemAccount.isActive ? 'نشط' : 'موقوف') : 'غير مفعل'}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 mb-1">تاريخ الإنشاء</div>
              <div className="text-sm font-bold text-slate-800">
                {detail.createdAt ? new Date(detail.createdAt).toLocaleDateString('ar-IQ') : '—'}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="bg-white rounded-3xl border border-slate-200 shadow-sm">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">بيانات الموظف</h2>
                <p className="text-sm text-slate-500 mt-1">البيانات الأساسية المعروضة في سجل الموظفين.</p>
              </div>
              <Briefcase className="w-5 h-5 text-sky-500" />
            </div>
            <div className="p-6 space-y-5">
              {isLinkedToHiringApplication && (
                <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  الفرع ومكان الإقامة والمسمى الوظيفي لهذا الموظف مرتبطة بملف التوظيف، لذلك يتم عرضها من طلب التوظيف نفسه.
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">الاسم الكامل</span>
                  <input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((current) => ({ ...current, name: e.target.value }))}
                    disabled={!canEditEmployee}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">رقم الهاتف الأساسي</span>
                  <input
                    value={profileForm.mobile}
                    onChange={(e) => setProfileForm((current) => ({ ...current, mobile: e.target.value }))}
                    disabled={!canEditEmployee}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">الفرع</span>
                  <input
                    value={profileForm.branch}
                    onChange={(e) => setProfileForm((current) => ({ ...current, branch: e.target.value }))}
                    disabled={lockedFromHiringSource}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">مكان الإقامة</span>
                  <input
                    value={profileForm.residence}
                    onChange={(e) => setProfileForm((current) => ({ ...current, residence: e.target.value }))}
                    disabled={lockedFromHiringSource}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">المسمى الوظيفي</span>
                  <input
                    value={profileForm.jobTitle}
                    onChange={(e) => setProfileForm((current) => ({ ...current, jobTitle: e.target.value }))}
                    disabled={lockedFromHiringSource}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-2">الحالة</span>
                  <select
                    value={profileForm.status}
                    onChange={(e) => setProfileForm((current) => ({ ...current, status: e.target.value as EmployeeDetailType['status'] }))}
                    disabled={!canEditEmployee}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="active">نشط</option>
                    <option value="leave">إجازة</option>
                    <option value="inactive">غير فعال</option>
                  </select>
                </label>
              </div>

              {canEditEmployee ? (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm text-emerald-600 font-medium">{profileMessage}</span>
                  <button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    حفظ بيانات الموظف
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">عرض فقط. تحتاج إلى صلاحية تعديل الموظفين لحفظ أي تغييرات.</p>
              )}
            </div>
          </section>

          <section className="bg-white rounded-3xl border border-slate-200 shadow-sm">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">حساب النظام والدور</h2>
                <p className="text-sm text-slate-500 mt-1">إسناد الدور الإداري أصبح من ملف الموظف نفسه بدل جدول المستخدمين.</p>
              </div>
              <Lock className="w-5 h-5 text-sky-500" />
            </div>
            <div className="p-6 space-y-5">
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">
                      {detail.systemAccount ? 'الحساب مرتبط بهذا الموظف' : 'لا يوجد حساب نظام مرتبط بعد'}
                    </div>
                    <div className="text-sm text-slate-500 mt-1 leading-relaxed">
                      {detail.systemAccount
                        ? `اسم الدخول الحالي: ${detail.systemAccount.username}`
                        : 'يمكنك إنشاء حساب نظام لهذا الموظف وتحديد دوره مباشرة من هنا.'}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${detail.systemAccount?.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                    <BadgeCheck className="w-3.5 h-3.5" />
                    {detail.systemAccount?.isActive ? 'مفعل' : 'غير مفعل'}
                  </span>
                </div>
              </div>

              {canManageSystemAccess ? (
                <>
                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-500 mb-2">اسم الدخول</span>
                    <input
                      value={accountForm.username}
                      onChange={(e) => setAccountForm((current) => ({ ...current, username: e.target.value }))}
                      placeholder="مثال: employee_user"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-500 mb-2">
                      {detail.systemAccount ? 'كلمة مرور جديدة عند الحاجة' : 'كلمة المرور الأولية'}
                    </span>
                    <input
                      type="password"
                      value={accountForm.password}
                      onChange={(e) => setAccountForm((current) => ({ ...current, password: e.target.value }))}
                      placeholder={detail.systemAccount ? 'اتركها فارغة للإبقاء على الحالية' : 'كلمة مرور قوية'}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-500 mb-2">الدور الإداري</span>
                    <select
                      value={accountForm.roleId}
                      onChange={(e) => setAccountForm((current) => ({ ...current, roleId: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      <option value="">اختر دورًا</option>
                      {activeRoles.map((role) => (
                        <option key={role.id} value={role.id}>{role.displayName}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">تفعيل الحساب</div>
                      <div className="text-xs text-slate-500 mt-1">يمكنك إيقاف وصول الموظف للنظام دون حذف الربط.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={accountForm.isActive}
                      onChange={(e) => setAccountForm((current) => ({ ...current, isActive: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                  </label>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-emerald-600 font-medium">{accountMessage}</span>
                    <button
                      onClick={handleSaveSystemAccount}
                      disabled={savingAccount}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {detail.systemAccount ? 'حفظ الدور والحساب' : 'إنشاء حساب وربط الدور'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500 leading-relaxed">
                  عرض فقط. تحتاج إلى صلاحية إدارة الأدوار حتى تستطيع إسناد الدور الإداري أو تعديل حساب النظام.
                </p>
              )}
            </div>
          </section>
        </div>

        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm">
          <div className="px-6 py-5 border-b border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">ملف التوظيف</h2>
              <p className="text-sm text-slate-500 mt-1">جميع بيانات الطلب الذي نتج عنه إنشاء هذا الموظف، بما فيها الشاغر والمقابلات والتدريب.</p>
            </div>
            {detail.hiringApplication && (
              <button
                onClick={() => {
                  if (!detail.hiringApplication) return;
                  navigate(`/jobs/applications/${detail.hiringApplication.id}`);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                <FileText className="w-4 h-4" />
                فتح طلب التوظيف
              </button>
            )}
          </div>

          <div className="p-6">
            {!detail.hiringApplication ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
                <div className="text-sm font-semibold text-slate-800">لا توجد بيانات توظيف مرتبطة</div>
                <p className="text-sm text-slate-500 mt-2">هذا السجل لم يُنشأ من طلب توظيف مرتبط، أو لم يتم ربط الطلب به بعد.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs text-slate-400 mb-1">رقم الطلب</div>
                    <div className="text-sm font-bold text-slate-900">#{detail.hiringApplication.id}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs text-slate-400 mb-1">مصدر الطلب</div>
                    <div className="text-sm font-bold text-slate-900">{SOURCE_LABELS[detail.hiringApplication.applicationSource] || detail.hiringApplication.applicationSource}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs text-slate-400 mb-1">المرحلة الحالية</div>
                    <div className="text-sm font-bold text-slate-900">{STAGE_LABELS[detail.hiringApplication.currentStage] || detail.hiringApplication.currentStage}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs text-slate-400 mb-1">الحالة الموحدة</div>
                    <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getUnifiedApplicationStateClasses(hiringState?.tone || 'default')}`}>
                      {hiringState?.label || '—'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <GraduationCap className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-bold text-slate-900">بيانات المتقدم</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 text-sm">
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الاسم</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.firstName || '—'} {detail.hiringApplication.applicant?.lastName || ''}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الجوال</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.mobileNumber || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">المؤهل</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.academicQualification || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الاختصاص</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.specialization || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الخبرة</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.yearsOfExperience ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الموقع</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.applicant?.cityOrArea || detail.hiringApplication.applicant?.governorate || '—'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Briefcase className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-bold text-slate-900">بيانات الشاغر</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 text-sm">
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الشاغر</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.title || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الفرع</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.branch || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">نوع العمل</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.workType || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الموقع</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.cityOrArea || detail.hiringApplication.vacancy?.governorate || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">المؤهل المطلوب</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.requiredCertificate || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">الاختصاص المطلوب</div>
                        <div className="font-semibold text-slate-800">{detail.hiringApplication.vacancy?.requiredMajor || '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarDays className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-bold text-slate-900">سجل المقابلات</h3>
                    </div>
                    {detail.hiringApplication.interviews.length === 0 ? (
                      <p className="text-sm text-slate-500">لا توجد مقابلات مسجلة لهذا الطلب.</p>
                    ) : (
                      <div className="space-y-3">
                        {detail.hiringApplication.interviews.map((interview) => (
                          <div key={interview.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-slate-800">{interview.interviewerName}</div>
                              <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700">
                                {INTERVIEW_STATUS_LABELS[interview.interviewStatus] || interview.interviewStatus}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                              <span>{interview.interviewType}</span>
                              <span>{interview.interviewDate ? new Date(interview.interviewDate).toLocaleDateString('ar-IQ') : '—'}</span>
                              <span>{interview.interviewTime || '—'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin className="w-4 h-4 text-sky-500" />
                      <h3 className="text-sm font-bold text-slate-900">سجل التدريب</h3>
                    </div>
                    {detail.hiringApplication.trainings.length === 0 ? (
                      <p className="text-sm text-slate-500">لا توجد دورات أو نتائج تدريب مرتبطة بهذا الطلب.</p>
                    ) : (
                      <div className="space-y-3">
                        {detail.hiringApplication.trainings.map((training) => (
                          <div key={training.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-slate-800">{training.trainingName}</div>
                              <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700">
                                {training.result ? (TRAINING_RESULT_LABELS[training.result] || training.result) : 'بدون نتيجة'}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                              <span>{training.trainer}</span>
                              <span>{training.branch}</span>
                              <span>{training.startDate ? new Date(training.startDate).toLocaleDateString('ar-IQ') : '—'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <BadgeCheck className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-bold text-slate-900">قرارات وملاحظات التوظيف</h3>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-sm">
                    <div>
                      <div className="text-xs text-slate-400 mb-1">القرار</div>
                      <div className="font-semibold text-slate-800">{detail.hiringApplication.decision ? (DECISION_LABELS[detail.hiringApplication.decision] || detail.hiringApplication.decision) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">تاريخ الطلب</div>
                      <div className="font-semibold text-slate-800">{detail.hiringApplication.createdAt ? new Date(detail.hiringApplication.createdAt).toLocaleDateString('ar-IQ') : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">التصعيد</div>
                      <div className="font-semibold text-slate-800">{detail.hiringApplication.isEscalated ? 'مصعد للإدارة' : 'غير مصعد'}</div>
                    </div>
                  </div>
                  {detail.hiringApplication.internalNotes && (
                    <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-4">
                      <div className="text-xs text-slate-400 mb-2">الملاحظات الداخلية</div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{detail.hiringApplication.internalNotes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
