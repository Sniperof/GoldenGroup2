import { Calendar } from 'lucide-react';
import { Card, InfoLine } from '../shared';
import { getExpectedDateStatus } from '../../../lib/taskDateStatus';

export interface TaskScheduleCardProps {
  task: any;
  /** Inline expected_date editor */
  expectedDateDraft: string;
  expectedDateSaving: boolean;
  expectedDateError: string;
  onExpectedDateDraftChange: (value: string) => void;
  onExpectedDateBlur: (value: string) => void;
  /** Optional extra rows (e.g., visit date/time for device_demo) */
  extraRows?: React.ReactNode;
}

export default function TaskScheduleCard({
  task,
  expectedDateDraft, expectedDateSaving, expectedDateError,
  onExpectedDateDraftChange, onExpectedDateBlur,
  extraRows,
}: TaskScheduleCardProps) {
  const dateCounterReference = task.status === 'completed' ? (task.completedAt ?? task.updatedAt ?? null) : null;

  return (
    <Card title="الجدولة" icon={Calendar} accent="emerald">
      <div className="space-y-1.5">
        {/* dueDate is rendered in the Hero banner; the Schedule card focuses
            on the editable expected_date and task-type-specific extras. */}
        <div className="flex items-start justify-between py-1.5 gap-4">
          <span className="text-xs text-slate-400 font-bold shrink-0 pt-1.5">التاريخ المتوقع</span>
          <div className="flex flex-col items-end gap-1">
            <input
              type="date"
              value={expectedDateDraft}
              onChange={(e) => onExpectedDateDraftChange(e.target.value)}
              onBlur={(e) => onExpectedDateBlur(e.target.value)}
              disabled={expectedDateSaving}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 disabled:opacity-50 transition-colors"
              dir="ltr"
            />
            {(() => {
              const dateForStatus = expectedDateDraft || task.expectedDate;
              if (!dateForStatus) return null;
              const s = getExpectedDateStatus(dateForStatus, dateCounterReference);
              if (!s) return null;
              return (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${s.badgeClass}`}>
                  {s.label}
                </span>
              );
            })()}
            {expectedDateSaving && <span className="text-[11px] text-slate-400">جارٍ الحفظ...</span>}
            {expectedDateError && <span className="text-[11px] text-rose-600">{expectedDateError}</span>}
          </div>
        </div>

        {extraRows}

        <InfoLine label="الفرع" value={task.branchName || '—'} />
      </div>
    </Card>
  );
}
