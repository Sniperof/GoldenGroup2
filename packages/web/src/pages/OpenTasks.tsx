import { useCallback, useEffect, useState } from 'react';
import { Loader2, Target, Filter } from 'lucide-react';
import { useOpenTaskStore } from '../hooks/useOpenTaskStore';
import { useBranchListScope } from '../hooks/useBranchListScope';
import ClientCardPopup from '../components/ClientCardPopup';
import {
  OPEN_TASK_STATUS_LABELS,
  OPEN_TASK_TYPE_LABELS,
  OPEN_TASK_REASON_LABELS,
  OPEN_TASK_FAMILY_LABELS,
} from '@golden-crm/shared';
import type { OpenTask, OpenTaskStatus, OpenTaskType } from '@golden-crm/shared';
import type { CustomerOwnership } from '../lib/types';
import Select from '../components/ui/Select';
import PageHeader from '../components/ui/PageHeader';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';

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
  const { effectiveBranchId, needsBranchSelection } = useBranchListScope();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('');
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  useEffect(() => {
    if (needsBranchSelection) return;
    fetchTasks(effectiveBranchId ?? null, {
      ...(statusFilter ? { status: statusFilter as OpenTaskStatus } : {}),
      ...(taskTypeFilter ? { taskType: taskTypeFilter as OpenTaskType } : {}),
    });
  }, [effectiveBranchId, needsBranchSelection, statusFilter, taskTypeFilter, fetchTasks]);

  if (needsBranchSelection) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Target className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض المهام المفتوحة</p>
      </div>
    );
  }

  const columns: ColumnDef<OpenTask>[] = [
    {
      key: 'clientName', label: 'اسم الزبون', sortable: true,
      getValue: (task) => task.clientSnapshot?.name || task.clientName || '',
      render: (task) => (
        <div className="flex items-center">
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
            <span className="mr-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {task.clientSnapshot.rating}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'mobile', label: 'الموبايل', sortable: true,
      getValue: (task) => task.clientSnapshot?.mobile || task.clientMobile || '',
      render: (task) => (
        <span className="text-slate-600" dir="ltr">{task.clientSnapshot?.mobile || task.clientMobile || '—'}</span>
      ),
    },
    {
      key: 'location', label: 'المنطقة', sortable: true,
      getValue: (task) => getTaskLocation(task),
      render: (task) => <span className="text-slate-600">{getTaskLocation(task)}</span>,
    },
    {
      key: 'taskType', label: 'نوع المهمة', sortable: true,
      getValue: (task) => OPEN_TASK_TYPE_LABELS[task.taskType] || task.taskType,
      render: (task) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100">
          {OPEN_TASK_TYPE_LABELS[task.taskType] || task.taskType}
        </span>
      ),
    },
    {
      key: 'taskFamily', label: 'العائلة', sortable: true,
      getValue: (task) => OPEN_TASK_FAMILY_LABELS[task.taskFamily] || task.taskFamily,
      render: (task) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${FAMILY_COLORS[task.taskFamily] || 'bg-slate-100 text-slate-600'}`}>
          {OPEN_TASK_FAMILY_LABELS[task.taskFamily] || task.taskFamily}
        </span>
      ),
    },
    {
      key: 'status', label: 'الحالة', sortable: true,
      getValue: (task) => OPEN_TASK_STATUS_LABELS[task.status] || task.status,
      render: (task) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${STATUS_COLORS[task.status] || 'bg-slate-100 text-slate-600'}`}>
          {OPEN_TASK_STATUS_LABELS[task.status] || task.status}
        </span>
      ),
    },
    {
      key: 'reason', label: 'السبب', sortable: true,
      getValue: (task) => OPEN_TASK_REASON_LABELS[task.reason] || task.reason,
      render: (task) => <span className="text-slate-600">{OPEN_TASK_REASON_LABELS[task.reason] || task.reason}</span>,
    },
    {
      key: 'team', label: 'الفريق', sortable: false,
      render: (task) => task.teamSnapshot ? (
        <div className="flex flex-wrap gap-1">
          {task.teamSnapshot.supervisor && (
            <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700">م:{task.teamSnapshot.supervisor.name}</span>
          )}
          {task.teamSnapshot.technician && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">ف:{task.teamSnapshot.technician.name}</span>
          )}
          {task.teamSnapshot.trainee && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">م.ت:{task.teamSnapshot.trainee.name}</span>
          )}
        </div>
      ) : <span className="text-slate-600">—</span>,
    },
    {
      key: 'ownership', label: 'التبعية', sortable: true,
      getValue: (task) => task.ownership?.ownerLabel || '',
      render: (task) => <OwnershipBadge ownership={task.ownership} />,
    },
    {
      key: 'createdAt', label: 'تاريخ الإنشاء', sortable: true,
      getValue: (task) => task.createdAt || '',
      render: (task) => <span className="text-slate-500 text-xs">{formatDate(task.createdAt)}</span>,
    },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <PageHeader
          title="المهام المفتوحة"
          subtitle="إدارة المهام التسويقية والخدمية المفتوحة"
          icon={
            <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Target className="w-5 h-5 text-white" />
            </div>
          }
        />

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <Select
            value={taskTypeFilter}
            onChange={setTaskTypeFilter}
            placeholder="كل الأنواع"
            ariaLabel="نوع المهمة"
            size="sm"
            options={[
              { value: 'device_demo', label: OPEN_TASK_TYPE_LABELS.device_demo },
              { value: 'emergency_maintenance', label: OPEN_TASK_TYPE_LABELS.emergency_maintenance },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="كل الحالات"
            ariaLabel="الحالة"
            size="sm"
            options={Object.entries(OPEN_TASK_STATUS_LABELS).map(([key, label]) => ({ value: key, label: String(label) }))}
          />
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
        <SmartTable<OpenTask>
          title="جدول المهام المفتوحة"
          icon={Target}
          data={tasks}
          columns={columns}
          getId={(task) => task.id}
          hideFilterBar
          paginated={false}
          tableMinWidth={1180}
          defaultSortKey="createdAt"
          defaultSortDir="desc"
          emptyIcon={Target}
          emptyMessage="لا توجد مهام مفتوحة"
        />
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
