import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Monitor, Filter, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import ClientCardPopup from '../../components/ClientCardPopup';
import { OPEN_TASK_STATUS_LABELS } from '@golden-crm/shared';

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border border-sky-200',
  in_contact_list: 'bg-blue-50 text-blue-700 border border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_visit: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  needs_reschedule: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'مجدول',
  in_progress: 'جارٍ',
  completed: 'مكتمل',
  not_completed: 'لم يكتمل',
  postponed_by_company: 'مؤجل (شركة)',
  postponed_by_customer: 'مؤجل (زبون)',
  cancelled: 'ملغى',
  needs_reschedule: 'يحتاج إعادة جدولة',
};

const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_progress: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  not_completed: 'bg-rose-50 text-rose-700 border border-rose-200',
  postponed_by_company: 'bg-amber-50 text-amber-700 border border-amber-200',
  postponed_by_customer: 'bg-amber-50 text-amber-700 border border-amber-200',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  needs_reschedule: 'bg-orange-50 text-orange-700 border border-orange-200',
};

const RESULT_LABELS: Record<string, string> = {
  cash_offer_closed: 'عرض نقدي مُغلق',
  installment_offer_closed: 'عرض تقسيط مُغلق',
  cash_offer_not_closed: 'عرض نقدي غير مُغلق',
  installment_offer_not_closed: 'عرض تقسيط غير مُغلق',
  demo_not_completed: 'العرض لم يُنجز',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-IQ', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getLocation(row: any): string {
  const snap = row.clientSnapshot?.address;
  if (snap) {
    return [snap.neighborhood, snap.subArea, snap.district, snap.governorate]
      .filter(Boolean).join('، ') || '—';
  }
  return [row.clientNeighborhood, row.clientDistrict, row.clientGovernorate]
    .filter(Boolean).join('، ') || '—';
}

function getTeamDisplay(snapshot: any): string {
  if (!snapshot) return '—';
  const parts: string[] = [];
  if (snapshot.supervisor?.name) parts.push(`م:${snapshot.supervisor.name}`);
  if (snapshot.technician?.name) parts.push(`ف:${snapshot.technician.name}`);
  if (snapshot.trainee?.name) parts.push(`م.ت:${snapshot.trainee.name}`);
  if (snapshot.supervisorEmployeeId && !snapshot.supervisor) parts.push(`م#${snapshot.supervisorEmployeeId}`);
  if (snapshot.technicianEmployeeId && !snapshot.technician) parts.push(`ف#${snapshot.technicianEmployeeId}`);
  return parts.join(' ، ') || '—';
}

export default function DeviceDemo() {
  const navigate = useNavigate();
  const { branchId } = useBranchContextStore();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState('');
  const [scheduledFilter, setScheduledFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.openTasks.listDeviceDemo({
        branchId,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(visitStatusFilter ? { visitStatus: visitStatusFilter } : {}),
        ...(dateFilter ? { scheduledDate: dateFilter } : {}),
        ...(scheduledFilter === 'yes' || scheduledFilter === 'no'
          ? { scheduled: scheduledFilter as 'yes' | 'no' }
          : {}),
      });
      setRows(data);
    } catch {
      setError('تعذر تحميل بيانات عروض الأجهزة');
    } finally {
      setLoading(false);
    }
  }, [branchId, statusFilter, visitStatusFilter, dateFilter, scheduledFilter]);

  useEffect(() => { load(); }, [load]);

  if (!branchId) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Monitor className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض مهام عروض الأجهزة</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">عروض الأجهزة</h1>
            <p className="text-sm text-slate-500">مهام عرض الجهاز المرتبطة بزيارات التسويق</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">كل حالات المهمة</option>
            {Object.entries(OPEN_TASK_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            value={visitStatusFilter}
            onChange={(e) => setVisitStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">كل حالات الزيارة</option>
            {Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            value={scheduledFilter}
            onChange={(e) => setScheduledFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">مجدول / غير مجدول</option>
            <option value="yes">مجدول فقط</option>
            <option value="no">غير مجدول</option>
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="mr-3 text-slate-600">جارٍ التحميل...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">لا توجد مهام عروض أجهزة</p>
          <p className="text-sm">سيتم إنشاء المهام تلقائيًا عند حجز موعد تسويقي من نوع عرض الجهاز</p>
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الزبون</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الموبايل</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">المنطقة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">حالة المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الوقت</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">حالة الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الجهاز المطلوب</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفريق</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">النتيجة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">معرف الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const teamSnap = row.visitTeamSnapshot || row.teamSnapshot;
                  const mobile = row.customerMobile || row.clientSnapshot?.mobile || row.clientMobile || '—';
                  const name = row.customerName || row.clientSnapshot?.name || row.clientName || '—';
                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-indigo-50 hover:cursor-pointer transition-colors" onClick={() => navigate(`/tasks/device-demo/${row.id}`)}>
                      <td className="px-4 py-3">
                        {row.clientId ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setClientPopupId(row.clientId); }}
                            className="font-medium text-slate-800 hover:text-indigo-700 hover:underline transition-colors"
                          >
                            {name}
                          </button>
                        ) : (
                          <span className="font-medium text-slate-800">{name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">{mobile}</td>
                      <td className="px-4 py-3 text-slate-600">{getLocation(row)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TASK_STATUS_COLORS[row.taskStatus] || 'bg-slate-100 text-slate-600'}`}>
                          {(OPEN_TASK_STATUS_LABELS as Record<string, string>)[row.taskStatus] || row.taskStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(row.scheduledDate)}</td>
                      <td className="px-4 py-3 text-slate-600">{row.scheduledTime || '—'}</td>
                      <td className="px-4 py-3">
                        {row.visitStatus ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${VISIT_STATUS_COLORS[row.visitStatus] || 'bg-slate-100 text-slate-600'}`}>
                            {VISIT_STATUS_LABELS[row.visitStatus] || row.visitStatus}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{row.requestedDeviceName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{getTeamDisplay(teamSnap)}</td>
                      <td className="px-4 py-3">
                        {row.latestResult ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                            {RESULT_LABELS[row.latestResult] || row.latestResult}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.marketingVisitId ? (
                          <a
                            href={`/marketing-visits/${row.marketingVisitId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs font-mono text-indigo-600 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {String(row.marketingVisitId).slice(0, 20)}
                          </a>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}
    </div>
  );
}
