import { FileText } from 'lucide-react';
import { Card, InfoLine, formatDateTime } from '../shared';

// Mirror of DEC-004 D13 — the 7 canonical creation_origin values.
const CREATION_ORIGIN_LABELS: Record<string, string> = {
  branch_plan:                 'خطة الفرع',
  service_request_call:        'طلب خدمة (مكالمة)',
  telemarketing_inline_booking:'حجز من التيليماركتر',
  cascading_during_visit:      'مضافة أثناء الزيارة',
  manual_creation:             'إنشاء يدوي',
  emergency_request:           'طلب طوارئ',
  system_trigger:              'تلقائي (نظام)',
};

// Legacy `source` fallback for rows written before DEC-004 D13 rolled out.
const LEGACY_SOURCE_LABELS: Record<string, string> = {
  manual:           'يدوي',
  system:           'تلقائي',
  system_auto:      'تلقائي',
  telemarketing:    'تيليماركتر',
  follow_up_task:   'مهمة متابعة',
  emergency_ticket: 'طلب طوارئ',
};

function formatCreationOrigin(task: any): string {
  if (task?.creationOrigin) return CREATION_ORIGIN_LABELS[task.creationOrigin] ?? task.creationOrigin;
  if (task?.source) return LEGACY_SOURCE_LABELS[task.source] ?? task.source;
  return '—';
}

export default function TaskCreationCard({ task }: { task: any }) {
  return (
    <Card title="بيانات الإنشاء" icon={FileText} accent="slate">
      <div className="space-y-1.5">
        <InfoLine label="تاريخ الإنشاء" value={formatDateTime(task.createdAt)} />
        <InfoLine label="آخر تحديث" value={formatDateTime(task.updatedAt)} />
        <InfoLine label="منشئ المهمة" value={task.createdByName || '—'} />
        <InfoLine label="مصدر الإنشاء" value={formatCreationOrigin(task)} />
      </div>
    </Card>
  );
}
