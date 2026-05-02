import { useCallback, useEffect, useState } from 'react';
import { Loader2, Target, Filter } from 'lucide-react';
import { useOpenTaskStore } from '../hooks/useOpenTaskStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import {
  OPEN_TASK_STATUS_LABELS,
  OPEN_TASK_TYPE_LABELS,
  OPEN_TASK_REASON_LABELS,
} from '@golden-crm/shared';
import type { OpenTaskStatus } from '@golden-crm/shared';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border border-sky-200',
  in_contact_list: 'bg-blue-50 text-blue-700 border border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_visit: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  needs_reschedule: 'bg-amber-50 text-amber-700 border border-amber-200',
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

export default function OpenTasks() {
  const { tasks, loading, error, fetchTasks } = useOpenTaskStore();
  const { branchId } = useBranchContextStore();
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    if (branchId) {
      fetchTasks(branchId, statusFilter ? { status: statusFilter as OpenTaskStatus } : undefined);
    }
  }, [branchId, statusFilter, fetchTasks]);

  if (!branchId) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Target className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض المهام التسويقية</p>
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
            <h1 className="text-2xl font-bold text-slate-800">المهام التسويقية المفتوحة</h1>
            <p className="text-sm text-slate-500">إدارة مهام عرض الجهاز للزبائن الجدد</p>
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
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
      {!loading && tasks.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Target className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">لا توجد مهام مفتوحة</p>
          <p className="text-sm">سيتم إنشاء مهام عرض الجهاز تلقائيًا عند إضافة زبون جديد</p>
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
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">السبب</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">التبعية</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{task.clientName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 direction-ltr" dir="ltr">{task.clientMobile || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {[
                        task.clientNeighborhood,
                        task.clientDistrict,
                        task.clientGovernorate,
                      ].filter(Boolean).join('، ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100">
                        {OPEN_TASK_TYPE_LABELS[task.taskType] || task.taskType}
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
                      {task.assignments && task.assignments.length > 0
                        ? task.assignments.map((a) => a.userName).join('، ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}