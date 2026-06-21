import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Zap } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import type { TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';
import EmergencyDetailsTab from '../../taskTypes/emergency_maintenance/EmergencyDetailsTab';
import EmergencyResultRenderer from '../../taskTypes/emergency_maintenance/EmergencyResultRenderer';
import MaintenanceReceiptModal from '../../components/emergency/MaintenanceReceiptModal';
import Button from '../../components/ui/Button';

function overviewIssuesFor(data: TaskDetailData): string[] {
  const { task } = data;
  const issues: string[] = [];
  if (!task.priority)     issues.push('الأولوية غير محددة');
  if (!task.contractId)   issues.push('المهمة غير مرتبطة بعقد');
  if (!task.createdByName) issues.push('منشئ المهمة غير موجود');
  return issues;
}

function hasResultFor(data: TaskDetailData): boolean {
  return Boolean(data.task.em_costs_id);
}

export default function EmergencyTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const [showReceipt, setShowReceipt] = useState(false);

  const emergencyExtension: TaskTypeExtension = {
    extraTabs: [
      {
        id: 'emergency',
        label: 'تفاصيل الطوارئ',
        render: (data: TaskDetailData) => <EmergencyDetailsTab data={data} />,
      },
    ],
    ResultRenderer: EmergencyResultRenderer,
    tabBarActions: () => (
      <Button
        variant="secondary"
        size="sm"
        icon={FileText}
        onClick={() => setShowReceipt(true)}
        className="border-rose-200 text-rose-700 hover:bg-rose-100"
      >
        وصل الصيانة
      </Button>
    ),
  };

  return (
    <>
      <TaskDetailLayout
        taskId={taskId}
        typeIcon={Zap}
        typeIconColor="text-rose-500"
        backLabel="مهام الصيانة الطارئة"
        backHref="/tasks/emergency"
        extension={emergencyExtension}
        overviewIssuesFor={overviewIssuesFor}
        hasResultFor={hasResultFor}
      />
      {showReceipt && (
        <MaintenanceReceiptModal
          taskId={taskId}
          isOpen={showReceipt}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </>
  );
}
