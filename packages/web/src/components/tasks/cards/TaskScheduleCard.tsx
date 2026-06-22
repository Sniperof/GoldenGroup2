import { Calendar } from 'lucide-react';
import { Card, InfoLine, formatDate } from '../shared';
import { getExpectedDateStatus } from '../../../lib/taskDateStatus';

export interface TaskScheduleCardProps {
  task: any;
  /** Optional extra rows (e.g., visit date/time for device_demo) */
  extraRows?: React.ReactNode;
}

// Constitution: docs/constitution/components/task-detail-page.md §3.1 —
// due_date and expected_date are READ-ONLY everywhere on the detail page. They
// move only through the task lifecycle (booking / reflection), never by hand.
export default function TaskScheduleCard({ task, extraRows }: TaskScheduleCardProps) {
  const dateCounterReference = task.status === 'completed' ? (task.completedAt ?? task.updatedAt ?? null) : null;
  const expectedStatus = task.expectedDate ? getExpectedDateStatus(task.expectedDate, dateCounterReference) : null;

  return (
    <Card title="الجدولة" icon={Calendar} accent="emerald">
      <div className="space-y-1.5">
        {/* dueDate is rendered in the Hero banner; both dates are read-only. */}
        <div className="flex items-start justify-between py-1.5 gap-4">
          <span className="text-xs text-slate-400 font-bold shrink-0 pt-1.5">التاريخ المتوقع</span>
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-bold text-slate-700">
              {task.expectedDate ? formatDate(task.expectedDate) : '—'}
            </span>
            {expectedStatus && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${expectedStatus.badgeClass}`}>
                {expectedStatus.label}
              </span>
            )}
          </div>
        </div>

        {extraRows}

        <InfoLine label="الفرع" value={task.branchName || '—'} />
      </div>
    </Card>
  );
}
