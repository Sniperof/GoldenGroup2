import { useCallback, useEffect, useState } from 'react';
import { Loader2, Target, Filter } from 'lucide-react';
import { useOpenTaskStore } from '../hooks/useOpenTaskStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import ClientCardPopup from '../components/ClientCardPopup';
import {
  OPEN_TASK_STATUS_LABELS,
  OPEN_TASK_TYPE_LABELS,
  OPEN_TASK_REASON_LABELS,
  OPEN_TASK_FAMILY_LABELS,
} from '@golden-crm/shared';
import type { OpenTaskStatus, OpenTaskType } from '@golden-crm/shared';
import type { CustomerOwnership } from '../lib/types';

const STATUS_COLORS: Record<string, string> = {
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

const FAMILY_COLORS: Record<string, string> = {
  marketing: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100',
  service: 'bg-cyan-50 text-cyan-700 border border-cyan-100',
  maintenance: 'bg-orange-50 text-orange-700 border border-orange-100',
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getTaskLocation(task: any): string {
  const snapshotAddress = task.clientSnapshot?.address;
  if (snapshotAddress) {
    return [
      snapshotAddress.neighborhood,
      snapshotAddress.subArea,
      snapshotAddress.district,
      snapshotAddress.governorate,
    ].filter(Boolean).join('، ') || '—';
  }

  return [
    task.clientNeighborhood,
    task.clientDistrict,
    task.clientGovernorate,
  ].filter(Boolean).join('، ') || '—';
}

function OwnershipBadge({ ownership }: { ownership?: CustomerOwnership | null }) {
  const label = ownership?.ownerLabel || 'الشركة العامة';
  const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
      isPersonal
        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {label}
    </span>
  );
}

export default function OpenTasks() {
  const { tasks, loading, error, fetchTasks } = useOpenTaskStore();
  const { branchId } = useBranchContextStore();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('');
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  useEffect(() => {
    if (branchId) {
      fetchTasks(branchId, {
        ...(statusFilter ? { status: statusFilter as OpenTaskStatus } : {}),
        ...(taskTypeFilter ? { taskType: taskTypeFilter as OpenTaskType } : {}),
      });
    }
  }, [branchId, statusFilter, taskTypeFilter, fetchTasks]);

  if (!branchId) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Target className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض المهام المفتوحة</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">المهام المفتوحة</h1>
            <p className="text-sm text-slate-500">إدارة المهام التسويقية والخدمية المفتوحة</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={taskTypeFilter}
            onChange={(e) => setTaskTypeFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="">كل الأنواع</option>
            <option value="device_demo">{OPEN_TASK_TYPE_LABELS.device_demo}</option>
            <option value="emergency_maintenance">{OPEN_TASK_TYPE_LABELS.emergency_maintenance}</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="">كل الحالات</option>
            {Object.entries(OPEN_TASK_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          <span className="mr-3 text-slate-600">جارٍ التحميل...</span>
        </div>
      )}

      {/* Tasks table */}
      {!loading && !error && tasks.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Target className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">لا توجد مهام مفتوحة</p>
          <p className="text-sm">سيتم إنشاء المهام تلقائيًا من الزبائن وطلبات الصيانة الطارئة</p>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">اسم الزبون</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الموبايل</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">المنطقة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">نوع المهمة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">العائلة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">السبب</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفريق</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التبعية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      {task.clientId ? (
                        <button
                          onClick={() => setClientPopupId(task.clientId)}
                          className="font-medium text-slate-800 transition-colors hover:text-sky-700 hover:underline"
                        >
                          {task.clientSnapshot?.name || task.clientName || '—'}
                        </button>
                      ) : (
                        <span className="font-medium text-slate-800">
                          {task.clientSnapshot?.name || task.clientName || '—'}
                        </span>
                      )}
                      {task.clientSnapshot?.rating && (
                        <span className="mr-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {task.clientSnapshot.rating}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 direction-ltr" dir="ltr">
                      {task.clientSnapshot?.mobile || task.clientMobile || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {getTaskLocation(task)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100">
                        {OPEN_TASK_TYPE_LABELS[task.taskType] || task.taskType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${FAMILY_COLORS[task.taskFamily] || 'bg-slate-100 text-slate-600'}`}>
                        {OPEN_TASK_FAMILY_LABELS[task.taskFamily] || task.taskFamily}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[task.status] || 'bg-slate-100 text-slate-600'}`}>
                        {OPEN_TASK_STATUS_LABELS[task.status] || task.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {OPEN_TASK_REASON_LABELS[task.reason] || task.reason}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {task.teamSnapshot ? (
                        <div className="flex flex-wrap gap-1">
                          {task.teamSnapshot.supervisor && (
                            <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700">
                              م:{task.teamSnapshot.supervisor.name}
                            </span>
                          )}
                          {task.teamSnapshot.technician && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              ف:{task.teamSnapshot.technician.name}
                            </span>
                          )}
                          {task.teamSnapshot.trainee && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                              م.ت:{task.teamSnapshot.trainee.name}
                            </span>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <OwnershipBadge ownership={task.ownership} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(task.createdAt)}</td>
                  </tr>
                ))}
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
