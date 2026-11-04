import { useEffect, useState } from 'react';
import {
  ArrowLeftRight, Building2, History, KeyRound, Loader2, PencilLine, Power, PowerOff,
  RefreshCw, ShieldCheck, UserPlus, Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from './EmployeeStatusModal';

// Internal employee timeline (migration 480). Written only by database
// triggers, so every path that changes the employee or their account appears.

const EVENT_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  created:                  { label: 'إنشاء سجل الموظف',       icon: UserPlus,       tone: 'text-emerald-600 bg-emerald-50' },
  field_changed:            { label: 'تعديل بيانات',            icon: PencilLine,     tone: 'text-sky-600 bg-sky-50' },
  status_changed:           { label: 'تغيير الحالة',            icon: RefreshCw,      tone: 'text-amber-600 bg-amber-50' },
  branch_transferred:       { label: 'نقل إلى فرع آخر',         icon: Building2,      tone: 'text-indigo-600 bg-indigo-50' },
  account_created:          { label: 'إنشاء حساب النظام',       icon: ShieldCheck,    tone: 'text-violet-600 bg-violet-50' },
  account_role_changed:     { label: 'تغيير دور الحساب',        icon: ShieldCheck,    tone: 'text-violet-600 bg-violet-50' },
  account_activated:        { label: 'تفعيل حساب النظام',       icon: Power,          tone: 'text-emerald-600 bg-emerald-50' },
  account_deactivated:      { label: 'إيقاف حساب النظام',       icon: PowerOff,       tone: 'text-rose-600 bg-rose-50' },
  account_password_changed: { label: 'تغيير كلمة المرور',       icon: KeyRound,       tone: 'text-slate-600 bg-slate-100' },
  account_linked:           { label: 'ربط حساب نظام',           icon: ShieldCheck,    tone: 'text-violet-600 bg-violet-50' },
  account_unlinked:         { label: 'فك ربط حساب نظام',        icon: ShieldCheck,    tone: 'text-slate-600 bg-slate-100' },
  visit_crew_added:         { label: 'إضافة إلى فريق زيارة',    icon: Users,          tone: 'text-teal-600 bg-teal-50' },
  visit_crew_removed:       { label: 'إزالة من فريق زيارة',     icon: ArrowLeftRight, tone: 'text-slate-600 bg-slate-100' },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم الكامل', first_name: 'الاسم الأول', father_name: 'اسم الأب', last_name: 'الكنية',
  mobile: 'الجوال', contacts: 'أرقام التواصل', avatar: 'الصورة', employee_number: 'رقم الموظف',
  role: 'الدور الميداني', job_title: 'المسمى الوظيفي', department_id: 'القسم', direct_manager_id: 'المدير المباشر',
  hire_date: 'تاريخ التوظيف', start_work_date: 'تاريخ بدء العمل', end_of_service_date: 'تاريخ إيقاف الخدمة',
  contract_type: 'نوع العقد', work_type: 'نوع العمل', birth_date: 'تاريخ الميلاد', gender: 'الجنس',
  marital_status: 'الحالة الاجتماعية', military_service: 'الخدمة العسكرية',
  residence_governorate_id: 'المحافظة', residence_region_id: 'المنطقة', residence_sub_area_id: 'الناحية',
  residence_neighborhood_id: 'الحي', detailed_address: 'العنوان التفصيلي',
  academic_qualification: 'المؤهل العلمي', specialization: 'الاختصاص', years_of_experience: 'سنوات الخبرة',
  driving_license: 'رخصة القيادة', job_skills: 'المهارات', foreign_languages: 'اللغات',
  previous_employment: 'الخبرات السابقة', referrer_type: 'نوع المعرّف', source_channel: 'قناة الاستقطاب',
  referrer_name: 'اسم المعرّف', referral_notes: 'ملاحظات الإحالة', referral_entity_id: 'جهة الإحالة',
  has_car: 'يملك سيارة', max_visit_load: 'الحد الأقصى للزيارات', username: 'اسم الدخول',
};

// Events that move something from one value to another; the rest carry one value.
const TWO_SIDED = new Set(['field_changed', 'status_changed', 'branch_transferred', 'account_role_changed']);

const ROLE_FALLBACK: Record<string, string> = { system: 'النظام', backfill: 'سجل سابق' };

function statusLabel(value: string | null) {
  return value ? EMPLOYEE_STATUS_LABELS[value as EmployeeStatus] ?? value : null;
}

function display(value: string | null) {
  if (value == null || value === '') return '—';
  if (value === 'true') return 'نعم';
  if (value === 'false') return 'لا';
  return value;
}

export default function EmployeeActivityTimeline({ employeeId, reloadToken }: { employeeId: number; reloadToken: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.employees.activity(employeeId)
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch((err: any) => { if (!cancelled) setError(err?.message ?? 'تعذر تحميل سجل الموظف'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId, reloadToken]);

  if (loading) {
    return <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
        <History className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">لا توجد أحداث مسجّلة بعد</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="space-y-3">
        {rows.map((r) => {
          const meta = EVENT_META[r.eventType] ?? { label: r.eventType, icon: History, tone: 'text-slate-600 bg-slate-100' };
          const Icon = meta.icon;
          const fieldLabel = r.fieldKey ? FIELD_LABELS[r.fieldKey] ?? r.fieldKey : null;
          const isStatus = r.eventType === 'status_changed';
          const oldValue = isStatus ? statusLabel(r.oldValue) : r.oldValue;
          const newValue = isStatus ? statusLabel(r.newValue) : r.newValue;
          const showValues = r.eventType !== 'created' && (r.oldValue != null || r.newValue != null);
          return (
            <div key={r.id} className="flex gap-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-800">{meta.label}{fieldLabel ? `: ${fieldLabel}` : ''}</span>
                  <span className="text-slate-400">{new Date(r.createdAt).toLocaleString('ar-SY')}</span>
                </div>
                <p className="text-slate-500">
                  {r.performedByName ?? ROLE_FALLBACK[r.role] ?? '—'}
                </p>
                {showValues ? (
                  <p className="mt-0.5 text-slate-700">
                    {TWO_SIDED.has(r.eventType) ? (
                      <>
                        <span className="text-slate-400 line-through">{display(oldValue)}</span>
                        {' ← '}
                        <span className="font-semibold">{display(newValue)}</span>
                      </>
                    ) : (
                      <span className="font-semibold">{display(newValue ?? oldValue)}</span>
                    )}
                  </p>
                ) : null}
                {r.reason ? <p className="mt-0.5 text-slate-500">السبب: {r.reason}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
