import { useParams } from 'react-router-dom';
import { Gift } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine } from '../../components/tasks/shared';
import type { TaskDetailData, TaskTypeExtension } from '../../components/tasks/types';
import GiftDeliveryResultModal from '../../taskTypes/gift_delivery/GiftDeliveryResultModal';

function giftOverviewCard(data: TaskDetailData) {
  const { task } = data;
  return (
    <div className="rounded-lg border border-rose-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-rose-900">تفاصيل الهدية</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <InfoLine label="الهدية" value={task.giftName ?? task.gift_name ?? task.reason ?? '—'} />
        <InfoLine label="المستفيد" value={task.clientName ?? task.client_name ?? '—'} />
        <InfoLine label="الكمية المعتمدة" value={task.approvedQuantity ?? task.approved_quantity ?? '—'} />
        <InfoLine label="سجل الهدية" value={task.giftRecordId ?? task.gift_record_id ?? '—'} />
      </div>
    </div>
  );
}

const giftExtension: TaskTypeExtension = {
  ResultModal: GiftDeliveryResultModal,
  canRecordResultFor: (task) => (task?.taskType ?? task?.task_type) === 'gift_delivery',
  overviewExtraCards: giftOverviewCard,
};

function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
}

export default function GiftDeliveryTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={Gift}
      typeIconColor="text-rose-500"
      backLabel="مهام تسليم الهدايا"
      backHref="/tasks/group/gift-delivery"
      extension={giftExtension}
      hasResultFor={hasResultFor}
    />
  );
}
