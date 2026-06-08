import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import type { TaskResultModalProps, TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';
import DeliveryInfoTab from '../../taskTypes/device_delivery/DeliveryInfoTab';
import DeviceDeliveryResultModal from '../../taskTypes/device_delivery/DeviceDeliveryResultModal';
import DeviceInstallationResultModal from '../../taskTypes/device_delivery/DeviceInstallationResultModal';

const RECORDABLE_POST_SALE_TYPES = new Set(['device_delivery', 'device_installation']);

const PostSaleResultModal = (props: TaskResultModalProps) => {
  const taskType = props.task?.taskType ?? props.task?.task_type;
  if (taskType === 'device_installation') {
    return <DeviceInstallationResultModal {...props} />;
  }
  if (taskType === 'device_delivery') {
    return <DeviceDeliveryResultModal {...props} />;
  }
  return null;
};

const postSaleExtension: TaskTypeExtension = {
  ResultModal: PostSaleResultModal,
  canRecordResultFor: (task) => RECORDABLE_POST_SALE_TYPES.has(task?.taskType ?? task?.task_type),
  extraTabs: [
    {
      id: 'delivery-info',
      label: 'تفاصيل الخدمة',
      render: (data) => <DeliveryInfoTab data={data} />,
    },
  ],
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

function overviewIssuesFor(data: TaskDetailData): string[] {
  const { task } = data;
  const issues: string[] = [];
  if (!task.createdByName) issues.push('منشئ المهمة غير موجود أو ناقص');
  if (!task.dueDate) issues.push('التاريخ المطلوب غير محدد');
  if (task.status === 'scheduled' && !task.activeVisit) {
    issues.push('المهمة بحالة "مجدولة" بلا زيارة نشطة مرتبطة');
  }
  return issues;
}

function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
}

export default function PostSaleTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={RefreshCw}
      typeIconColor="text-sky-500"
      backLabel="مهام خدمات ما بعد البيع"
      backHref="/tasks/group/after-sale-services"
      extension={postSaleExtension}
      scheduleExtraRows={scheduleExtraRows}
      overviewIssuesFor={overviewIssuesFor}
      hasResultFor={hasResultFor}
    />
  );
}
