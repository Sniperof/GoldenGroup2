import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, ClipboardList, Eye, Loader2, MapPin } from 'lucide-react';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';

const STATUS_META: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'مجدولة', className: 'bg-slate-100 text-slate-700 border border-slate-200' },
  in_progress: { label: 'جارية', className: 'bg-indigo-50 text-indigo-700 border border-indigo-100' },
  ended: { label: 'انتهت', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  completed: { label: 'تمت', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  not_completed: { label: 'لم تتم', className: 'bg-rose-50 text-rose-700 border border-rose-100' },
  cancelled: { label: 'ملغاة', className: 'bg-slate-200 text-slate-700 border border-slate-300' },
  needs_reschedule: { label: 'تحتاج إعادة جدولة', className: 'bg-yellow-50 text-yellow-700 border border-yellow-100' },
  postponed_by_company: { label: 'مؤجلة من الشركة', className: 'bg-orange-50 text-orange-700 border border-orange-100' },
  postponed_by_customer: { label: 'مؤجلة من الزبون', className: 'bg-orange-50 text-orange-700 border border-orange-100' },
};
const DEFAULT_STATUS = { label: 'غير معروفة', className: 'bg-slate-100 text-slate-500 border border-slate-200' };

const VISIT_TYPE_META: Record<string, { label: string; className: string }> = {
  marketing: { label: 'تسويق', className: 'bg-sky-50 text-sky-700 border border-sky-100' },
  emergency: { label: 'طارئة', className: 'bg-rose-50 text-rose-700 border border-rose-100' },
};

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(v: string) {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getToday() {
  return formatDateKey(new Date());
}

function shiftDate(s: string, days: number) {
  const d = parseDateKey(s);
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

function formatDateArabic(s: string) {
  return parseDateKey(s).toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getTeamLabel(teamSnapshot: any): string {
  if (!teamSnapshot) return '—';
  const sup = teamSnapshot.supervisorName ?? teamSnapshot.supervisorEmployeeId;
  const tech = teamSnapshot.technicianName ?? teamSnapshot.technicianEmployeeId;
  if (sup && tech) return `${sup} / ${tech}`;
  if (sup) return String(sup);
  if (tech) return String(tech);
  return '—';
}

export default function VisitsListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const authUser = useAuthStore((state) => state.user);
  const isPrivileged = authUser?.isSuperAdmin === true || authUser?.role === 'HR_MANAGER' || authUser?.role === 'ADMIN';
  const canView = isPrivileged || hasPermission('field_visits.view');

  const [date, setDate] = useState(getToday());
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (targetDate: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.fieldVisits.list(targetDate);
      setVisits(data ?? []);
    } catch {
      setError('تعذر تحميل قائمة الزيارات');
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    load(date);
  }, [canView, date, load]);

  const summary = useMemo(() => ({
    total: visits.length,
    scheduled: visits.filter((v) => v.status === 'scheduled').length,
    completed: visits.filter((v) => v.status === 'completed').length,
    reschedule: visits.filter((v) => v.status === 'needs_reschedule').length,
    blocked: visits.filter((v) => v.status === 'not_completed' || v.status === 'cancelled').length,
  }), [visits]);

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">الزيارات الميدانية</h1>
        <p className="mt-1 text-sm text-slate-500">جميع أنواع الزيارات — التسويق والتسليم والتركيب والطوارئ.</p>
      </div>

      {/* Date navigator */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setDate((c) => shiftDate(c, -1))}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
          <span>اليوم السابق</span>
        </button>
        <div className="relative flex min-w-[280px] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-6 py-3">
          <Calendar className="h-5 w-5 text-sky-600" />
          <div className="pointer-events-none text-center">
            <p className="font-bold text-slate-900">{formatDateArabic(date)}</p>
            {date === getToday() && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-600">اليوم</span>
            )}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="اختر التاريخ"
          />
        </div>
        <button
          type="button"
          onClick={() => setDate(getToday())}
          className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-100"
        >
          اليوم
        </button>
        <button
          type="button"
          onClick={() => setDate((c) => shiftDate(c, 1))}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <span>اليوم التالي</span>
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Summary */}
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'إجمالي الزيارات', value: summary.total, cls: 'border-slate-200 bg-white' },
          { label: 'مجدولة', value: summary.scheduled, cls: 'border-slate-200 bg-white' },
          { label: 'تمت', value: summary.completed, cls: 'border-emerald-100 bg-emerald-50' },
          { label: 'تحتاج إعادة جدولة', value: summary.reschedule, cls: 'border-amber-100 bg-amber-50' },
          { label: 'لم تتم / ملغاة', value: summary.blocked, cls: 'border-rose-100 bg-rose-50' },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`rounded-2xl border p-4 shadow-sm ${cls}`}>
            <p className="text-xs font-bold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">زيارات {formatDateArabic(date)}</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
            <span>جاري تحميل الزيارات...</span>
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-sm font-bold text-rose-600">{error}</div>
        ) : visits.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-600">لا توجد زيارات لهذا التاريخ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-right">
              <thead className="bg-slate-50">
                <tr className="text-xs font-bold text-slate-600">
                  <th className="px-4 py-3">الوقت</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3">اسم الزبون</th>
                  <th className="px-4 py-3">رقم الموبايل</th>
                  <th className="px-4 py-3">المنطقة</th>
                  <th className="px-4 py-3">الفريق</th>
                  <th className="px-4 py-3">المهام</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((visit) => {
                  const statusMeta = STATUS_META[visit.status] ?? DEFAULT_STATUS;
                  const typeMeta = VISIT_TYPE_META[visit.visitType] ?? { label: visit.visitType, className: 'bg-slate-100 text-slate-600 border border-slate-200' };
                  return (
                    <tr key={visit.id} className="align-top transition-colors hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-slate-800">
                        {visit.scheduledTime || '—'}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${typeMeta.className}`}>
                          {typeMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => navigate(`/field-visits/${visit.id}`)}
                          className="text-right hover:underline"
                        >
                          <div className="font-semibold text-sky-700">{visit.clientName || '—'}</div>
                          <div className="mt-0.5 text-xs text-slate-400">#{visit.clientId}</div>
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                        {visit.clientMobile || '—'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <span>{visit.clientNeighborhood || visit.branchName || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        {getTeamLabel(visit.teamSnapshot)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        {visit.completedTaskCount}/{visit.taskCount}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => navigate(`/field-visits/${visit.id}`)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
                        >
                          <Eye className="h-4 w-4" />
                          <span>عرض</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
