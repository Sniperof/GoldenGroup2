import { FileText } from 'lucide-react';
import { Card, InfoLine, formatDateTime } from '../shared';

const SOURCE_LABELS: Record<string, string> = {
  manual: 'يدوي',
  system: 'تلقائي',
  system_auto: 'تلقائي',
  telemarketing: 'يدوي',
  follow_up_task: 'مهمة متابعة',
  emergency_ticket: 'طلب طوارئ',
};

function formatSource(source: string | null | undefined) {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source;
}

export default function TaskCreationCard({ task }: { task: any }) {
  return (
    <Card title="بيانات الإنشاء" icon={FileText}>
      <div className="space-y-1.5">
        <InfoLine label="تاريخ الإنشاء" value={formatDateTime(task.createdAt)} />
        <InfoLine label="آخر تحديث" value={formatDateTime(task.updatedAt)} />
        <InfoLine label="منشئ المهمة" value={task.createdByName || '—'} />
        <InfoLine label="مصدر الإنشاء" value={formatSource(task.source)} />
      </div>
    </Card>
  );
}
