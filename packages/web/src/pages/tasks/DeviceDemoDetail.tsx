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

// Schedule extra rows reflect the open_task lifecycle, not "any past visit".
// - An active booking (scheduled / in_progress / ended without result) renders
//   as "موعد الزيارة القادمة" — the user is being told about an upcoming event.
// - Otherwise, if a past attempt exists, render it as "آخر محاولة" — strictly
//   historical, never confused with an upcoming visit.
// - With no booking and no past attempt, no row is rendered at all.
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
  if (!task.source) issues.push('مصدر الإنشاء غير محدد');
  if (!task.dueDate) issues.push('التاريخ المطلوب غير محدد');
  // A task in 'scheduled' state must carry a live booking — otherwise the
  // status and the data have drifted apart (e.g., visit cancelled but the
  // open_task was not rolled back to its last_waiting_status).
  if (task.status === 'scheduled' && !task.activeVisit) {
    issues.push('المهمة بحالة "مجدولة" بلا زيارة نشطة مرتبطة');
  }
  if (!task.priority) issues.push('الأولوية غير محددة');
  return issues;
}

// The open_task itself has a "final result" only in terminal states. While
// the story is alive (open / needs_follow_up / scheduled / in_progress), past
// attempt results do not count as "the task's result" — the alert must
// remain visible so the user knows further action is expected.
function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
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
