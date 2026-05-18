import type { ComponentType } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { Card, InfoLine, TabAlert, formatDateTime } from '../shared';
import type { TaskResultRendererProps } from '../types';

export interface TaskResultTabProps {
  task: any;
  hasResult: boolean;
  /** Custom result renderer provided by the task type (e.g. device demo pre-offers table). */
  ResultRenderer?: ComponentType<TaskResultRendererProps>;
  /** Extra data forwarded to the custom renderer */
  rendererProps?: Partial<TaskResultRendererProps>;
}

export default function TaskResultTab({ task, hasResult, ResultRenderer, rendererProps }: TaskResultTabProps) {
  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as OpenTaskStatus] ?? task.status;

  return (
    <>
      <TabAlert title="ملاحظات على النتيجة" items={hasResult ? [] : ['لا توجد نتيجة مسجلة بعد']} />
      <Card title="ملخص النتيجة" icon={CheckCircle2}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine label="النتيجة" value={task.outcome || task.result || 'غير مسجلة بعد'} />
          <InfoLine label="الحالة" value={statusLabel} />
          <InfoLine label="تاريخ الإتمام" value={task.completedAt ? formatDateTime(task.completedAt) : '—'} />
          {task.cancellationReason && (
            <InfoLine
              label="سبب الإلغاء"
              value={<span className="text-rose-700">{task.cancellationReason}</span>}
            />
          )}
          {task.noClosingReason && (
            <InfoLine label="سبب عدم الإغلاق" value={task.noClosingReason} />
          )}
          {task.resultNotes && (
            <div className="md:col-span-2">
              <InfoLine label="ملاحظات النتيجة" value={task.resultNotes} />
            </div>
          )}
        </div>
      </Card>

      {ResultRenderer && <ResultRenderer task={task} {...rendererProps} />}
    </>
  );
}
