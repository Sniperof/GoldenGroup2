import type { ReactNode } from 'react';
import { TabAlert } from '../shared';
import TaskHeroSummary from '../cards/TaskHeroSummary';
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
  scheduleExtraRows,
  issues = [],
  extraCards,
}: TaskOverviewTabProps) {
  return (
    <div className="space-y-5">
      <TabAlert title="ملاحظات على بيانات النظرة العامة" items={issues} />

      {/* Hero: status + priority + attempts + dates — the visual anchor */}
      <TaskHeroSummary task={task} />

      {/* Two-column responsive grid; cards stack vertically on mobile, 2×2 on md+ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TaskSummaryCard
          task={task}
          priorityDraft={priorityDraft}
          prioritySaving={prioritySaving}
          priorityError={priorityError}
          onPriorityChange={onPriorityChange}
        />
        <TaskScheduleCard
          task={task}
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
    </div>
  );
}
