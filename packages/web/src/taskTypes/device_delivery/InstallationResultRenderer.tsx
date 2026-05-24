import type { TaskResultRendererProps } from '../../components/tasks/types';

export default function InstallationResultRenderer({ task: _task }: TaskResultRendererProps) {
  return <div className="text-slate-400 text-sm p-4">نتيجة التركيب غير متوفرة</div>;
}
