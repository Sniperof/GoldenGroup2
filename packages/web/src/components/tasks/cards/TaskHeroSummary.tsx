import { CalendarDays, Repeat2, Sparkles } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { formatDate } from '../shared';
import { getDueDateStatus, getExpectedDateStatus } from '../../../lib/taskDateStatus';

const PRIORITY_LABELS: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

// Status → background gradient + ring color. Hero pill is the visual anchor for
// the entire Overview tab, so it needs to read at a glance from across the page.
const STATUS_THEME: Record<string, { gradient: string; ring: string; text: string }> = {
  open:              { gradient: 'from-sky-500 to-sky-600',         ring: 'ring-sky-200',     text: 'text-white' },
  needs_follow_up:   { gradient: 'from-amber-500 to-amber-600',     ring: 'ring-amber-200',   text: 'text-white' },
  assigned:          { gradient: 'from-violet-500 to-violet-600',   ring: 'ring-violet-200',  text: 'text-white' },
  in_scheduling:     { gradient: 'from-blue-500 to-blue-600',       ring: 'ring-blue-200',    text: 'text-white' },
  scheduled:         { gradient: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-200', text: 'text-white' },
  waiting_execution: { gradient: 'from-teal-500 to-teal-600',       ring: 'ring-teal-200',    text: 'text-white' },
  in_execution:      { gradient: 'from-indigo-500 to-indigo-600',   ring: 'ring-indigo-200',  text: 'text-white' },
  ended:             { gradient: 'from-cyan-500 to-cyan-600',       ring: 'ring-cyan-200',    text: 'text-white' },
  completed:         { gradient: 'from-green-500 to-green-600',     ring: 'ring-green-200',   text: 'text-white' },
  closed:            { gradient: 'from-slate-500 to-slate-600',     ring: 'ring-slate-200',   text: 'text-white' },
  cancelled:         { gradient: 'from-slate-400 to-slate-500',     ring: 'ring-slate-200',   text: 'text-white' },
};

const PRIORITY_THEME: Record<string, string> = {
  high:   'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-slate-100 text-slate-600 border-slate-200',
};

export interface TaskHeroSummaryProps {
  task: any;
}

export default function TaskHeroSummary({ task }: TaskHeroSummaryProps) {
  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as OpenTaskStatus] ?? task.status;
  const theme = STATUS_THEME[task.status] ?? STATUS_THEME.open;

  const priorityLabel = task.priority ? PRIORITY_LABELS[task.priority] ?? task.priority : 'غير محددة';
  const priorityClass = task.priority ? PRIORITY_THEME[task.priority] : 'bg-white text-slate-500 border-slate-200';

  // Attempts: prefer the new attemptsCount (post-diagnosis), fall back to legacy
  // open_tasks.attempt_count, then to lastAttempt presence as a final hint.
  const attemptsCount: number = Number(task.attemptsCount ?? task.attemptCount ?? 0);
  const attemptsTone =
    attemptsCount >= 5 ? 'bg-rose-50 text-rose-700 border-rose-200'
    : attemptsCount >= 3 ? 'bg-amber-50 text-amber-700 border-amber-200'
    : attemptsCount > 0 ? 'bg-slate-50 text-slate-700 border-slate-200'
    : 'bg-white text-slate-400 border-slate-200';

  const dateCounterReference = task.status === 'completed' ? (task.completedAt ?? task.updatedAt ?? null) : null;
  const dueStatus = task.dueDate ? getDueDateStatus(task.dueDate, dateCounterReference) : null;
  const expectedStatus = task.expectedDate ? getExpectedDateStatus(task.expectedDate, dateCounterReference) : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-bl from-white via-slate-50/50 to-white p-5 shadow-sm">
      {/* decorative accent — pulled into top-end corner */}
      <div className={`pointer-events-none absolute -top-10 -end-10 w-40 h-40 rounded-full bg-gradient-to-bl ${theme.gradient} opacity-10`} />

      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        {/* Status pill — the visual anchor */}
        <div className="flex items-center gap-3">
          <div className={`inline-flex items-center gap-2 rounded-2xl bg-gradient-to-bl ${theme.gradient} ${theme.text} px-4 py-2 shadow-md ring-4 ${theme.ring}`}>
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-black tracking-tight">{statusLabel}</span>
          </div>
          {task.lastWaitingStatus && task.lastWaitingStatus !== task.status && (
            <span className="text-xs text-slate-500">
              من قبل: {OPEN_TASK_STATUS_LABELS[task.lastWaitingStatus as OpenTaskStatus] ?? task.lastWaitingStatus}
            </span>
          )}
        </div>

        {/* Right side: priority + attempts as compact chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold ${priorityClass}`}>
            <span className="text-xs text-slate-400 font-bold">الأولوية</span>
            <span>{priorityLabel}</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold ${attemptsTone}`}>
            <Repeat2 className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-400 font-bold">محاولات</span>
            <span className="tabular-nums">{attemptsCount}</span>
          </div>
        </div>
      </div>

      {/* Date strip — required + expected, side by side, with status badges */}
      <div className="relative mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-400 tracking-wide">التاريخ المطلوب</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className={`text-sm font-bold ${dueStatus?.textClass ?? 'text-slate-700'}`}>
                {task.dueDate ? formatDate(task.dueDate) : '—'}
              </span>
              {dueStatus && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${dueStatus.badgeClass}`}>
                  {dueStatus.label}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-400 tracking-wide">المتابعة المتوقعة</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-sm font-bold text-slate-700">
                {task.expectedDate ? formatDate(task.expectedDate) : '—'}
              </span>
              {expectedStatus && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${expectedStatus.badgeClass}`}>
                  {expectedStatus.label}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
