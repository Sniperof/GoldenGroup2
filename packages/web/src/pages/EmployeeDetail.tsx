import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  FileText,
  GraduationCap,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Phone,
  Save,
  ShieldCheck,
  UserCircle2,
  UserRound,
  UserRoundCog,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { EmployeeDetail as EmployeeDetailType } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';
import { useRoleStore } from '../hooks/useRoleStore';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import EmployeeFormModal, { type EmployeeFormInitialValues } from '../components/employees/EmployeeFormModal';
import { useSystemListsStore } from '../hooks/useSystemLists';
import { getUnifiedApplicationState, getUnifiedApplicationStateClasses } from '../lib/applicationState';

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<EmployeeDetailType['status'], { label: string; className: string }> = {
  active:     { label: 'نشط',           className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  vacation:   { label: 'إجازة',         className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  suspended:  { label: 'موقوف',         className: 'bg-orange-50 text-orange-700 border border-orange-200' },
  terminated: { label: 'منتهي الخدمة',  className: 'bg-slate-100 text-slate-600 border border-slate-200' },
};

const STAGE_LABELS: Record<string, string> = {
  Submitted:        'استلام الطلب',
  Shortlisted:      'القائمة القصيرة',
  Interview:        'المقابلة',
  Training:         'التدريب',
  'Final Decision': 'القرار النهائي',
};

const DECISION_LABELS: Record<string, string> = {
  Qualified:   'مؤهل',
  Approved:    'معتمد',
  Passed:      'اجتاز',
  Hired:       'تم التوظيف',
  Rejected:    'مرفوض',
  Failed:      'راسب',
  Retraining:  'إعادة تدريب',
  Retreated:   'منسحب',
};

const SOURCE_LABELS: Record<string, string> = {
  'Mobile App':          'تطبيق الجوال',
  Website:               'الموقع الإلكتروني',
  'External Platforms':  'منصات خارجية',
  Internal:              'داخلي',
};

const REFERRER_TYPE_LABELS: Record<string, string> = {
  Personal:  'شخصي',
  Employee:  'موظف',
  Client:    'زبون',
  Unknown:   'مجهول',
};

const SOURCE_CHANNEL_LABELS: Record<string, string> = {
  Acquaintance: 'معرفة شخصية',
  PhoneCall:    'مكالمة هاتفية',
  SocialMedia:  'سوشال ميديا',
  App:          'سوشال ميديا',
  Campaign:     'حملة إعلانية',
};

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  'Interview Scheduled': 'مجدولة',
  'Interview Completed': 'مكتملة',
  'Interview Failed':    'مرفوضة',
};

const TRAINING_RESULT_LABELS: Record<string, string> = {
  Passed:      'اجتاز',
  Retraining:  'إعادة تدريب',
  Rejected:    'مرفوض',
  Retreated:   'منسحب',
};

// ── Tab definition ────────────────────────────────────────────────────────────

type TabKey = 'profile' | 'qualifications' | 'employment' | 'jobTasks' | 'system' | 'hiring';

interface TabDef {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { key: 'profile',        label: 'الشخصية والتواصل', icon: UserRound     },
  { key: 'qualifications', label: 'المؤهلات',          icon: GraduationCap },
  { key: 'employment',     label: 'الوظيفة',            icon: Briefcase     },
  { key: 'jobTasks',       label: 'المهام الوظيفية',    icon: ListChecks    },
  { key: 'system',         label: 'حساب النظام',        icon: Lock          },
  { key: 'hiring',         label: 'ملف التوظيف',        icon: FileText      },
];

// ── Form types ────────────────────────────────────────────────────────────────

type AccountForm = {
  username: string;
  password: string;
  roleId: string;
  isActive: boolean;
};

// ── Utility formatters ────────────────────────────────────────────────────────

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('ar-IQ') : '—';
}
function formatGender(value?: string | null) {
  if (value === 'male') return 'ذكر';
  if (value === 'female') return 'أنثى';
  return value || '—';
}
function formatDrivingLicense(value?: boolean | null) {
  if (value === true) return 'نعم';
  if (value === false) return 'لا';
  return '—';
}
function formatContactType(value?: string | null) {
  if (value === 'mobile') return 'موبايل';
  if (value === 'landline') return 'هاتف ثابت';
  if (value === 'other') return 'آخر';
  return value || '—';
}
function formatContactStatus(value?: string | null) {
  if (value === 'active') return 'فعال';
  if (value === 'preferred') return 'مفضل';
  if (value === 'out-of-coverage') return 'خارج التغطية';
  if (value === 'unused') return 'غير مستخدم';
  return value || '—';
}

