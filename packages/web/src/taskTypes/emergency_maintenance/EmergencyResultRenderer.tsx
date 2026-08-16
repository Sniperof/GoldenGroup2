import type { TaskResultRendererProps } from '../../components/tasks/types';
import EmergencyResultWizard from '../../components/emergency/EmergencyResultWizard';

export default function EmergencyResultRenderer({ task }: TaskResultRendererProps) {
  const maintenanceKind = task.taskType === 'periodic_maintenance' ? 'periodic' : 'emergency';
  return (
    <EmergencyResultWizard
      taskId={task.id}
      contractId={task.contractId ?? null}
      maintenanceKind={maintenanceKind}
      readOnly
    />
  );
}
