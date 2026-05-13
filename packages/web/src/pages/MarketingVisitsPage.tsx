import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  ExternalLink,
  Loader2,
  MapPin,
  Phone,
  Target,
} from 'lucide-react';
import type {
  DeviceModel,
  Employee,
  GeoUnit,
  MarketingVisit,
  MarketingVisitResultUpdateRequest,
  MarketingVisitStatus,
} from '@golden-crm/shared';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { buildGeoHierarchyLabel } from '../utils/addressUtils';
import MarketingVisitResultModal from '../components/marketing-visits/MarketingVisitResultModal';

const STATUS_META: Record<MarketingVisitStatus, { label: string; className: string }> = {
  scheduled: { label: 'مجدولة', className: 'bg-slate-100 text-slate-700 border border-slate-200' },
  in_visit: { label: 'في الزيارة', className: 'bg-indigo-50 text-indigo-700 border border-indigo-100' },
  ended: { label: 'انتهت', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  completed: { label: 'تمت', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  not_completed: { label: 'لم تتم', className: 'bg-rose-50 text-rose-700 border border-rose-100' },
  cancelled: { label: 'ملغاة', className: 'bg-slate-200 text-slate-700 border border-slate-300' },
  needs_reschedule: { label: 'تحتاج إعادة جدولة', className: 'bg-yellow-50 text-yellow-700 border border-yellow-100' },
};

const DEFAULT_STATUS_META = { label: 'غير معروفة', className: 'bg-slate-100 text-slate-500 border border-slate-200' };

function getMarketingVisitStatusMeta(status: string | null | undefined) {
  if (!status) return DEFAULT_STATUS_META;
  return STATUS_META[status as MarketingVisitStatus] ?? DEFAULT_STATUS_META;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getToday() {
  return formatDateKey(new Date());
}

function shiftDate(dateStr: string, days: number) {
  const date = parseDateKey(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function formatDateArabic(dateStr: string) {
  return parseDateKey(dateStr).toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getSupervisorName(visit: MarketingVisit, employeesById: Map<number, Employee>): string {
  const id = visit.supervisorEmployeeId ?? visit.teamSnapshot?.supervisorEmployeeId ?? null;
  if (id == null) return '—';
  return employeesById.get(id)?.name ?? `#${id}`;
}

function getTechnicianName(visit: MarketingVisit, employeesById: Map<number, Employee>): string {
  const id = visit.technicianEmployeeId ?? visit.teamSnapshot?.technicianEmployeeId ?? null;
  if (id == null) return '—';
  return employeesById.get(id)?.name ?? `#${id}`;
}

function getTelemarketerName(visit: MarketingVisit, employeesById: Map<number, Employee>): string {
  const ids = visit.teamSnapshot?.telemarketerEmployeeIds;
  if (ids && ids.length > 0) {
    return employeesById.get(ids[0])?.name ?? `#${ids[0]}`;
  }
  return '—';
}

export default function MarketingVisitsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const authUser = useAuthStore((state) => state.user);
  const isPrivilegedUser = authUser?.isSuperAdmin === true || authUser?.role === 'HR_MANAGER' || authUser?.role === 'ADMIN';
  const canViewMarketingVisits = isPrivilegedUser || hasPermission('marketing_visits.view');
  const canUpdateMarketingVisitResult = isPrivilegedUser || hasPermission('marketing_visits.update_result');

  const [date, setDate] = useState(getToday());
  const [visits, setVisits] = useState<MarketingVisit[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [modalError, setModalError] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<MarketingVisit | null>(null);

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );

  const loadVisits = useCallback(async (targetDate: string) => {
    setLoading(true);
    setError('');
    try {
      const [visitsData, employeesData, geoUnitsData, deviceModelsData] = await Promise.all([
        api.marketingVisits.list(targetDate) as Promise<MarketingVisit[]>,
        api.employees.list() as Promise<Employee[]>,
        api.geoUnits.list() as Promise<GeoUnit[]>,
        api.deviceModels.list() as Promise<DeviceModel[]>,
      ]);
      setVisits(visitsData);
      setEmployees(employeesData);
      setGeoUnits(geoUnitsData);
      setDeviceModels(deviceModelsData);
    } catch (loadError) {
      console.error('Failed to load marketing visits:', loadError);
      setError('تعذر تحميل زيارات التسويق');
      setVisits([]);
      setEmployees([]);
      setGeoUnits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewMarketingVisits) {
      setLoading(false);
      return;
    }
    loadVisits(date);
  }, [canViewMarketingVisits, date, loadVisits]);

  const summary = useMemo(() => {
    return {
      total: visits.length,
      scheduled: visits.filter((visit) => visit.status === 'scheduled').length,
      completed: visits.filter((visit) => visit.status === 'completed').length,
      postponed: visits.filter((visit) => visit.status === 'needs_reschedule').length,
      blocked: visits.filter((visit) => visit.status === 'not_completed' || visit.status === 'cancelled').length,
    };
  }, [visits]);

  const handleSubmitResult = async (payload: MarketingVisitResultUpdateRequest) => {
    if (!selectedVisit) return;
    setSavingResult(true);
    setModalError('');
    try {
      await api.marketingVisits.updateResult(selectedVisit.id, payload);
      setSelectedVisit(null);
      setFeedback('تم حفظ نتيجة الزيارة');
      await loadVisits(date);
    } catch (submitError: any) {
      setModalError(submitError?.message || 'تعذر حفظ نتيجة الزيارة');
    } finally {
      setSavingResult(false);
    }
  };

  if (!canViewMarketingVisits) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll" dir="rtl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">زيارات التسويق</h1>
          <p className="mt-1 text-sm text-slate-500">متابعة زيارات التسويق اليومية وتسجيل نتيجتها من مكان واحد.</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setDate((current) => shiftDate(current, -1))}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          title="اليوم السابق"
          aria-label="اليوم السابق"
        >
          <ChevronRight className="h-4 w-4" />
          <span>اليوم السابق</span>
        </button>

        <div className="relative flex min-w-[280px] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-6 py-3">
          <Calendar className="h-5 w-5 text-sky-600" />
          <div className="pointer-events-none text-center">
            <p className="font-bold text-slate-900">{formatDateArabic(date)}</p>
            {date === getToday() ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-600">اليوم</span>
            ) : null}
          </div>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="اختر التاريخ"
          />
        </div>

        <button
          type="button"
          onClick={() => setDate(getToday())}
          className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-100"
          title="العودة إلى اليوم"
          aria-label="العودة إلى اليوم"
        >
          اليوم
        </button>

        <button
          type="button"
          onClick={() => setDate((current) => shiftDate(current, 1))}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          title="اليوم التالي"
          aria-label="اليوم التالي"
        >
          <span>اليوم التالي</span>
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {feedback ? (
        <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {feedback}
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">إجمالي الزيارات</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">مجدولة</p>
          <p className="mt-2 text-2xl font-black text-slate-700">{summary.scheduled}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
          <p className="text-xs font-bold text-emerald-700">تمت</p>
          <p className="mt-2 text-2xl font-black text-emerald-700">{summary.completed}</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
          <p className="text-xs font-bold text-amber-700">مؤجلة</p>
          <p className="mt-2 text-2xl font-black text-amber-700">{summary.postponed}</p>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
          <p className="text-xs font-bold text-rose-700">لم تتم / ملغاة</p>
          <p className="mt-2 text-2xl font-black text-rose-700">{summary.blocked}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">جدول زيارات اليوم</h2>
            <p className="mt-1 text-xs text-slate-500">اعرض الزيارات المجدولة وسجل نتيجتها من نفس الشاشة.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
            <span>جاري تحميل زيارات التسويق...</span>
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-bold text-rose-600">{error}</p>
          </div>
        ) : visits.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-600">لا توجد زيارات تسويق لهذا التاريخ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-right">
              <thead className="bg-slate-50">
                <tr className="text-xs font-bold text-slate-600">
                  <th className="px-4 py-3">وقت الزيارة</th>
                  <th className="px-4 py-3">اسم الزبون</th>
                  <th className="px-4 py-3">رقم الموبايل</th>
                  <th className="px-4 py-3">العنوان</th>
                  <th className="px-4 py-3">الجهاز المطلوب عرضه</th>
                  <th className="px-4 py-3">مصدر المياه</th>
                  <th className="px-4 py-3">المشرفة</th>
                  <th className="px-4 py-3">الفني</th>
                  <th className="px-4 py-3">التيلماركتر</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((visit) => (
                  <tr key={visit.id} className="align-top transition-colors hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-slate-800">{visit.scheduledTime || '—'}</td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/marketing-visits/${visit.id}`)}
                        className="text-right hover:underline"
                      >
                        <div className="font-semibold text-sky-700">{visit.customerName || '—'}</div>
                        {visit.clientId ? <div className="mt-1 text-xs text-slate-400">#{visit.clientId}</div> : null}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{visit.customerMobile || '—'}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      <div className="flex max-w-xs items-start gap-1.5">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span>
                          {buildGeoHierarchyLabel({
                            geoUnits,
                            neighborhoodId: visit.clientNeighborhood,
                            governorate: visit.clientGovernorate,
                            district: visit.clientDistrict,
                            fallback: visit.customerAddress,
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">{visit.requestedDeviceName || '—'}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{visit.waterSource || '—'}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{getSupervisorName(visit, employeesById)}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{getTechnicianName(visit, employeesById)}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{getTelemarketerName(visit, employeesById)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getMarketingVisitStatusMeta(visit.status).className}`}>
                        {getMarketingVisitStatusMeta(visit.status).label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/marketing-visits/${visit.id}`)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
                      >
                        <Eye className="h-4 w-4" />
                        <span>عرض التفاصيل</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MarketingVisitResultModal
        isOpen={selectedVisit != null}
        visit={selectedVisit}
        employees={employees}
        deviceModels={deviceModels}
        saving={savingResult}
        error={modalError}
        onClose={() => {
          if (savingResult) return;
          setSelectedVisit(null);
          setModalError('');
        }}
        onSubmit={handleSubmitResult}
      />
    </div>
  );
}
