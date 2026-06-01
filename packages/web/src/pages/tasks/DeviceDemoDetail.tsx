import { useParams } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import DeviceDemoOfferTab from '../../taskTypes/device_demo/DeviceDemoOfferTab';
import DeviceDemoResultRenderer from '../../taskTypes/device_demo/DeviceDemoResultRenderer';
import type { TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';

const deviceDemoExtension: TaskTypeExtension = {
  // No extra cards in overview — base summary covers everything except visit date/time
  // which we inject as schedule extra rows below.
  extraTabs: [
    {
      id: 'offer',
      label: 'تفاصيل العرض',
      render: (data) => <DeviceDemoOfferTab data={data} />,
    },
  ],
  ResultRenderer: DeviceDemoResultRenderer,
};

function scheduleExtraRows(data: TaskDetailData) {
  const { task } = data;
  const visitDate = task.scheduledDate || task.visitDate || null;
  const visitTime = task.scheduledTime || task.visitTime || null;
  return (
    <>
      <InfoLine label="تاريخ الزيارة" value={visitDate ? formatDate(visitDate) : '—'} />
      <InfoLine label="وقت الزيارة" value={visitTime || '—'} />
    </>
  );
}

function overviewIssuesFor(data: TaskDetailData): string[] {
  const { task } = data;
  const issues: string[] = [];
  if (!task.createdByName) issues.push('منشئ المهمة غير موجود أو ناقص');
  if (!task.source) issues.push('مصدر الإنشاء غير محدد');
  if (!task.dueDate) issues.push('التاريخ المطلوب غير محدد');
  const visitDate = task.scheduledDate || task.visitDate;
  if (!visitDate && !task.marketingVisitId) issues.push('تفاصيل الزيارة غير مرتبطة بعد');
  if (!task.priority) issues.push('الأولوية غير محددة');
  return issues;
}

function hasResultFor(data: TaskDetailData): boolean {
  const { task, preOffers } = data;
  return Boolean(
    task.result ||
    task.outcome ||
    preOffers.length > 0 ||
    (Array.isArray(task.offers) && task.offers.length > 0)
  );
}

export default function DeviceDemoDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={Monitor}
      typeIconColor="text-indigo-500"
      backLabel="عروض الأجهزة"
      backHref="/tasks/device-demo"
      extension={deviceDemoExtension}
      scheduleExtraRows={scheduleExtraRows}
      overviewIssuesFor={overviewIssuesFor}
      hasResultFor={hasResultFor}
    />
  );
}
