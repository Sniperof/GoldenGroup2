import { Activity } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { Card, InfoLine, formatDateTime } from '../shared';

const PRIORITY_LABELS: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border-sky-200',
  needs_follow_up: 'bg-amber-50 text-amber-700 border-amber-200',
  assigned: 'bg-violet-50 text-violet-700 border-violet-200',
  in_scheduling: 'bg-blue-50 text-blue-700 border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  waiting_execution: 'bg-teal-50 text-teal-700 border-teal-200',
  in_execution: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ended: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  completed: 'bg-green-50 text-green-700 border-green-100',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
  cancelled: 'bg-slate-200 text-slate-600 border-slate-300',
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
  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as OpenTaskStatus] ?? task.status;
  const statusColor = TASK_STATUS_COLORS[task.status] ?? 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <Card title="ملخص المهمة" icon={Activity}>
      <div className="space-y-1.5">
        <InfoLine
          label="الحالة"
          value={<span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${statusColor}`}>{statusLabel}</span>}
        />
        <div className="flex items-start justify-between py-1.5 gap-4">
          <span className="text-xs text-slate-400 font-bold shrink-0">الأولوية</span>
          <div className="flex flex-col items-end gap-1">
            <select
              value={priorityDraft}
              onChange={(e) => onPriorityChange(e.target.value as '' | 'high' | 'medium' | 'low')}
              disabled={prioritySaving}
              className={`min-w-36 rounded-lg border px-2.5 py-1.5 text-xs font-bold outline-none transition-colors ${priorityDraft ? (PRIORITY_COLORS[priorityDraft] ?? 'bg-slate-100 text-slate-600 border-slate-200') : 'bg-white text-slate-500 border-slate-200'}`}
            >
              <option value="">غير محددة</option>
              <option value="high">{PRIORITY_LABELS.high}</option>
              <option value="medium">{PRIORITY_LABELS.medium}</option>
              <option value="low">{PRIORITY_LABELS.low}</option>
            </select>
            {prioritySaving && <span className="text-[11px] text-slate-400">جارٍ الحفظ...</span>}
            {priorityError && <span className="text-[11px] text-rose-600">{priorityError}</span>}
          </div>
        </div>
        <InfoLine label="السبب" value={task.reason || '—'} />
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
        <InfoLine
          label="عدد المحاولات"
          value={
            <span className={`inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full font-bold text-xs ${task.attemptCount >= 5 ? 'bg-rose-100 text-rose-700' : task.attemptCount >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
              {task.attemptCount ?? 0}
            </span>
          }
        />
        {task.lastAttemptAt && <InfoLine label="آخر محاولة" value={formatDateTime(task.lastAttemptAt)} />}
        {task.lastWaitingStatus && (
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
