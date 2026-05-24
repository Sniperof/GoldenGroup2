import { useParams } from 'react-router-dom';
import { Truck } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import type { TaskTypeExtension, TaskDetailData, TaskResultRendererProps } from '../../components/tasks/types';
import DeliveryInfoTab from '../../taskTypes/device_delivery/DeliveryInfoTab';
import DeliveryResultRenderer from '../../taskTypes/device_delivery/DeliveryResultRenderer';
import InstallationResultRenderer from '../../taskTypes/device_delivery/InstallationResultRenderer';

const INFO_TAB_LABELS: Record<string, string> = {
  device_delivery:     'معلومات التسليم',
  device_installation: 'معلومات التركيب',
  device_activation:   'معلومات التشغيل',
};

function SmartResultRenderer({ task, preOffers }: TaskResultRendererProps) {
  if (task.taskType === 'device_installation') return <InstallationResultRenderer task={task} preOffers={preOffers} />;
  return <DeliveryResultRenderer task={task} preOffers={preOffers} />;
}

const deliveryExtension: TaskTypeExtension = {
  extraTabs: [
    {
      id: 'delivery_info',
      label: 'معلومات الزيارة',
      renderLabel: (data) => INFO_TAB_LABELS[data.task?.taskType] ?? 'معلومات الزيارة',
      render: (data) => <DeliveryInfoTab data={data} />,
    },
  ],
  ResultRenderer: SmartResultRenderer,
};

function scheduleExtraRows(data: TaskDetailData) {
  const { task } = data;
  const visitDate = task.scheduledDate || task.visitDate || null;
  const visitTime = task.scheduledTime || task.visitTime || null;
  return (
    <>
      <InfoLine label="تاريخ الزيارة" value={visitDate ? formatDate(visitDate) : '—'} />
      <InfoLine label="وقت الزيارة" value={visitTime || '—'} />
      <InfoLine label="نوع المهمة" value={
        task.taskType === 'device_delivery' ? 'تسليم جهاز' :
        task.taskType === 'device_installation' ? 'تركيب جهاز' :
        task.taskType === 'device_activation' ? 'تشغيل جهاز' : task.taskType
      } />
    </>
  );
}

function overviewIssuesFor(data: TaskDetailData) {
  const { task } = data;
  const issues: string[] = [];
  if (!task.priority) issues.push('الأولوية غير محددة');
  if (!task.contractId) issues.push('المهمة غير مرتبطة بعقد');
  if (!task.createdByName) issues.push('منشئ المهمة غير موجود');
  if (!task.dueDate && !task.expectedDate) issues.push('التاريخ المتوقع غير محدد');
  if (task.taskType === 'device_delivery' && task.status === 'completed' && !task.serialNumber) {
    issues.push('الرقم التسلسلي غير مسجل في النتيجة');
  }
  return issues;
}

function hasResultFor(data: TaskDetailData): boolean {
  const { task } = data;
  return Boolean(task.result || task.outcome || task.latestResult);
}

export default function DeliveryTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={Truck}
      typeIconColor="text-sky-500"
      backLabel="مهام التوصيل والتركيب"
      backHref="/tasks/delivery"
      extension={deliveryExtension}
      scheduleExtraRows={scheduleExtraRows}
      overviewIssuesFor={overviewIssuesFor}
      hasResultFor={hasResultFor}
      hideDueDate={true}
    />
  );
}
