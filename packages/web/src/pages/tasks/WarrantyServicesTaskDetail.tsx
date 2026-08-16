import { useParams } from 'react-router-dom';
import { ShieldCheck } from '../../components/ui/icons';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import type { TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';

// Detail page for warranty-services tasks (golden warranty offer / VIP-card
// delivery / reactivation / cancellation). Mirrors PostSaleTaskDetail so the
// group table behaves like every other group: row click → this detail page,
// while result entry remains exclusively on the linked field-visit page.
const warrantyExtension: TaskTypeExtension = {};

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
