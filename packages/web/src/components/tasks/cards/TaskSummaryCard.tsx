import { Activity } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { Card, InfoLine, formatDateTime } from '../shared';
import Select from '../../ui/Select';

const PRIORITY_LABELS: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

// Mirror of the DB CHECK on open_tasks.reason — 5 closed values.
const REASON_LABELS: Record<string, string> = {
  new_lead:        'زبون جديد',
  follow_up:       'متابعة',
  renewal:         'تجديد',
  service_request: 'طلب خدمة',
  other:           'أخرى',
};
const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-slate-100 text-slate-600 border-slate-200',
};

export interface TaskSummaryCardProps {
  task: any;
  /** Inline priority editor — provided by the parent */
  priorityDraft: '' | 'high' | 'medium' | 'low';
  prioritySaving: boolean;
  priorityError: string;
  onPriorityChange: (next: '' | 'high' | 'medium' | 'low') => void;
}

export default function TaskSummaryCard({ task, priorityDraft, prioritySaving, priorityError, onPriorityChange }: TaskSummaryCardProps) {
  // Status and attempt count are surfaced in the Hero banner above, so this
  // card focuses on the editable + ancillary details: priority editor, reason,
  // waiting context, last attempt timestamp, and cancellation reason.
  return (
    <Card title="تفاصيل المهمة" icon={Activity} accent="indigo">
      <div className="space-y-1.5">
        <div className="flex items-start justify-between py-1.5 gap-4">
          <span className="text-xs text-slate-400 font-bold shrink-0">الأولوية</span>
          <div className="flex flex-col items-end gap-1">
            <Select<'' | 'high' | 'medium' | 'low'>
              value={priorityDraft}
              onChange={onPriorityChange}
              disabled={prioritySaving}
              placeholder="غير محددة"
              ariaLabel="الأولوية"
              size="sm"
              className="min-w-36"
              options={[
                { value: 'high', label: PRIORITY_LABELS.high },
                { value: 'medium', label: PRIORITY_LABELS.medium },
                { value: 'low', label: PRIORITY_LABELS.low },
              ]}
            />
            {prioritySaving && <span className="text-[11px] text-slate-400">جارٍ الحفظ...</span>}
            {priorityError && <span className="text-[11px] text-rose-600">{priorityError}</span>}
          </div>
        </div>
        <InfoLine label="السبب" value={task.reason ? (REASON_LABELS[task.reason] ?? task.reason) : '—'} />
        {task.waitingReasonText && (
          <InfoLine
            label="سبب الانتظار"
            value={
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-xs font-medium">
                {task.waitingReasonText}
              </span>
            }
          />
        )}
        {task.lastAttemptAt && <InfoLine label="آخر تحديث على محاولة" value={formatDateTime(task.lastAttemptAt)} />}
        {task.lastWaitingStatus && task.lastWaitingStatus !== task.status && (
          <InfoLine
            label="آخر حالة انتظار"
            value={<span className="text-xs text-slate-500">{OPEN_TASK_STATUS_LABELS[task.lastWaitingStatus as OpenTaskStatus] ?? task.lastWaitingStatus}</span>}
          />
        )}
        {task.cancellationReason && (
          <InfoLine
            label="سبب الإلغاء"
            value={<span className="text-sm text-rose-700">{task.cancellationReason}</span>}
          />
        )}
      </div>
    </Card>
  );
}
