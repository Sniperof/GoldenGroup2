import { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { trpc } from '../../lib/trpc';
import { authFetch } from '../../lib/authFetch';
import { useAuthStore } from '../../hooks/useAuthStore';
import type { Permission } from '../../hooks/useRoleStore';
import {
  Shield, Save, Loader2, AlertTriangle, ShieldCheck,
  Key, Briefcase, Users, UserCheck, FileText, BarChart2,
  ClipboardList, Calendar, AlertCircle, BookOpen, Settings, ListChecks
} from 'lucide-react';

type ScopeKey = 'GLOBAL' | 'BRANCH' | 'ASSIGNED';

const SCOPE_LABELS: Record<ScopeKey, string> = {
  GLOBAL: 'كل الفروع',
  BRANCH: 'فرع المستخدم',
  ASSIGNED: 'السجلات المسندة',
};

const SCOPE_DESCRIPTIONS: Record<ScopeKey, string> = {
  GLOBAL: 'كل الفروع',
  BRANCH: 'فرع المستخدم',
  ASSIGNED: 'السجلات المسندة للمستخدم',
};

const ACTION_LABELS: Record<string, string> = {
  view_list: 'عرض القائمة',
  view_detail: 'عرض التفاصيل',
  view_eligible: 'عرض المؤهلين',
  view_audit_logs: 'عرض سجل التغييرات',
  view_history: 'عرض السجل',
  lookup: 'عرض القوائم المرجعية',
  create: 'إنشاء',
  add_trainees: 'إضافة متدربين',
  edit: 'تعديل',
  delete: 'حذف',
  edit_notes: 'تعديل الملاحظات',
  change_status: 'تغيير الحالة',
  change_stage: 'تغيير المرحلة',
  record_decision: 'تسجيل قرار',
  record_result: 'تسجيل نتيجة',
  record_attendance: 'تسجيل حضور',
  hire: 'تعيين',
  schedule: 'جدولة',
  appear: 'الظهور',
  escalate: 'تصعيد',
  archive: 'أرشفة',
  start: 'بدء',
  complete: 'إتمام',
  view: 'عرض',
  manage: 'إدارة',
  generate: 'توليد',
  book: 'حجز',
  update_result: 'تسجيل نتيجة',
  can_be_assigned: 'قابل للإسناد',
  conduct: 'إجراء',
  be_trainer: 'التدريب كمدرب',
  review: 'مراجعة',
  reject: 'رفض',
  promote: 'ترحيل',
  reopen_closed: 'إعادة فتح',
};

function isLegacyPermission(perm: Permission): boolean {
  return perm.key.startsWith('referral_sheets.') || perm.module === 'referral_sheets';
}

const MODULE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  jobs:         { label: 'إدارة التوظيف',              icon: <Briefcase className="w-4 h-4" />,    color: 'text-sky-600 bg-sky-50' },
  clients:      { label: 'سجلات الزبائن',              icon: <Users className="w-4 h-4" />,        color: 'text-violet-600 bg-violet-50' },
  candidates:   { label: 'الأسماء المقترحة',            icon: <UserCheck className="w-4 h-4" />,    color: 'text-indigo-600 bg-indigo-50' },
  employees:    { label: 'سجلات الموظفين',              icon: <Users className="w-4 h-4" />,        color: 'text-emerald-600 bg-emerald-50' },
  contracts:    { label: 'العقود',                      icon: <FileText className="w-4 h-4" />,     color: 'text-amber-600 bg-amber-50' },
  devices:      { label: 'الأجهزة وقطع الغيار',         icon: <BarChart2 className="w-4 h-4" />,    color: 'text-cyan-600 bg-cyan-50' },
  tasks:        { label: 'المهام والعمليات',             icon: <ClipboardList className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
  planning:     { label: 'إدارة عمل الفرع',             icon: <Calendar className="w-4 h-4" />,     color: 'text-teal-600 bg-teal-50' },
  telemarketer: { label: 'إدارة المواعيد',              icon: <AlertCircle className="w-4 h-4" />,  color: 'text-pink-600 bg-pink-50' },
  geo:          { label: 'المناطق الجغرافية',           icon: <BookOpen className="w-4 h-4" />,     color: 'text-lime-600 bg-lime-50' },
  branches:     { label: 'الفروع',                      icon: <Users className="w-4 h-4" />,        color: 'text-fuchsia-600 bg-fuchsia-50' },
  settings:     { label: 'إعدادات النظام',              icon: <Settings className="w-4 h-4" />,     color: 'text-slate-600 bg-slate-100' },
  admin:        { label: 'إدارة النظام والصلاحيات',     icon: <Settings className="w-4 h-4" />,     color: 'text-rose-600 bg-rose-50' },
  users:        { label: 'المستخدمون',                   icon: <Users className="w-4 h-4" />,        color: 'text-indigo-600 bg-indigo-50' },
  departments:  { label: 'الأقسام',                      icon: <ListChecks className="w-4 h-4" />,   color: 'text-slate-600 bg-slate-100' },
  marketing_visits: { label: 'الزيارات التسويقية',       icon: <Calendar className="w-4 h-4" />,     color: 'text-emerald-600 bg-emerald-50' },
  telemarketing: { label: 'التيلماركتنغ',                icon: <AlertCircle className="w-4 h-4" />,  color: 'text-pink-600 bg-pink-50' },
  field_visits: { label: 'الزيارات الميدانية',           icon: <Calendar className="w-4 h-4" />,     color: 'text-teal-600 bg-teal-50' },
  open_tasks:   { label: 'المهام المفتوحة',              icon: <ClipboardList className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
  service_requests: { label: 'طلبات الخدمة والصيانة',    icon: <FileText className="w-4 h-4" />,     color: 'text-cyan-600 bg-cyan-50' },
  reference_data: { label: 'القوائم المرجعية', icon: <ListChecks className="w-4 h-4" />, color: 'text-slate-600 bg-slate-100' },
};

const SUB_MODULE_LABELS: Record<string, string> = {
  vacancies: 'الشواغر الوظيفية',
  applications: 'طلبات التوظيف',
  interviews: 'المقابلات',
  training: 'الدورات التدريبية',
  candidates: 'الأسماء المقترحة',
  name_lists: 'لوائح الأسماء',
  roles: 'الأدوار والصلاحيات',
  roles_users: 'إسناد الأدوار للمستخدمين',
  system_lists: 'القوائم النظامية',
  branch_assignments: 'فروع المستخدمين المسموحة',
  management: 'الإدارة',
  system: 'النظام',
  geography: 'المناطق الجغرافية',
  visits: 'الزيارات',
  tasks: 'المهام',
  targets: 'الأهداف',
  lists: 'قوائم الاتصال',
  calls: 'المكالمات',
  appointments: 'المواعيد',
  schedule: 'جدولة الفرق',
  service_requests: 'طلبات الخدمة والصيانة',
  lookups: 'الاستخدام داخل العمليات',
  navigation: 'ظهور القسم',
  device_models: 'تعريفات الأجهزة',
  spare_parts: 'تعريفات قطع الغيار',
  discounts: 'خصومات الأجهزة',
  department_availability: 'أجهزة الأقسام',
  installed_devices: 'الأجهزة المركبة',
  installed_device_possession: 'حيازة الأجهزة',
};

const PERM_LABELS: Record<string, string> = {
  'jobs.vacancies.view_list':       'عرض قائمة الشواغر',
  'jobs.vacancies.view_detail':     'عرض تفاصيل الشاغر',
  'jobs.vacancies.create':          'إنشاء شاغر وظيفي جديد',
  'jobs.vacancies.edit':            'تعديل بيانات الشاغر',
  'jobs.vacancies.change_status':   'تغيير حالة الشاغر',
  'jobs.applications.view_list':    'عرض قائمة طلبات التوظيف',
  'jobs.applications.view_detail':  'عرض تفاصيل الطلب',
  'jobs.applications.create':       'إضافة طلب يدوياً',
  'jobs.applications.change_stage': 'تحريك الطلب بين المراحل',
  'jobs.applications.record_decision': 'تسجيل قرار على الطلب',
  'jobs.applications.hire':         'تأكيد التعيين النهائي',
  'jobs.applications.escalate':     'تصعيد الطلب للإدارة',
  'jobs.applications.archive':      'أرشفة الطلبات',
  'jobs.applications.edit_notes':   'تعديل ملاحظات الطلب',
  'jobs.applications.view_audit_logs': 'عرض سجل التغييرات',
  'jobs.interviews.view_list':      'عرض قائمة المقابلات',
  'jobs.interviews.view_detail':    'عرض تفاصيل المقابلة',
  'jobs.interviews.view_eligible':  'عرض المرشحين للمقابلة',
  'jobs.interviews.schedule':       'جدولة موعد مقابلة',
  'jobs.interviews.conduct':        'إجراء المقابلات',
  'jobs.interviews.edit':           'تعديل بيانات المقابلة',
  'jobs.interviews.record_result':  'تسجيل نتيجة المقابلة',
  'jobs.training.view_list':        'عرض قائمة الدورات التدريبية',
  'jobs.training.view_detail':      'عرض تفاصيل الدورة',
  'jobs.training.view_eligible':    'عرض المرشحين للتدريب',
  'jobs.training.create':           'إنشاء دورة تدريبية',
  'jobs.training.start':            'بدء تنفيذ الدورة',
  'jobs.training.complete':         'إنهاء الدورة التدريبية',
  'jobs.training.record_attendance': 'تسجيل حضور المتدربين',
  'jobs.training.record_result':    'تسجيل نتائج التدريب',
  'jobs.training.add_trainees':     'إضافة متدربين للدورة',
  'admin.roles.view':               'عرض الأدوار الوظيفية',
  'admin.roles.manage':             'إدارة الأدوار والصلاحيات',
  'admin.roles.users.manage':       'إسناد الأدوار للمستخدمين',
  'admin.system_lists.view':        'عرض القوائم النظامية',
  'admin.system_lists.manage':      'إدارة القوائم النظامية',
  'reference_data.lookup':          'قراءة القيم المرجعية داخل الحقول',
  'clients.view_list':              'عرض قائمة الزبائن',
  'clients.view':                   'عرض ملف الزبون',
  'clients.view_detail':            'عرض ملف الزبون',
  'clients.create':                 'إضافة زبون جديد',
  'clients.edit':                   'تعديل بيانات الزبون',
  'clients.delete':                 'حذف الزبون',
  'clients.can_be_assigned':        'قابل للتعيين على زبائن',
  'candidates.view_list':           'عرض الأسماء المقترحة',
  'candidates.create':              'إضافة اسم مقترح',
  'candidates.edit':                'تعديل الاسم المقترح',
  'candidates.name_lists.view_list': 'عرض لوائح الأسماء',
  'candidates.name_lists.create':   'إنشاء لائحة أسماء',
  'candidates.name_lists.edit':     'تعديل لائحة أسماء',
  'candidates.name_lists.delete':   'حذف لائحة أسماء',
  'employees.nav':                  'إظهار سجلات الموظفين',
  'employees.lookup':               'قراءة الموظفين داخل الحقول',
  'employees.manager_lookup':       'قراءة المديرين المباشرين',
  'employees.view_list':            'عرض قائمة الموظفين',
  'employees.create':               'إضافة موظف جديد',
  'employees.edit':                 'تعديل بيانات الموظف',
  'employees.delete':               'حذف موظف',
  'contracts.view_list':            'عرض قائمة العقود',
  'contracts.create':               'إنشاء عقد جديد',
  'contracts.edit':                 'تعديل العقد',
  'devices.nav':                    'إظهار قسم الأجهزة وقطع الغيار',
  'devices.view':                   'عرض الأجهزة وقطع الغيار',
  'devices.manage':                 'إدارة الأجهزة وقطع الغيار',
  'device_models.lookup':           'قراءة تعريفات الأجهزة',
  'spare_parts.lookup':             'قراءة تعريفات قطع الغيار',
  'device_models.manage':           'إدارة تعريفات الأجهزة',
  'spare_parts.manage':             'إدارة تعريفات قطع الغيار',
  'devices.discounts.view':         'عرض خصومات الأجهزة',
  'devices.discounts.manage':       'إدارة خصومات الأجهزة',
  'devices.department_availability.view': 'عرض أجهزة الأقسام',
  'devices.department_availability.manage': 'إدارة أجهزة الأقسام',
  'device_models.task_lookup':      'قراءة أجهزة العمليات',
  'spare_parts.task_lookup':        'قراءة قطع غيار العمليات',
  'tasks.view':                     'عرض المهام والعمليات',
  'tasks.manage':                   'إدارة المهام وتحديث حالاتها',
  'planning.view':                  'عرض خطط وجداول الفرع',
  'planning.manage':                'إدارة الجدولة وتعيين المسارات',
  'planning.schedule.appear':       'الظهور في جدولة الفرق',
  'telemarketer.view':              'عرض إدارة المواعيد',
  'telemarketer.manage':            'إدارة المواعيد والعملاء',
  'geo.view':                       'عرض المناطق الجغرافية',
  'geo.manage':                     'إدارة المناطق والمستويات',
  'branches.nav':                   'إظهار إدارة الفروع والأقسام',
  'branches.lookup':                'قراءة الفروع داخل الحقول',
  'branches.view':                  'عرض الفروع',
  'branches.edit':                  'تعديل بيانات الفرع',
  'branches.manage':                'إدارة الفروع',
  'departments.lookup':             'قراءة الأقسام داخل الحقول',
  'departments.view_list':          'عرض أقسام الفروع',
  'departments.manage':             'إدارة الأقسام',
  'settings.view':                  'عرض إعدادات النظام',
  'settings.manage':                'تعديل إعدادات النظام',
};

function getPermLabel(perm: Permission): string {
  const known = PERM_LABELS[perm.key];
  if (known) return known;
  if (perm.displayName && perm.displayName !== perm.key) return perm.displayName;
  const action = ACTION_LABELS[(perm as any).action ?? ''] ?? 'إجراء مخصص';
  const sub = SUB_MODULE_LABELS[(perm as any).subModule ?? (perm as any).sub_module ?? ''] ?? 'مجموعة صلاحيات';
  return `${action} - ${sub}`;
}

function getPermissionContextLabel(perm: Permission): string {
  const { module, subModule } = getPermissionGrouping(perm);
  const moduleLabel = getModuleConfig(module).label;
  const sub = SUB_MODULE_LABELS[subModule] ?? 'مجموعة صلاحيات';
  return `${moduleLabel} / ${sub}`;
}

function getPermissionGrouping(perm: Permission): { module: string; subModule: string } {
  if (perm.key === 'reference_data.lookup') {
    return { module: 'admin', subModule: 'system_lists' };
  }
  return {
    module: (perm as any).module ?? 'other',
    subModule: (perm as any).subModule ?? (perm as any).sub_module ?? 'general',
  };
}

function getPermissionModule(perm: Permission): string {
  const { module } = getPermissionGrouping(perm);
  return module;
}

function getModuleConfig(module: string) {
  return MODULE_CONFIG[module] ?? {
    label: 'إدارة عمل الفرع',
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-teal-600 bg-teal-50',
  };
}

export default function PermissionSettings() {
  const user = useAuthStore(s => s.user);
  const isSuperAdmin = user?.isSuperAdmin === true;

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [scopeMap, setScopeMap] = useState<Map<number, Set<ScopeKey>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    trpc.roles.allPermissions.query()
      .then(perms => {
        setPermissions(perms);
        const map = new Map<number, Set<ScopeKey>>();
        for (const p of perms) {
          map.set(p.id, new Set(p.allowedScopes as ScopeKey[]));
        }
        setScopeMap(map);
      })
      .catch(() => setError('تعذّر تحميل قائمة الصلاحيات'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Permission[]> = {};
    for (const p of permissions) {
      if (isLegacyPermission(p)) continue;
      const mod = getPermissionModule(p);
      if (!map[mod]) map[mod] = [];
      map[mod].push(p);
    }
    return map;
  }, [permissions]);

  function toggleScope(permId: number, scope: ScopeKey) {
    if (scope === 'GLOBAL') return;
    setScopeMap(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(permId) ?? (['GLOBAL'] as ScopeKey[]));
      if (set.has(scope)) set.delete(scope);
      else set.add(scope);
      next.set(permId, set);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const updates = Array.from(scopeMap.entries()).map(([id, scopes]) => ({
        id,
        allowedScopes: Array.from(scopes),
      }));
      const res = await authFetch('/api/admin/permissions/scopes', {
        method: 'PUT',
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'حدث خطأ أثناء الحفظ');
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message ?? 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (!isSuperAdmin) {
    return <Navigate to="/admin/roles" replace />;
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30 shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-800">إعدادات نطاقات الصلاحيات</h1>
            <p className="text-xs text-slate-500">
              تحديد النطاقات المسموحة لكل صلاحية — يؤثر على الخيارات المتاحة عند تعيين الصلاحيات للأدوار
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ التغييرات
          </button>
        </div>

        {/* Scope legend */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-600 mb-3">شرح النطاقات</p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <span><strong className="text-sky-600">كل الفروع</strong> — الصلاحية تسري على كل الفروع. مطلوب دائماً ولا يمكن إزالته.</span>
            <span><strong className="text-violet-600">فرع المستخدم</strong> — الصلاحية تقتصر على الفرع المُعيَّن للمستخدم.</span>
            <span><strong className="text-amber-600">السجلات المسندة</strong> — الصلاحية تقتصر على السجلات المُسنَدة للمستخدم مباشرة.</span>
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-xl p-4">
            <ShieldCheck className="w-4 h-4 shrink-0" />تم حفظ نطاقات الصلاحيات بنجاح
          </div>
        )}

        {/* Scope column header */}
        <div className="hidden md:flex items-center gap-2 px-5 py-2">
          <div className="flex-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">الصلاحية</div>
          <div className="flex items-center gap-3 shrink-0 ml-2 text-[11px] font-bold text-slate-500">
            {(['GLOBAL', 'BRANCH', 'ASSIGNED'] as ScopeKey[]).map(s => (
              <span key={s} className="w-24 text-center leading-tight">{SCOPE_LABELS[s]}</span>
            ))}
          </div>
        </div>

        {/* Permissions grouped by module */}
        {Object.entries(grouped).map(([module, perms]) => {
          const modCfg = getModuleConfig(module);

          return (
            <div key={module} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Module header */}
              <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-l from-sky-50 via-white to-white border-b border-slate-100">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${modCfg.color}`}>
                  {modCfg.icon}
                </span>
                <h3 className="text-sm font-bold text-slate-700">{modCfg.label}</h3>
                <span className="text-xs text-slate-400 mr-auto">{perms.length} صلاحية</span>
              </div>

              {/* Permission rows */}
              <div className="divide-y divide-slate-50">
                {perms
                  .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                  .map(perm => {
                    const scopes = scopeMap.get(perm.id) ?? new Set<ScopeKey>(['GLOBAL']);

                    return (
                      <div key={perm.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700 truncate">
                            {getPermLabel(perm)}
                          </p>
                          <p className="text-[11px] text-slate-400">{getPermissionContextLabel(perm)}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {(['GLOBAL', 'BRANCH', 'ASSIGNED'] as ScopeKey[]).map(scope => {
                            const isChecked = scopes.has(scope);
                            const isDisabled = scope === 'GLOBAL';
                            return (
                              <div key={scope} className="w-24 flex flex-col items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => toggleScope(perm.id, scope)}
                                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                    isDisabled
                                      ? 'bg-sky-100 border-sky-300 cursor-not-allowed'
                                      : isChecked
                                        ? 'bg-sky-500 border-sky-500 hover:bg-sky-600 hover:border-sky-600'
                                        : 'bg-white border-slate-300 hover:border-sky-400'
                                  }`}
                                  title={isDisabled ? 'النطاق العام مطلوب دائماً' : `تبديل نطاق ${SCOPE_DESCRIPTIONS[scope]}`}
                                >
                                  {isChecked && (
                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                                <span className={`text-[9px] font-semibold md:hidden ${isChecked ? 'text-sky-600' : 'text-slate-300'}`}>
                                  {SCOPE_LABELS[scope]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}

        {permissions.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا توجد صلاحيات متاحة</p>
          </div>
        )}

        {/* Sticky Save */}
        <div className="sticky bottom-4 flex justify-center pb-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-8 py-3 rounded-2xl transition-colors shadow-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ التغييرات
          </button>
        </div>

      </div>
    </div>
  );
}
