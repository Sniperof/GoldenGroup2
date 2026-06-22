import { useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import type { TaskResultModalProps, TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';
import GoldenWarrantyOfferModal from '../../taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal';
import GoldenWarrantyCardDeliveryModal from '../../taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal';

// Detail page for warranty-services tasks (golden warranty offer / VIP-card
// delivery / reactivation / cancellation). Mirrors PostSaleTaskDetail so the
// group table behaves like every other group: row click → this detail page,
// and the result is recorded through the standard TaskResultTab gate
// (only when an active visit exists). Constitution: unified-task-template + DEC-CT-17.

const RECORDABLE = new Set(['golden_warranty_offer', 'golden_warranty_card_delivery']);

// Both golden modals are unified TaskResultModalProps result modals (post via
// recordTaskResult → reflection). Dispatch by task type.
const WarrantyResultModal = (props: TaskResultModalProps) => {
  const taskType = props.task?.taskType ?? props.task?.task_type;
  if (taskType === 'golden_warranty_offer') return <GoldenWarrantyOfferModal {...props} />;
  if (taskType === 'golden_warranty_card_delivery') return <GoldenWarrantyCardDeliveryModal {...props} />;
  return null;
};

const warrantyExtension: TaskTypeExtension = {
  ResultModal: WarrantyResultModal,
  canRecordResultFor: (task) => RECORDABLE.has(task?.taskType ?? task?.task_type),
};

function hasResultFor(data: TaskDetailData): boolean {
  const s = data.task.status;
  return s === 'completed' || s === 'closed' || s === 'cancelled';
}

export default function WarrantyServicesTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={ShieldCheck}
      typeIconColor="text-violet-500"
      backLabel="مهام خدمات الكفالة"
      backHref="/tasks/group/warranty-services"
      extension={warrantyExtension}
      hasResultFor={hasResultFor}
    />
  );
}