// ── Initial-values builder ────────────────────────────────────────────────────

function buildEmployeeInitialValues(detail: EmployeeDetailType): EmployeeFormInitialValues {
  return {
    employeeNumber:    detail.employeeNumber ?? null,
    firstName:         detail.firstName ?? '',
    fatherName:        detail.fatherName ?? '',
    lastName:          detail.lastName ?? '',
    birthDate:         detail.birthDate ?? '',
    gender:            detail.gender ?? '',
    maritalStatus:     detail.maritalStatus ?? '',
    militaryService:   detail.militaryService ?? '',
    residenceGovernorateId:  detail.residenceGovernorateId ?? null,
    residenceRegionId:       detail.residenceRegionId ?? null,
    residenceSubAreaId:      detail.residenceSubAreaId ?? null,
    residenceNeighborhoodId: detail.residenceNeighborhoodId ?? null,
    detailedAddress:   detail.detailedAddress ?? '',
    contacts:          detail.contacts ?? [],
    academicQualification: detail.academicQualification ?? '',
    specialization:    detail.specialization ?? '',
    yearsOfExperience: detail.yearsOfExperience != null ? String(detail.yearsOfExperience) : '',
    drivingLicense:    detail.drivingLicense === true ? 'yes' : detail.drivingLicense === false ? 'no' : '',
    hasCar:            detail.hasCar === true ? 'yes' : detail.hasCar === false ? 'no' : '',
    jobSkills:         detail.jobSkills ?? '',
    foreignLanguages:  detail.foreignLanguages ?? [],
    status:            detail.status,
    hireDate:          detail.hireDate ?? '',
    startWorkDate:     detail.startWorkDate ?? '',
    branchId:          detail.branchId ?? null,
    departmentId:      detail.departmentId ?? null,
    contractType:      detail.contractType ?? '',
    workType:          detail.workType ?? '',
    previousEmployment: detail.previousEmployment ?? '',
    directManagerId:   detail.directManagerId ?? null,
    jobTitle:          detail.jobTitle ?? '',
    referrerType:      detail.referrerType ? String(detail.referrerType) : '',
    sourceChannel:     detail.sourceChannel ? String(detail.sourceChannel) : '',
    referrerName:      detail.referrerName ?? '',
    referralNotes:     detail.referralNotes ?? '',
  };
}

// ── Shared UI components ──────────────────────────────────────────────────────

