import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  ClipboardList,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Target,
  User,
  Users,
} from 'lucide-react';
import type {
  ContactEntry,
  Employee,
  GeoUnit,
  MarketingVisit,
  MarketingVisitResultUpdateRequest,
  MarketingVisitStatus,
  MarketingVisitTask,
  MarketingVisitTaskResult,
} from '@golden-crm/shared';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { buildDetailedAddressLabel, buildMapsUrl } from '../utils/addressUtils';
import ClientAvatar from '../components/ClientAvatar';
import MarketingVisitResultModal from '../components/marketing-visits/MarketingVisitResultModal';

const STATUS_META: Record<MarketingVisitStatus, { label: string; className: string }> = {
  scheduled: { label: 'مجدولة', className: 'bg-slate-100 text-slate-700 border border-slate-200' },
  completed: { label: 'تمت', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  not_completed: { label: 'لم تتم', className: 'bg-rose-50 text-rose-700 border border-rose-100' },
  postponed_by_company: { label: 'مؤجلة من الشركة', className: 'bg-amber-50 text-amber-700 border border-amber-100' },
  postponed_by_customer: { label: 'مؤجلة من الزبون', className: 'bg-orange-50 text-orange-700 border border-orange-100' },
  cancelled: { label: 'ملغاة', className: 'bg-slate-200 text-slate-700 border border-slate-300' },
  needs_reschedule: { label: 'بحاجة إعادة جدولة', className: 'bg-yellow-50 text-yellow-700 border border-yellow-100' },
};

const TASK_RESULT_LABELS: Record<MarketingVisitTaskResult, string> = {
  cash_offer_closed: 'تم تقديم عرض كاش — تم الإغلاق',
  installment_offer_closed: 'تم تقديم عرض تقسيط — تم الإغلاق',
  cash_offer_not_closed: 'تم تقديم عرض كاش — لم يتم الإغلاق',
  installment_offer_not_closed: 'تم تقديم عرض تقسيط — لم يتم الإغلاق',
  demo_not_completed: 'لم يتم تقديم العرض',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  device_demo: 'عرض جهاز',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending:       'قيد الانتظار',
  completed:     'مكتملة',
  not_completed: 'لم تكتمل',
};

const TASK_STATUS_STYLES: Record<string, string> = {
  pending:       'bg-amber-50 text-amber-700 border border-amber-100',
  completed:     'bg-emerald-50 text-emerald-700 border border-emerald-100',
  not_completed: 'bg-rose-50 text-rose-700 border border-rose-100',
};

const CONTACT_STATUS_LABELS: Record<string, string> = {
  preferred: 'مفضل',
  active: 'فعال',
  'out-of-coverage': 'خارج التغطية',
  unused: 'غير مستخدم',
  invalid: 'قيمة خاطئة',
};

const CONTACT_STATUS_STYLES: Record<string, string> = {
  preferred: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  active: 'bg-sky-50 text-sky-700 border-sky-200',
  'out-of-coverage': 'bg-orange-50 text-orange-700 border-orange-200',
  unused: 'bg-slate-100 text-slate-500 border-slate-200',
  invalid: 'bg-red-50 text-red-600 border-red-200',
};

function formatDateArabic(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString('ar-SY', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractGeoComponents(args: {
  geoUnits?: any[] | null;
  neighborhoodId?: string | number | null;
  governorate?: string | null;
  district?: string | null;
}) {
  const { geoUnits, neighborhoodId, governorate, district } = args;
  const result = {
    governorate: governorate || null,
    districtSubarea: null as string | null,
    neighborhood: null as string | null,
  };

  if (neighborhoodId && geoUnits && geoUnits.length > 0) {
    const nId = typeof neighborhoodId === 'string' ? parseInt(neighborhoodId, 10) : neighborhoodId;
    if (!isNaN(nId)) {
      const neighborhood = geoUnits.find((u: any) => u.id === nId);
      if (neighborhood) {
        result.neighborhood = neighborhood.name;
        const parent = geoUnits.find((u: any) => u.id === neighborhood.parentId);
        if (parent) {
          result.districtSubarea = parent.name;
          const grandparent = geoUnits.find((u: any) => u.id === parent.parentId);
          if (grandparent) {
            result.governorate = grandparent.name;
          }
        }
      }
    }
  }

  return result;
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className="text-sm text-slate-800">{value || '—'}</span>
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, icon, children }: SectionProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
        <span className="text-slate-400">{icon}</span>
        <h2 className="text-sm font-bold text-slate-700">{title}</h2>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

export default function MarketingVisitDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const authUser = useAuthStore((state) => state.user);
  const isPrivilegedUser =
    authUser?.isSuperAdmin === true ||
    authUser?.role === 'HR_MANAGER' ||
    authUser?.role === 'ADMIN';
  const canViewMarketingVisits = isPrivilegedUser || hasPermission('marketing_visits.view');
  const canUpdateMarketingVisitResult =
    isPrivilegedUser || hasPermission('marketing_visits.update_result');

  const [visit, setVisit] = useState<MarketingVisit | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTask, setSelectedTask] = useState<MarketingVisitTask | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [modalError, setModalError] = useState('');
  const [resultSaved, setResultSaved] = useState(false);

  const employeesById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [visitData, employeesData, geoUnitsData] = await Promise.all([
        api.marketingVisits.get(id) as Promise<MarketingVisit>,
        api.employees.list() as Promise<Employee[]>,
        api.geoUnits.list() as Promise<GeoUnit[]>,
      ]);
      setVisit(visitData);
      setEmployees(employeesData);
      setGeoUnits(geoUnitsData);
    } catch {
      setError('تعذر تحميل تفاصيل الزيارة');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canViewMarketingVisits) {
      setLoading(false);
      return;
    }
    load();
  }, [canViewMarketingVisits, load]);

  const handleSubmitResult = async (payload: MarketingVisitResultUpdateRequest) => {
    if (!visit) return;
    setSavingResult(true);
    setModalError('');
    try {
      await api.marketingVisits.updateResult(visit.id, payload);
      setSelectedTask(null);
      setResultSaved(true);
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'تعذر حفظ نتيجة الزيارة');
    } finally {
      setSavingResult(false);
    }
  };

  if (!canViewMarketingVisits) return <Navigate to="/" replace />;

  const supervisorName = (() => {
    if (!visit) return '—';
    const id2 = visit.supervisorEmployeeId ?? visit.teamSnapshot?.supervisorEmployeeId ?? null;
    if (id2 == null) return '—';
    return employeesById.get(id2)?.name ?? `#${id2}`;
  })();

  const technicianName = (() => {
    if (!visit) return '—';
    const id2 = visit.technicianEmployeeId ?? visit.teamSnapshot?.technicianEmployeeId ?? null;
    if (id2 == null) return '—';
    return employeesById.get(id2)?.name ?? `#${id2}`;
  })();

  const traineeName = (() => {
    if (!visit) return '—';
    const id2 = visit.traineeEmployeeId ?? visit.teamSnapshot?.traineeEmployeeId ?? null;
    if (id2 == null) return '—';
    return employeesById.get(id2)?.name ?? `#${id2}`;
  })();

  const telemarketerName = (() => {
    if (!visit) return '—';
    const ids = visit.teamSnapshot?.telemarketerEmployeeIds;
    if (ids && ids.length > 0) {
      return employeesById.get(ids[0])?.name ?? `#${ids[0]}`;
    }
    return '—';
  })();

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll" dir="rtl">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <button
          type="button"
          onClick={() => navigate('/marketing-visits')}
          className="mt-1 flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
        >
          <ArrowRight className="h-4 w-4" />
          <span>رجوع</span>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">تفاصيل زيارة التسويق</h1>
          {visit ? (
            <p className="mt-1 text-sm text-slate-500">
              {visit.customerName || '—'} — {formatDateArabic(visit.scheduledDate)}
            </p>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
          <span>جاري تحميل تفاصيل الزيارة...</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-6 py-12 text-center">
          <p className="text-sm font-bold text-rose-600">{error}</p>
        </div>
      ) : !visit ? null : (
        <div className="space-y-5">
          {resultSaved ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              تم حفظ نتيجة الزيارة بنجاح.
            </div>
          ) : null}

          {/* Section 1: بيانات الموعد */}
          <Section title="بيانات الموعد" icon={<Calendar className="h-4 w-4" />}>
            <InfoRow label="معرف الزيارة" value={<span className="font-mono text-xs text-slate-500">{visit.id}</span>} />
            <InfoRow
              label="حالة الزيارة"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_META[visit.status].className}`}>
                  {STATUS_META[visit.status].label}
                </span>
              }
            />
            <InfoRow label="تاريخ الموعد" value={formatDateArabic(visit.scheduledDate)} />
            <InfoRow label="وقت الموعد" value={visit.scheduledTime || '—'} />
            <InfoRow label="مصدر الزيارة" value="موعد تيلماركتنج" />
            <InfoRow label="تاريخ إنشاء الزيارة" value={formatDateTime(visit.createdAt)} />
          </Section>

          {/* Section 2: بيانات الزبون */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
              <span className="text-slate-400"><User className="h-4 w-4" /></span>
              <h2 className="text-sm font-bold text-slate-700">بيانات الزبون</h2>
            </div>
            <div className="p-5">
              <div className="flex gap-5">
                {/* Avatar */}
                <div className="shrink-0">
                  <ClientAvatar
                    gender={visit.clientGender ?? null}
                    dataQuality={visit.clientDataQuality ?? null}
                    size="lg"
                  />
                </div>

                {/* Info */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  {/* Name + nickname */}
                  <div>
                    <div className="text-lg font-bold text-slate-900">{visit.customerName || '—'}</div>
                    {visit.clientNickname ? (
                      <div className="mt-0.5 text-sm text-slate-500">لقب: {visit.clientNickname}</div>
                    ) : null}
                  </div>

                  {/* Badges: branch, occupation, commitment */}
                  {(visit.branchName || visit.clientOccupation || (visit.clientRating && visit.clientRating !== 'Undefined')) ? (
                    <div className="flex flex-wrap gap-2">
                      {visit.branchName ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                          <Building2 className="h-3 w-3" />
                          {visit.branchName}
                        </span>
                      ) : null}
                      {visit.clientOccupation ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">
                          <Briefcase className="h-3 w-3" />
                          {visit.clientOccupation}
                        </span>
                      ) : null}
                      {visit.clientRating === 'Committed' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                          <ShieldCheck className="h-3 w-3" />
                          زبون ملتزم
                        </span>
                      ) : visit.clientRating === 'NotCommitted' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                          <ShieldCheck className="h-3 w-3" />
                          زبون غير ملتزم
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Structured address */}
                  {(() => {
                    const geo = extractGeoComponents({
                      geoUnits,
                      neighborhoodId: visit.clientNeighborhood,
                      governorate: visit.clientGovernorate,
                      district: visit.clientDistrict,
                    });
                    const parts = [geo.governorate, geo.districtSubarea, geo.neighborhood].filter(Boolean);
                    const addressStr = parts.length > 0 ? parts.join('، ') : (visit.customerAddress || null);
                    return addressStr ? (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="text-sm text-slate-700">{addressStr}</span>
                      </div>
                    ) : null;
                  })()}

                  {/* Detailed address */}
                  {visit.clientDetailedAddress ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-slate-500">الموقع التفصيلي</span>
                      <span className="text-sm text-slate-700">{visit.clientDetailedAddress}</span>
                    </div>
                  ) : null}

                  {/* Phone chips */}
                  {(() => {
                    const contacts: ContactEntry[] =
                      Array.isArray(visit.clientContacts) && visit.clientContacts.length > 0
                        ? visit.clientContacts
                        : visit.customerMobile
                          ? [{ id: 'fallback', type: 'mobile', number: visit.customerMobile, label: '', hasWhatsApp: false, isPrimary: true, status: 'active' }]
                          : [];
                    if (contacts.length === 0) return null;
                    return (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-bold text-slate-500">أرقام التواصل</span>
                        <div className="flex flex-wrap gap-2">
                          {contacts.map((c, i) => (
                            <div
                              key={c.id ?? i}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${CONTACT_STATUS_STYLES[c.status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}
                            >
                              <Phone className="h-3 w-3" />
                              <span>{c.number}</span>
                              {CONTACT_STATUS_LABELS[c.status] ? (
                                <span className="opacity-60">— {CONTACT_STATUS_LABELS[c.status]}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Map link */}
                  {visit.clientGpsCoordinates && buildMapsUrl(visit.clientGpsCoordinates) ? (
                    <a
                      href={buildMapsUrl(visit.clientGpsCoordinates) ?? ''}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-100"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      <span>فتح الموقع على الخريطة</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}

                  {/* Water source */}
                  {visit.waterSource ? (
                    <InfoRow label="مصدر مياه الشرب" value={visit.waterSource} />
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: بيانات خطة العمل */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
              <Users className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700">بيانات خطة العمل</h2>
            </div>
            <div className="divide-y divide-slate-100">

              {/* الفريق */}
              <div className="p-5">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">الفريق</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="flex flex-col gap-1 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-indigo-400">مشرف</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{supervisorName}</span>
                  </div>
                  <div className="flex flex-col gap-1 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-emerald-500">فني</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{technicianName}</span>
                  </div>
                  <div className="flex flex-col gap-1 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-violet-400">تيلماركتر</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{telemarketerName}</span>
                  </div>
                  {(visit.traineeEmployeeId ?? visit.teamSnapshot?.traineeEmployeeId) != null ? (
                    <div className="flex flex-col gap-1 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                      <span className="text-[10px] font-bold text-amber-500">متدرب</span>
                      <span className="text-sm font-semibold text-slate-800 truncate">{traineeName}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* نطاق العمل */}
              <div className="p-5">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">نطاق العمل</p>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 min-w-[120px]">
                    <Navigation className="h-5 w-5 shrink-0 text-sky-400" />
                    <div>
                      <p className="text-[10px] font-bold text-sky-500">المسارات</p>
                      <p className="text-xl font-bold text-slate-800 leading-tight">
                        {visit.workRouteCount != null ? visit.workRouteCount : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 min-w-[140px]">
                    <MapPin className="h-5 w-5 shrink-0 text-teal-400" />
                    <div>
                      <p className="text-[10px] font-bold text-teal-500">المناطق الإضافية</p>
                      <p className="text-xl font-bold text-slate-800 leading-tight">
                        {visit.additionalAreaCount != null ? visit.additionalAreaCount : '—'}
                      </p>
                    </div>
                  </div>
                </div>
                {(visit.workRouteCount == null || visit.workRouteCount === 0) &&
                 (visit.additionalAreaCount == null || visit.additionalAreaCount === 0) ? (
                  <p className="mt-3 text-xs text-slate-400">لم يتم تحديد نطاق عمل لهذه الزيارة</p>
                ) : null}
              </div>

            </div>
          </div>

          {/* Section 4: مهمة الزيارة */}
          <Section title="مهمة الزيارة" icon={<ClipboardList className="h-4 w-4" />}>
            <InfoRow label="نوع الزيارة" value="زيارة تسويق" />
            <InfoRow label="المهمة" value="عرض جهاز" />
            <InfoRow label="الجهاز المطلوب عرضه" value={visit.requestedDeviceName} />
            {visit.technicianNotes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <InfoRow label="ملاحظات خاصة للفني" value={visit.technicianNotes} />
              </div>
            ) : null}
          </Section>

          {/* Section 5: مهام الزيارة */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
              <ClipboardList className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700">مهام الزيارة</h2>
            </div>

            {(!visit.tasks || visit.tasks.length === 0) ? (
              <div className="px-5 py-10 text-center">
                <ClipboardList className="mx-auto mb-3 h-9 w-9 text-slate-300" />
                <p className="text-sm text-slate-500">لا توجد مهام مرتبطة بهذه الزيارة</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visit.tasks.map((task) => (
                  <div key={task.id} className="p-5 space-y-4">
                    {/* Task header */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700">
                          <ClipboardList className="h-3.5 w-3.5" />
                          {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                        </span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${TASK_STATUS_STYLES[task.status] ?? ''}`}>
                          {TASK_STATUS_LABELS[task.status] ?? task.status}
                        </span>
                      </div>
                      {task.status === 'pending' && visit.status === 'scheduled' && canUpdateMarketingVisitResult ? (
                        <button
                          type="button"
                          onClick={() => { setModalError(''); setSelectedTask(task); }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-700"
                        >
                          <Target className="h-3.5 w-3.5" />
                          تسجيل نتيجة المهمة
                        </button>
                      ) : null}
                    </div>

                    {/* Task result details */}
                    {task.result != null ? (
                      <div className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        <InfoRow
                          label="نتيجة عرض الجهاز"
                          value={TASK_RESULT_LABELS[task.result] ?? task.result}
                        />
                        {task.cashOfferAmount != null ? (
                          <InfoRow
                            label="قيمة العرض الكاش"
                            value={`${task.cashOfferAmount.toLocaleString('ar-SY')} ل.س`}
                          />
                        ) : null}
                        {task.installmentAmount != null ? (
                          <InfoRow
                            label="قيمة القسط"
                            value={`${task.installmentAmount.toLocaleString('ar-SY')} ل.س`}
                          />
                        ) : null}
                        {task.installmentMonths != null ? (
                          <InfoRow label="عدد الأشهر" value={`${task.installmentMonths} شهر`} />
                        ) : null}
                        {task.closedByEmployeeId != null ? (
                          <InfoRow
                            label="تم الإغلاق مع"
                            value={employeesById.get(task.closedByEmployeeId)?.name ?? `#${task.closedByEmployeeId}`}
                          />
                        ) : null}
                        {task.resultNotes ? (
                          <div className="sm:col-span-2 lg:col-span-3">
                            <InfoRow label="ملاحظات النتيجة" value={task.resultNotes} />
                          </div>
                        ) : null}
                        {task.completedAt ? (
                          <InfoRow label="وقت التسجيل" value={formatDateTime(task.completedAt)} />
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">لم يتم تسجيل نتيجة هذه المهمة بعد</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {visit ? (
        <MarketingVisitResultModal
          isOpen={selectedTask != null}
          task={selectedTask}
          visit={visit}
          employees={employees}
          saving={savingResult}
          error={modalError}
          onClose={() => {
            if (savingResult) return;
            setSelectedTask(null);
            setModalError('');
          }}
          onSubmit={handleSubmitResult}
        />
      ) : null}
    </div>
  );
}
