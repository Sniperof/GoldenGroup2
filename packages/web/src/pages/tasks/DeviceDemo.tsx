import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Monitor, Filter } from 'lucide-react';
import { api } from '../../lib/api';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import ClientCardPopup from '../../components/ClientCardPopup';
import Select from '../../components/ui/Select';
import { OPEN_TASK_STATUS_LABELS, OPEN_TASK_PHASE_LABELS, OPEN_TASK_PHASE_COLORS, getTaskPhase, type OpenTaskStatus, type CustomerOwnership } from '@golden-crm/shared';
import { getExpectedDateStatus, getDueDateStatus } from '../../lib/taskDateStatus';

const PRIORITY_LABELS: Record<string, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border border-sky-200',
  needs_follow_up: 'bg-amber-50 text-amber-700 border border-amber-200',
  assigned: 'bg-violet-50 text-violet-700 border border-violet-200',
  in_scheduling: 'bg-blue-50 text-blue-700 border border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  waiting_execution: 'bg-teal-50 text-teal-700 border border-teal-200',
  in_execution: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  ended: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  closed: 'bg-slate-100 text-slate-700 border border-slate-200',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
};

// Visit lifecycle per DEC-004 D18: 7 states only — no postponed_by_* and no
// needs_reschedule. Rescheduling moved to the open_task level via
// expected_date + last_waiting_status.
const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'مجدول',
  in_progress: 'جارٍ',
  ended: 'منتهية ميدانياً',
  completed: 'مكتمل',
  not_completed: 'لم يكتمل',
  cancelled: 'ملغى',
  closed: 'مقفلة',
};

const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_progress: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  ended: 'bg-amber-50 text-amber-700 border border-amber-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  not_completed: 'bg-rose-50 text-rose-700 border border-rose-200',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  closed: 'bg-slate-100 text-slate-700 border border-slate-200',
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

function compactText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function getFullCustomerName(row: any): string {
  const structured = [row.clientFirstName, row.clientFatherName, row.clientLastName]
    .map(compactText)
    .filter(Boolean)
    .join(' ');
  return structured || row.clientSnapshot?.name || row.clientName || row.customerName || '—';
}

function getPrimaryMobile(row: any): string {
  return row.clientMobile || row.clientSnapshot?.mobile || row.customerMobile || '—';
}

function getLocation(row: any): string {
  const snap = row.clientSnapshot?.address;
  const hierarchy = snap
    ? [snap.governorate, snap.district, snap.subArea, snap.neighborhood]
    : [row.clientGovernorate, row.clientDistrict, row.clientNeighborhood];

  const lastTwo = hierarchy.map(compactText).filter(Boolean).slice(-2);
  return lastTwo.length > 0 ? lastTwo.join(' > ') : '—';
}

function OwnershipCell({ ownership }: { ownership?: CustomerOwnership | null }) {
  const label = ownership?.ownerLabel || 'الشركة العامة';
  const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');

  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-bold ${
      isPersonal
        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {label}
    </span>
  );
}

function getBranchLabel(row: any): string {
  return compactText(row.displayBranchName) || compactText(row.branchName) || compactText(row.clientBranchName) || compactText(row.taskBranchName) || '—';
}

function getCreatorLabel(row: any): string {
  return compactText(row.displayCreatedByName) || compactText(row.createdByName) || compactText(row.createdBy?.name) || compactText(row.createdBy?.username) || '—';
}

function getDateCounterReference(row: any): string | null {
  return row.taskStatus === 'completed' ? (row.completedAt ?? row.updatedAt ?? null) : null;
}

