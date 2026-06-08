import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Zap } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import type { TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';
import EmergencyDetailsTab from '../../taskTypes/emergency_maintenance/EmergencyDetailsTab';
import EmergencyResultRenderer from '../../taskTypes/emergency_maintenance/EmergencyResultRenderer';
import MaintenanceReceiptModal from '../../components/emergency/MaintenanceReceiptModal';

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
      <button
        type="button"
        onClick={() => setShowReceipt(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100 transition-colors"
      >
        <FileText className="h-4 w-4" />
        وصل الصيانة
      </button>
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
