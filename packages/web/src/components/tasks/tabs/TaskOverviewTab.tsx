import type { ReactNode } from 'react';
import { TabAlert } from '../shared';
import TaskSummaryCard from '../cards/TaskSummaryCard';
import TaskScheduleCard from '../cards/TaskScheduleCard';
import TaskCreationCard from '../cards/TaskCreationCard';
import TaskQuickStatsCard from '../cards/TaskQuickStatsCard';

export interface TaskOverviewTabProps {
  task: any;
  // Counts (passed in from parent which already has the lists)
  deviceCount: number;
  callCount: number;
  activityCount: number;
  noteCount: number;
  // Priority editor
  priorityDraft: '' | 'high' | 'medium' | 'low';
  prioritySaving: boolean;
  priorityError: string;
  onPriorityChange: (next: '' | 'high' | 'medium' | 'low') => void;
  // Expected date editor
  expectedDateDraft: string;
  expectedDateSaving: boolean;
  expectedDateError: string;
  onExpectedDateDraftChange: (value: string) => void;
  onExpectedDateBlur: (value: string) => void;
  // Schedule card extras (task-type-specific rows like visit date/time)
  scheduleExtraRows?: ReactNode;
  // Issues list rendered at top
  issues?: string[];
  // Extension slot: extra cards appended below the 4 base cards
  extraCards?: ReactNode;
}

export default function TaskOverviewTab({
  task,
  deviceCount, callCount, activityCount, noteCount,
  priorityDraft, prioritySaving, priorityError, onPriorityChange,
  expectedDateDraft, expectedDateSaving, expectedDateError,
  onExpectedDateDraftChange, onExpectedDateBlur,
  scheduleExtraRows,
  issues = [],
  extraCards,
}: TaskOverviewTabProps) {
  return (
    <>
      <TabAlert title="ملاحظات على بيانات النظرة العامة" items={issues} />
      <div className="grid grid-cols-1 gap-4">
        <TaskSummaryCard
          task={task}
          priorityDraft={priorityDraft}
          prioritySaving={prioritySaving}
          priorityError={priorityError}
          onPriorityChange={onPriorityChange}
        />
        <TaskScheduleCard
          task={task}
          expectedDateDraft={expectedDateDraft}
          expectedDateSaving={expectedDateSaving}
          expectedDateError={expectedDateError}
          onExpectedDateDraftChange={onExpectedDateDraftChange}
          onExpectedDateBlur={onExpectedDateBlur}
          extraRows={scheduleExtraRows}
        />
        <TaskCreationCard task={task} />
        <TaskQuickStatsCard
          deviceCount={deviceCount}
          callCount={callCount}
          activityCount={activityCount}
          noteCount={noteCount}
        />
      </div>
      {extraCards}
    </>
  );
}