export default function DeviceDemo() {
  const navigate = useNavigate();
  const { effectiveBranchId, needsBranchSelection } = useBranchListScope();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState('');
  const [scheduledFilter, setScheduledFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [hideSnoozed, setHideSnoozed] = useState(false);
  const [hideFutureTasks, setHideFutureTasks] = useState(false);
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);
  const [savingPriorityId, setSavingPriorityId] = useState<number | null>(null);

  const handlePriorityChange = useCallback(async (rowId: number, newPriority: string) => {
    setSavingPriorityId(rowId);
    try {
      await api.openTasks.update(rowId, { priority: newPriority || null });
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, priority: newPriority || null } : r));
    } catch {
      // silent — row stays unchanged on failure
    } finally {
      setSavingPriorityId(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (needsBranchSelection) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.openTasks.listDeviceDemo({
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(visitStatusFilter ? { visitStatus: visitStatusFilter } : {}),
        ...(dateFilter ? { scheduledDate: dateFilter } : {}),
        ...(scheduledFilter === 'yes' || scheduledFilter === 'no'
          ? { scheduled: scheduledFilter as 'yes' | 'no' }
          : {}),
        ...(hideSnoozed ? { hideSnoozed: 'true' } : {}),
        ...(hideFutureTasks ? { hideFutureTasks: 'true' } : {}),
      });
      setRows(data);
    } catch {
      setError('تعذر تحميل بيانات عروض الأجهزة');
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchId, needsBranchSelection, statusFilter, visitStatusFilter, dateFilter, scheduledFilter, hideSnoozed, hideFutureTasks]);

  useEffect(() => { load(); }, [load]);

  if (needsBranchSelection) {
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

          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            size="sm"
            ariaLabel="حالة المهمة"
            options={[
              { value: '', label: 'كل حالات المهمة' },
              ...Object.entries(OPEN_TASK_STATUS_LABELS).map(([key, label]) => ({ value: key, label: String(label) })),
            ]}
          />

          <Select
            value={visitStatusFilter}
            onChange={(v) => setVisitStatusFilter(v)}
            size="sm"
            ariaLabel="حالة الزيارة"
            options={[
              { value: '', label: 'كل حالات الزيارة' },
              ...Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => ({ value: key, label })),
            ]}
          />

          <Select
            value={scheduledFilter}
            onChange={(v) => setScheduledFilter(v)}
            size="sm"
            ariaLabel="مجدول / غير مجدول"
            options={[
              { value: '', label: 'مجدول / غير مجدول' },
              { value: 'yes', label: 'مجدول فقط' },
              { value: 'no', label: 'غير مجدول' },
            ]}
          />

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />

          <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideSnoozed}
              onChange={(e) => setHideSnoozed(e.target.checked)}
              className="accent-indigo-600"
            />
            <span title="المهام التي حدد لها التلمارك موعداً متوقعاً في المستقبل">إخفاء المؤجلة</span>
          </label>

          <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-pointer text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideFutureTasks}
              onChange={(e) => setHideFutureTasks(e.target.checked)}
              className="accent-indigo-600"
            />
            <span title="استثناء المهام اللاحقة من حساب الحمل — D13">إخفاء اللاحقة</span>
          </label>
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
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">معرف المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفرع</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">اسم الزبون الكامل</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">العنوان</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">رقم الموبايل الأساسي</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الملكية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">المرحلة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الأولوية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التاريخ المطلوب</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التاريخ المتوقع</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">حالة الزيارة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">منشئ المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const mobile = getPrimaryMobile(row);
                  const name = getFullCustomerName(row);
                  const phase = (row.phase ?? getTaskPhase(row.taskStatus as OpenTaskStatus)) as keyof typeof OPEN_TASK_PHASE_LABELS;
                  const dateCounterReference = getDateCounterReference(row);

                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-indigo-50 hover:cursor-pointer transition-colors" onClick={() => navigate(`/tasks/device-demo/${row.id}`)}>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">#{row.id}</td>
                      <td className="px-4 py-3 text-slate-600">{getBranchLabel(row)}</td>
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
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{getLocation(row)}</td>
                      <td className="px-4 py-3 text-slate-600" dir="ltr">{mobile}</td>
                      <td className="px-4 py-3"><OwnershipCell ownership={row.ownership} /></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${OPEN_TASK_PHASE_COLORS[phase]}`}>
                          {OPEN_TASK_PHASE_LABELS[phase]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TASK_STATUS_COLORS[row.taskStatus] || 'bg-slate-100 text-slate-600'}`}>
                          {(OPEN_TASK_STATUS_LABELS as Record<string, string>)[row.taskStatus] || row.taskStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={row.priority || ''}
                          onChange={(v) => handlePriorityChange(row.id, v)}
                          disabled={savingPriorityId === row.id}
                          size="sm"
                          ariaLabel="الأولوية"
                          options={[
                            { value: '', label: '—' },
                            { value: 'high', label: PRIORITY_LABELS.high },
                            { value: 'medium', label: PRIORITY_LABELS.medium },
                            { value: 'low', label: PRIORITY_LABELS.low },
                          ]}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          const s = getDueDateStatus(row.dueDate, dateCounterReference);
                          if (!s) return <span className="text-slate-300">—</span>;
                          return (
                            <div className="flex flex-col gap-1 items-start">
                              <span className={s.textClass}>{formatDate(row.dueDate)}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${s.badgeClass}`}>
                                {s.shortLabel}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          if (!row.expectedDate) return <span className="text-slate-300">—</span>;
                          const s = getExpectedDateStatus(row.expectedDate, dateCounterReference);
                          if (!s) return <span className="text-slate-600">{formatDate(row.expectedDate)}</span>;
                          return (
                            <div className="flex flex-col gap-1 items-start">
                              <span className={s.textClass}>{formatDate(row.expectedDate)}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${s.badgeClass}`}>
                                {s.shortLabel}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(row.scheduledDate)}</td>
                      <td className="px-4 py-3">
                        {row.visitStatus ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${VISIT_STATUS_COLORS[row.visitStatus] || 'bg-slate-100 text-slate-600'}`}>
                            {VISIT_STATUS_LABELS[row.visitStatus] || row.visitStatus}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{getCreatorLabel(row)}</td>
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
