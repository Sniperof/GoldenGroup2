import { useParams } from 'react-router-dom';
import { DollarSign } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import type { TaskDetailData, TaskTypeExtension } from '../../components/tasks/types';
import InstallmentCollectionResultModal from '../../taskTypes/installment_collection/InstallmentCollectionResultModal';

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString('ar-SY')} ل.س` : '—';
}

function collectionOverviewCard(data: TaskDetailData) {
  const { task } = data;
  return (
    <div className="rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-emerald-900">تفاصيل الذمة</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <InfoLine label="مصدر الذمة" value={task.receivableSourceLabel ?? task.receivable_source_label ?? '—'} />
        <InfoLine label="نوع المصدر" value={task.receivableSourceType ?? task.receivable_source_type ?? '—'} />
        <InfoLine label="رقم القسط" value={task.installmentNumber ?? task.installment_number ?? task.installmentId ?? task.installment_id ?? '—'} />
        <InfoLine label="المبلغ المتوقع" value={money(task.expectedAmountSyp ?? task.expected_amount_syp)} />
      </div>
    </div>
  );
}

const collectionExtension: TaskTypeExtension = {
  ResultModal: InstallmentCollectionResultModal,
  canRecordResultFor: (task) => (task?.taskType ?? task?.task_type) === 'installment_collection',
  overviewExtraCards: collectionOverviewCard,
};

function scheduleExtraRows(data: TaskDetailData) {
  const { task } = data;
  const activeVisit = task.activeVisit ?? null;
  const lastAttempt = task.lastAttempt ?? null;
  if (activeVisit) {
    return (
      <>
        <InfoLine label="موعد الزيارة القادمة" value={formatDate(activeVisit.scheduledDate)} />
        <InfoLine label="وقت الزيارة القادمة" value={activeVisit.scheduledTime || '—'} />
      </>
    );
  }
  if (lastAttempt) {
    const datePart = formatDate(lastAttempt.scheduledDate);
    const value = lastAttempt.scheduledTime ? `${datePart} · ${lastAttempt.scheduledTime}` : datePart;
    return <InfoLine label="آخر محاولة" value={value} />;
  }
  return null;
}

function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
}

export default function CollectionTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={DollarSign}
      typeIconColor="text-emerald-500"
      backLabel="مهام تسديد الذمم"
      backHref="/tasks/group/collection"
      extension={collectionExtension}
      scheduleExtraRows={scheduleExtraRows}
      hasResultFor={hasResultFor}
    />
  );
}