/** A horizontal label → value row. Renders nothing when value is empty. */
function InfoRow({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0 ${span ? 'col-span-2' : ''}`}>
      <span className="w-36 shrink-0 text-xs font-medium text-slate-400 pt-0.5 leading-5">{label}</span>
      <span className="flex-1 text-sm font-semibold text-slate-800 leading-5 min-w-0">{children || '—'}</span>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  accent = 'sky',
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent?: 'sky' | 'violet' | 'emerald' | 'amber' | 'rose';
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    sky:     'bg-sky-50 text-sky-600 border-sky-100',
    violet:  'bg-violet-50 text-violet-600 border-violet-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber:   'bg-amber-50 text-amber-600 border-amber-100',
    rose:    'bg-rose-50 text-rose-600 border-rose-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
        <div className={`flex h-7 w-7 items-center justify-center rounded-xl border ${colors[accent]}`}>
          {icon}
        </div>
        <h4 className="text-sm font-bold text-slate-800">{title}</h4>
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EmployeeDetail() {
  const navigate = useNavigate();
  const { id }   = useParams();
  const employeeId = Number(id);

  const { roles, fetchRoles }   = useRoleStore();
  const { lists, fetchLists }   = useSystemListsStore();
  const { user }                = useAuthStore();
  const { branchId: contextBranchId } = useBranchContextStore();
  const { hasPermission }       = usePermissions();

  const canEditEmployee     = hasPermission('employees.edit');
  const canManageSystemAccess = hasPermission('admin.roles.manage');
  const isSuperAdmin        = user?.isSuperAdmin === true;

  const [detail, setDetail]       = useState<EmployeeDetailType | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [showEditModal, setShowEditModal]   = useState(false);
  const [savingProfile, setSavingProfile]   = useState(false);
  const [savingAccount, setSavingAccount]   = useState(false);
  const [activeTab, setActiveTab]           = useState<TabKey>('profile');

  const [profileForm, setProfileForm] = useState({
    name: '', mobile: '', branch: '', residence: '', jobTitle: '',
    status: 'active' as EmployeeDetailType['status'],
  });
  const [accountForm, setAccountForm] = useState<AccountForm>({
    username: '', password: '', roleId: '', isActive: true,
  });

  // ── Load employee ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadEmployee() {
      if (!employeeId) { setError('تعذر تحديد الموظف المطلوب'); setLoading(false); return; }
      setLoading(true);
      setError('');
      try {
        const data = await api.employees.get(employeeId) as EmployeeDetailType;
        if (cancelled) return;
        setDetail(data);
        setProfileForm({
          name: data.name, mobile: data.mobile,
          branch: data.branch ?? '', residence: data.residence ?? '',
          jobTitle: data.jobTitle ?? '', status: data.status,
        });
        setAccountForm({
          username: data.systemAccount?.username ?? '',
          password: '',
          roleId: data.systemAccount?.roleId ? String(data.systemAccount.roleId) : '',
          isActive: data.systemAccount?.isActive ?? true,
        });
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'تعذر تحميل بيانات الموظف');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEmployee();
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => { if (canManageSystemAccess) fetchRoles(); }, [canManageSystemAccess, fetchRoles]);
  useEffect(() => { fetchLists({ category: 'job_title', activeOnly: true }); }, [fetchLists]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const jobTitleOptions = lists
    .filter((item) => item.category === 'job_title' && item.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((item) => ({ value: item.value, label: item.value, linkedRoleName: item.linkedRoleName }));

  const employeeInitialValues = useMemo(
    () => (detail ? buildEmployeeInitialValues(detail) : undefined),
    [detail],
  );

  const fixedBranchId   = !isSuperAdmin ? (user?.branchId ?? detail?.branchId ?? null) : (contextBranchId ?? null);
  const fixedBranchName = detail?.branch ?? (fixedBranchId != null ? `#${fixedBranchId}` : null);

  const activeRoles = roles.filter(
    (role) => role.isTemplate && role.templateId == null && (role.isActive || role.id === detail?.systemAccount?.roleId),
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleSaveProfile(payload?: Record<string, unknown>) {
    if (!detail) return;
    setSavingProfile(true);
    setProfileMessage('');
    setError('');
    try {
      await api.employees.update(detail.id, payload ?? profileForm);
      const refreshed = await api.employees.get(detail.id) as EmployeeDetailType;
      setDetail(refreshed);
      setProfileForm({ name: refreshed.name, mobile: refreshed.mobile, branch: refreshed.branch ?? '',
        residence: refreshed.residence ?? '', jobTitle: refreshed.jobTitle ?? '', status: refreshed.status });
      setShowEditModal(false);
      setProfileMessage('تم حفظ بيانات الموظف بنجاح');
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
      await api.employees.upsertSystemAccount(detail.id, {
        username:  accountForm.username,
        password:  accountForm.password,
        roleId:    Number(accountForm.roleId),
        isActive:  accountForm.isActive,
      });
      const refreshed = await api.employees.get(detail.id) as EmployeeDetailType;
      setDetail(refreshed);
      setAccountForm((cur) => ({ ...cur, password: '' }));
      setAccountMessage(detail.systemAccount ? 'تم تحديث حساب النظام والدور' : 'تم إنشاء حساب النظام وربطه بالموظف');
    } catch (err: any) {
      setError(err.message ?? 'تعذر حفظ حساب النظام');
    } finally {
      setSavingAccount(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

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

  const statusMeta = STATUS_META[detail.status];
  const hiringState = detail.hiringApplication
    ? getUnifiedApplicationState({
        currentStage:         detail.hiringApplication.currentStage,
        applicationStatus:    detail.hiringApplication.applicationStatus,
        stageStatus:          detail.hiringApplication.stageStatus,
        decision:             detail.hiringApplication.decision,
        hasScheduledInterview: detail.hiringApplication.interviews.some(
          (i) => i.interviewStatus === 'Interview Scheduled',
        ),
      })
    : null;

  // ── Tab content renderers ──────────────────────────────────────────────────

  function renderProfile() {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Identity */}
        <SectionCard title="البيانات الشخصية" icon={<UserRound className="h-3.5 w-3.5" />} accent="sky">
          <InfoRow label="رقم الموظف">{detail!.employeeNumber ? `#${detail!.employeeNumber}` : '—'}</InfoRow>
          <InfoRow label="الاسم الكامل">{detail!.name}</InfoRow>
          <InfoRow label="الاسم الأول">{detail!.firstName}</InfoRow>
          <InfoRow label="اسم الأب">{detail!.fatherName}</InfoRow>
          <InfoRow label="الكنية">{detail!.lastName}</InfoRow>
          <InfoRow label="تاريخ الميلاد">{formatDate(detail!.birthDate)}</InfoRow>
          <InfoRow label="الجنس">{formatGender(detail!.gender)}</InfoRow>
          <InfoRow label="الحالة الاجتماعية">{detail!.maritalStatus}</InfoRow>
          <InfoRow label="الخدمة العسكرية">{detail!.militaryService}</InfoRow>
        </SectionCard>

        {/* Address */}
        <SectionCard title="عنوان الإقامة" icon={<MapPin className="h-3.5 w-3.5" />} accent="violet">
          <InfoRow label="المحافظة">{detail!.residenceGovernorate}</InfoRow>
          <InfoRow label="المنطقة">{detail!.residenceRegion}</InfoRow>
          <InfoRow label="الناحية">{detail!.residenceSubArea}</InfoRow>
          <InfoRow label="الحي">{detail!.residenceNeighborhood}</InfoRow>
          <InfoRow label="العنوان المختصر">{detail!.residenceShort || detail!.residence}</InfoRow>
          <InfoRow label="تفاصيل العنوان">{detail!.detailedAddress}</InfoRow>
        </SectionCard>

        {/* Contacts */}
        <div className="lg:col-span-2">
          <SectionCard title="وسائل التواصل" icon={<Phone className="h-3.5 w-3.5" />} accent="emerald">
            {(!detail!.contacts || detail!.contacts.length === 0) ? (
              <p className="py-4 text-sm text-slate-400">لا توجد وسائل تواصل مسجلة.</p>
            ) : (
              <div className="grid gap-3 py-3 md:grid-cols-2 xl:grid-cols-3">
                {detail!.contacts.map((contact, idx) => {
                  const statusColors: Record<string, string> = {
                    active:           'bg-emerald-50 text-emerald-700 border-emerald-200',
                    preferred:        'bg-sky-50 text-sky-700 border-sky-200',
                    'out-of-coverage': 'bg-amber-50 text-amber-700 border-amber-200',
                    unused:           'bg-slate-100 text-slate-500 border-slate-200',
                  };
                  const statusCls = statusColors[contact.status ?? 'active'] ?? statusColors.active;
                  return (
                    <div key={contact.id || idx} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-500">{formatContactType(contact.type)} #{idx + 1}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusCls}`}>
                          {formatContactStatus(contact.status)}
                        </span>
                      </div>
                      <div className="text-base font-bold text-slate-900 tracking-wide">
                        {contact.type === 'mobile' ? '+963 ' : (contact.areaCode ? `${contact.areaCode} ` : '')}
                        {contact.number || '—'}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {contact.label && <span className="rounded bg-white border border-slate-200 px-2 py-0.5">{contact.label}</span>}
                        {contact.hasWhatsApp && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-700 font-medium">
                            <MessageSquare className="h-3 w-3" /> واتساب
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Referral */}
        <div className="lg:col-span-2">
          <SectionCard title="الوسيط ومصدر التوظيف" icon={<Users className="h-3.5 w-3.5" />} accent="amber">
            <div className="grid md:grid-cols-2">
              <InfoRow label="نوع الوسيط">{detail!.referrerType ? (REFERRER_TYPE_LABELS[detail!.referrerType] ?? detail!.referrerType) : undefined}</InfoRow>
              <InfoRow label="نوع التواصل">{detail!.sourceChannel ? (SOURCE_CHANNEL_LABELS[detail!.sourceChannel] ?? detail!.sourceChannel) : undefined}</InfoRow>
              <InfoRow label="اسم الوسيط">{detail!.referrerName}</InfoRow>
              <InfoRow label="ملاحظات" span>{detail!.referralNotes}</InfoRow>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  function renderQualifications() {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="التعليم والخبرة" icon={<GraduationCap className="h-3.5 w-3.5" />} accent="violet">
          <InfoRow label="الشهادة العلمية">{detail!.academicQualification}</InfoRow>
          <InfoRow label="الاختصاص">{detail!.specialization}</InfoRow>
          <InfoRow label="سنوات الخبرة">
            {detail!.yearsOfExperience != null ? `${detail!.yearsOfExperience} سنة` : undefined}
          </InfoRow>
          <InfoRow label="رخصة القيادة">{formatDrivingLicense(detail!.drivingLicense)}</InfoRow>
          <InfoRow label="امتلاك سيارة">{formatDrivingLicense(detail!.hasCar)}</InfoRow>
          <InfoRow label="العمل السابق">{detail!.previousEmployment}</InfoRow>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="اللغات الأجنبية" icon={<BadgeCheck className="h-3.5 w-3.5" />} accent="sky">
            {!detail!.foreignLanguages || detail!.foreignLanguages.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">لم تُحدَّد لغات أجنبية.</p>
            ) : (
              <div className="flex flex-wrap gap-2 py-3">
                {detail!.foreignLanguages.map((lang) => (
                  <span key={lang} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700">
                    {lang}
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="المهارات الوظيفية" icon={<ShieldCheck className="h-3.5 w-3.5" />} accent="emerald">
            {detail!.jobSkills ? (
              <p className="py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{detail!.jobSkills}</p>
            ) : (
              <p className="py-3 text-sm text-slate-400">لم تُسجَّل مهارات.</p>
            )}
          </SectionCard>
        </div>
      </div>
    );
  }

  function renderEmployment() {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="بيانات التعيين" icon={<Briefcase className="h-3.5 w-3.5" />} accent="sky">
          <InfoRow label="الفرع">{detail!.branch}</InfoRow>
          <InfoRow label="القسم">{detail!.departmentName}</InfoRow>
          <InfoRow label="المسمى الوظيفي">{detail!.jobTitle}</InfoRow>
          <InfoRow label="المدير المباشر">{detail!.directManagerName}</InfoRow>
          <InfoRow label="نوع العقد">{detail!.contractType}</InfoRow>
          <InfoRow label="نوع العمل">{detail!.workType}</InfoRow>
        </SectionCard>

        <SectionCard title="التواريخ" icon={<CalendarDays className="h-3.5 w-3.5" />} accent="emerald">
          <InfoRow label="تاريخ التوظيف">{formatDate(detail!.hireDate)}</InfoRow>
          <InfoRow label="تاريخ بدء العمل">{formatDate(detail!.startWorkDate)}</InfoRow>
          <InfoRow label="تاريخ إنشاء السجل">{formatDate(detail!.createdAt)}</InfoRow>
        </SectionCard>
      </div>
    );
  }

  function renderJobTasks() {
    const roleName = detail!.systemAccount?.roleDisplayName;
    const tasks = detail!.jobTasks ?? [];

    if (!detail!.systemAccount) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
          <ListChecks className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-600">لا يوجد دور مسند لهذا الموظف بعد</div>
          <p className="text-xs text-slate-400 mt-1">تظهر المهام الوظيفية هنا بعد إنشاء حساب نظام وإسناد دور للموظف.</p>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-emerald-600 mb-1">الدور المسند</div>
            <div className="text-sm font-bold text-emerald-900">{roleName || '—'}</div>
          </div>
          <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-bold text-emerald-700">
            {tasks.length} مهمة
          </span>
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
            <ListChecks className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <div className="text-sm font-semibold text-slate-600">لا توجد مهام معرفة لهذا الدور</div>
            <p className="text-xs text-slate-400 mt-1">يمكن إضافتها من إدارة الأدوار ثم زر المهام الخاص بالدور.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map((task, index) => (
              <div key={task.id} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 flex gap-4">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-black shrink-0">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">{task.title}</div>
                  {task.description && (
                    <p className="mt-1 text-sm text-slate-500 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderSystemAccount() {
    return (
      <div className="max-w-xl space-y-5">
        {/* Current account status */}
        <div className={`rounded-2xl border p-5 flex items-start gap-4 ${detail!.systemAccount ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-slate-200 bg-slate-50'}`}>
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${detail!.systemAccount ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
            <Lock className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-900">
              {detail!.systemAccount ? 'الحساب مرتبط بهذا الموظف' : 'لا يوجد حساب نظام مرتبط بعد'}
            </div>
            <div className="mt-1 text-xs text-slate-500 leading-relaxed">
              {detail!.systemAccount
                ? `اسم الدخول: ${detail!.systemAccount.username} · الدور: ${detail!.systemAccount.roleDisplayName || '—'}`
                : 'يمكنك إنشاء حساب نظام لهذا الموظف وتحديد دوره مباشرة من هنا.'}
            </div>
          </div>
          {detail!.systemAccount && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold shrink-0 ${detail!.systemAccount.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {detail!.systemAccount.isActive ? 'مفعّل' : 'موقوف'}
            </span>
          )}
        </div>

        {canManageSystemAccess ? (
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            <div className="px-5 py-4 bg-slate-50/60">
              <h4 className="text-sm font-bold text-slate-800">إعدادات الحساب</h4>
            </div>
            <div className="p-5 space-y-4">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-500 mb-2">اسم الدخول</span>
                <input
                  value={accountForm.username}
                  onChange={(e) => setAccountForm((c) => ({ ...c, username: e.target.value }))}
                  placeholder="مثال: ahmed.ali"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </label>

              <label className="block">
                <span className="block text-xs font-semibold text-slate-500 mb-2">
                  {detail!.systemAccount ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور الأولية'}
                </span>
                <input
                  type="password"
                  value={accountForm.password}
                  onChange={(e) => setAccountForm((c) => ({ ...c, password: e.target.value }))}
                  placeholder={detail!.systemAccount ? '••••••••' : 'كلمة مرور قوية'}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </label>

              <label className="block">
                <span className="block text-xs font-semibold text-slate-500 mb-2">الدور الإداري</span>
                <select
                  value={accountForm.roleId}
                  onChange={(e) => setAccountForm((c) => ({ ...c, roleId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  <option value="">اختر دورًا</option>
                  {activeRoles.map((role) => (
                    <option key={role.id} value={role.id}>{role.displayName}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
                <div>
                  <div className="text-sm font-semibold text-slate-800">تفعيل الحساب</div>
                  <div className="text-xs text-slate-500 mt-0.5">إيقاف الوصول بدون حذف الربط</div>
                </div>
                <input
                  type="checkbox"
                  checked={accountForm.isActive}
                  onChange={(e) => setAccountForm((c) => ({ ...c, isActive: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
              </label>
            </div>

            <div className="flex items-center justify-between px-5 py-4 bg-slate-50/60">
              {accountMessage ? (
                <span className="text-sm text-emerald-600 font-medium">{accountMessage}</span>
              ) : <span />}
              <button
                onClick={handleSaveSystemAccount}
                disabled={savingAccount}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
              >
                {savingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {detail!.systemAccount ? 'حفظ الدور والحساب' : 'إنشاء حساب وربط الدور'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 leading-relaxed">
            عرض فقط — تحتاج إلى صلاحية إدارة الأدوار لتعديل حساب النظام.
          </div>
        )}
      </div>
    );
  }

  function renderHiring() {
    const app = detail!.hiringApplication;
    if (!app) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
          <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-600">لا توجد بيانات توظيف مرتبطة</div>
          <p className="text-xs text-slate-400 mt-1">هذا السجل لم يُنشأ من طلب توظيف، أو لم يتم ربط الطلب به بعد.</p>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {/* Summary chips */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'رقم الطلب', value: `#${app.id}` },
            { label: 'المصدر', value: SOURCE_LABELS[app.applicationSource] || app.applicationSource },
            { label: 'المرحلة', value: STAGE_LABELS[app.currentStage] || app.currentStage },
            { label: 'الحالة', value: (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${getUnifiedApplicationStateClasses(hiringState?.tone || 'default')}`}>
                {hiringState?.label || '—'}
              </span>
            ) },
          ].map((chip) => (
            <div key={chip.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs text-slate-400 mb-1">{chip.label}</div>
              <div className="text-sm font-bold text-slate-900">{chip.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Applicant */}
          <SectionCard title="بيانات المتقدم" icon={<UserRound className="h-3.5 w-3.5" />} accent="sky">
            <InfoRow label="الاسم">
              {[app.applicant?.firstName, app.applicant?.lastName].filter(Boolean).join(' ')}
            </InfoRow>
            <InfoRow label="الجوال">{app.applicant?.mobileNumber}</InfoRow>
            <InfoRow label="المؤهل">{app.applicant?.academicQualification}</InfoRow>
            <InfoRow label="الاختصاص">{app.applicant?.specialization}</InfoRow>
            <InfoRow label="سنوات الخبرة">
              {app.applicant?.yearsOfExperience != null ? `${app.applicant.yearsOfExperience} سنة` : undefined}
            </InfoRow>
            <InfoRow label="الموقع">{app.applicant?.cityOrArea || app.applicant?.governorate}</InfoRow>
          </SectionCard>

          {/* Vacancy */}
          <SectionCard title="بيانات الشاغر" icon={<Briefcase className="h-3.5 w-3.5" />} accent="violet">
            <InfoRow label="الشاغر">{app.vacancy?.title}</InfoRow>
            <InfoRow label="الفرع">{app.vacancy?.branch}</InfoRow>
            <InfoRow label="نوع العمل">{app.vacancy?.workType}</InfoRow>
            <InfoRow label="الموقع">{app.vacancy?.cityOrArea || app.vacancy?.governorate}</InfoRow>
            <InfoRow label="المؤهل المطلوب">{app.vacancy?.requiredCertificate}</InfoRow>
            <InfoRow label="الاختصاص المطلوب">{app.vacancy?.requiredMajor}</InfoRow>
          </SectionCard>

          {/* Interviews */}
          <SectionCard title="سجل المقابلات" icon={<CalendarDays className="h-3.5 w-3.5" />} accent="emerald">
            {app.interviews.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">لا توجد مقابلات مسجلة.</p>
            ) : (
              <div className="space-y-2 py-2">
                {app.interviews.map((interview) => (
                  <div key={interview.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">{interview.interviewerName}</span>
                      <span className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                        {INTERVIEW_STATUS_LABELS[interview.interviewStatus] || interview.interviewStatus}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span>{interview.interviewType}</span>
                      <span>{formatDate(interview.interviewDate)}</span>
                      {interview.interviewTime && <span>{interview.interviewTime}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Training */}
          <SectionCard title="سجل التدريب" icon={<GraduationCap className="h-3.5 w-3.5" />} accent="amber">
            {app.trainings.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">لا توجد دورات تدريب مرتبطة.</p>
            ) : (
              <div className="space-y-2 py-2">
                {app.trainings.map((training) => (
                  <div key={training.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">{training.trainingName}</span>
                      <span className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                        {training.result ? (TRAINING_RESULT_LABELS[training.result] || training.result) : 'بدون نتيجة'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      {training.trainer && <span>{training.trainer}</span>}
                      {training.branch && <span>{training.branch}</span>}
                      <span>{formatDate(training.startDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Decision notes */}
        <SectionCard title="قرارات وملاحظات التوظيف" icon={<BadgeCheck className="h-3.5 w-3.5" />} accent="rose">
          <div className="grid md:grid-cols-3">
            <InfoRow label="القرار">{app.decision ? (DECISION_LABELS[app.decision] || app.decision) : undefined}</InfoRow>
            <InfoRow label="تاريخ الطلب">{formatDate(app.createdAt)}</InfoRow>
            <InfoRow label="التصعيد">{app.isEscalated ? 'مصعد للإدارة' : 'غير مصعد'}</InfoRow>
          </div>
          {app.internalNotes && (
            <div className="mt-1 mb-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <div className="text-xs text-slate-400 mb-1.5">الملاحظات الداخلية</div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{app.internalNotes}</p>
            </div>
          )}
        </SectionCard>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto bg-slate-50" dir="rtl">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* ── Hero card ───────────────────────────────────────────────────── */}
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Decorative top bar */}
          <div className="h-2 bg-gradient-to-l from-sky-400 via-sky-500 to-indigo-500" />

          <div className="px-6 py-5">
            <div className="flex flex-col gap-5 md:flex-row md:items-start">
              {/* Back + avatar */}
              <div className="flex items-start gap-4">
                <button
                  onClick={() => navigate('/employees')}
                  className="mt-1 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-200 transition-colors shrink-0"
                  title="العودة إلى الموظفين"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="relative shrink-0">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-slate-200 bg-white shadow-sm">
                    {detail.avatar ? (
                      <img src={detail.avatar} alt={detail.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-sky-50 text-sky-500">
                        <UserCircle2 className="w-8 h-8" />
                      </div>
                    )}
                  </div>
                  {/* Online-ish status dot */}
                  <span className={`absolute -bottom-1 -left-1 w-4 h-4 rounded-full border-2 border-white ${detail.status === 'active' ? 'bg-emerald-400' : detail.status === 'vacation' ? 'bg-amber-400' : detail.status === 'suspended' ? 'bg-orange-400' : 'bg-slate-300'}`} />
                </div>
              </div>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-bold text-slate-900 leading-tight">{detail.name}</h1>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusMeta.className}`}>
                    {statusMeta.label}
                  </span>
                  {detail.systemAccount && (
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${detail.systemAccount.isActive ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {detail.systemAccount.isActive ? '● متصل بالنظام' : '○ موقوف'}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm font-medium text-sky-600">{detail.jobTitle || '—'}</p>

                {/* Quick info pills */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.branch && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" /> {detail.branch}
                    </span>
                  )}
                  {detail.departmentName && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <Briefcase className="h-3.5 w-3.5 text-slate-400" /> {detail.departmentName}
                    </span>
                  )}
                  {detail.mobile && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <Phone className="h-3.5 w-3.5 text-slate-400" /> {detail.mobile}
                    </span>
                  )}
                  {detail.directManagerName && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <UserRoundCog className="h-3.5 w-3.5 text-slate-400" /> {detail.directManagerName}
                    </span>
                  )}
                  {detail.residenceShort && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" /> {detail.residenceShort}
                    </span>
                  )}
                </div>
              </div>

              {/* Action + linked hiring badge */}
              <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-2">
                {canEditEmployee && (
                  <button
                    onClick={() => { setProfileMessage(''); setError(''); setShowEditModal(true); }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 hover:bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-sm"
                  >
                    <Save className="w-4 h-4" />
                    تعديل البيانات
                  </button>
                )}
                {detail.hiringApplication && (
                  <button
                    onClick={() => navigate(`/jobs/applications/${detail.hiringApplication!.id}`)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-slate-500" />
                    طلب التوظيف
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Hiring application linked notice */}
          {detail.hiringApplication && (
            <div className="mx-6 mb-4 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-2.5 text-xs text-sky-700 font-medium">
              هذا السجل مرتبط بطلب توظيف — يمكنك مراجعة المقابلات والتدريب في تبويب "ملف التوظيف".
            </div>
          )}
        </div>

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {profileMessage && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
            {profileMessage}
          </div>
        )}

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <div className="flex border-b border-slate-200 min-w-max">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                // Show a dot on the hiring tab when there's linked application
                const hasDot = tab.key === 'hiring' && Boolean(detail.hiringApplication);
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex items-center gap-2 px-5 py-3.5 text-sm font-semibold transition-colors whitespace-nowrap border-b-2 ${
                      isActive
                        ? 'border-sky-500 text-sky-600 bg-sky-50/50'
                        : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-sky-500' : 'text-slate-400'}`} />
                    {tab.label}
                    {hasDot && (
                      <span className="ml-0.5 h-2 w-2 rounded-full bg-sky-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab body */}
          <div className="p-5">
            {activeTab === 'profile'        && renderProfile()}
            {activeTab === 'qualifications' && renderQualifications()}
            {activeTab === 'employment'     && renderEmployment()}
            {activeTab === 'jobTasks'       && renderJobTasks()}
            {activeTab === 'system'         && renderSystemAccount()}
            {activeTab === 'hiring'         && renderHiring()}
          </div>
        </div>
      </div>

      {/* ── Edit modal ─────────────────────────────────────────────────────── */}
      <EmployeeFormModal
        isOpen={showEditModal}
        title="تعديل بيانات الموظف"
        description="يمكنك استكمال أو تعديل جميع بيانات الموظف من نفس النموذج الموحد."
        submitLabel="حفظ بيانات الموظف"
        submitting={savingProfile}
        error={error}
        initialValues={employeeInitialValues}
        fixedBranchId={fixedBranchId}
        fixedBranchName={fixedBranchName}
        branchLocked={!isSuperAdmin || contextBranchId != null}
        onClose={() => { if (savingProfile) return; setShowEditModal(false); }}
        onSubmit={handleSaveProfile}
      />
    </div>
  );
}
