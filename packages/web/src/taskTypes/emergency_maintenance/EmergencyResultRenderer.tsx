import type { TaskResultRendererProps } from '../../components/tasks/types';
import EmergencyResultWizard from '../../components/emergency/EmergencyResultWizard';

export default function EmergencyResultRenderer({ task }: TaskResultRendererProps) {
  const canRecord = !['completed', 'closed', 'cancelled'].includes(task.status);
  return (
    <EmergencyResultWizard
      taskId={task.id}
      contractId={task.contractId ?? null}
      readOnly={!canRecord}
    />
  );
}
