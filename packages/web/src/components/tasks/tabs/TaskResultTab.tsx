import { useState, type ComponentType } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { Card, InfoLine, TabAlert, formatDateTime } from '../shared';
import type { TaskResultRendererProps } from '../types';
import DeviceDemoResultModal from '../../../taskTypes/device_demo/DeviceDemoResultModal';

// Arabic labels for the unified final_decision values (device_demo first;
// other task types extend this map as they migrate to the new model).
// Reference: docs/constitution/features/tasks/device-demo.md
const FINAL_DECISION_LABELS: Record<string, { label: string; cls: string }> = {
  offer_presented: { label: 'تقديم عرض',   cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  device_sold:     { label: 'تم البيع',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rescheduled:     { label: 'إعادة جدولة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled:       { label: 'إلغاء',       cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  // legacy values kept for read-back of historical rows
  accepted:        { label: 'مقبول (قديم)',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:        { label: 'مرفوض (قديم)',   cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  needs_followup:  { label: 'متابعة (قديم)',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function renderFinalDecision(value?: string | null) {
  if (!value) return 'غير مسجلة بعد';
  const meta = FINAL_DECISION_LABELS[value];
  if (!meta) return <span className="font-mono text-xs">{value}</span>;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

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
  const [showResultModal, setShowResultModal] = useState(false);

  // Final decision lives on the visit_task_result row, surfaced as latestFinalDecision.
  // Fall back to outcome/result for legacy rows.
  const finalDecision: string | null = task.latestFinalDecision ?? task.outcome ?? task.result ?? null;

  // Result modal is only wired for device_demo today; other task types still
  // surface a read-only result block until they migrate to the new model.
  const canRecordResult =
    task.taskType === 'device_demo' &&
    task.marketingVisitId != null &&
    task.latestVisitTaskId != null &&
    !['completed', 'closed', 'cancelled'].includes(task.status);

  return (
    <>
      <TabAlert title="ملاحظات على النتيجة" items={hasResult ? [] : ['لا توجد نتيجة مسجلة بعد']} />

      {canRecordResult && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowResultModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            تسجيل نتيجة الزيارة
          </button>
        </div>
      )}

      <Card title="ملخص النتيجة" icon={CheckCircle2}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine label="النتيجة" value={renderFinalDecision(finalDecision)} />
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

      {showResultModal && canRecordResult && (
        <DeviceDemoResultModal
          visitId={Number(task.marketingVisitId)}
          taskId={Number(task.latestVisitTaskId)}
          onClose={() => setShowResultModal(false)}
          onSaved={() => {
            setShowResultModal(false);
            // Trigger reload by reloading the page — simplest and most reliable
            // until we add a refresh callback through TaskDetailLayout.
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
