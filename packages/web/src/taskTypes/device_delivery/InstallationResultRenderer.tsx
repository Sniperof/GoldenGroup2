import type { TaskResultRendererProps } from '../../components/tasks/types';
import InstallationResultForm from './InstallationResultForm';

export default function InstallationResultRenderer({ task }: TaskResultRendererProps) {
  const canRecord = !['completed', 'closed', 'cancelled'].includes(task.status);
  return (
    <InstallationResultForm
      taskId={task.id}
      readOnly={!canRecord}
    />
  );
}
