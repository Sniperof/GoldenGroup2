import type { ApplicationStage, ApplicationStatus, Decision, StageStatus } from './types';

interface UnifiedStateInput {
  currentStage: ApplicationStage;
  applicationStatus: ApplicationStatus;
  stageStatus?: StageStatus | null;
  decision?: Decision | null;
  hasScheduledInterview?: boolean;
}

export interface UnifiedApplicationState {
  label: string;
  tone: 'default' | 'info' | 'warning' | 'success' | 'danger' | 'muted';
}

export function getUnifiedApplicationState(input: UnifiedStateInput): UnifiedApplicationState {
  const {
    currentStage,
    applicationStatus,
    stageStatus,
    decision,
    hasScheduledInterview = false,
  } = input;

  if (applicationStatus === 'Retreated' || decision === 'Retreated') {
    return { label: 'منسحب', tone: 'muted' };
  }

  if (
    applicationStatus === 'Rejected' ||
    applicationStatus === 'Interview Failed' ||
    applicationStatus === 'Final Rejected' ||
    decision === 'Rejected' ||
    decision === 'Failed'
  ) {
    return { label: 'مرفوض', tone: 'danger' };
  }

  if (applicationStatus === 'Final Hired' || decision === 'Hired') {
    return { label: 'مقبول', tone: 'success' };
  }

  switch (currentStage) {
    case 'Submitted':
      return { label: 'جديد', tone: 'info' };

    case 'Shortlisted':
      return { label: 'مؤهل', tone: 'success' };

    case 'Interview':
      if (applicationStatus === 'Interview Completed' || stageStatus === 'Completed') {
        return { label: 'مكتملة', tone: 'success' };
      }
      if (hasScheduledInterview) {
        return { label: 'مجدولة', tone: 'warning' };
      }
      return { label: 'بانتظار الجدولة', tone: 'warning' };

    case 'Training':
      if (applicationStatus === 'Training Started' || stageStatus === 'In Progress') {
        return { label: 'قيد التدريب', tone: 'info' };
      }
      if (applicationStatus === 'Training Completed' || stageStatus === 'Completed') {
        return { label: 'اكتمل التدريب', tone: 'success' };
      }
      if (applicationStatus === 'Training Scheduled' || stageStatus === 'Scheduled') {
        return { label: 'مجدولة', tone: 'warning' };
      }
      return { label: 'بانتظار الجدولة', tone: 'warning' };

    case 'Final Decision':
      return { label: 'بانتظار القرار', tone: 'default' };

    default:
      return { label: applicationStatus, tone: 'default' };
  }
}

export function getUnifiedApplicationStateClasses(tone: UnifiedApplicationState['tone']): string {
  switch (tone) {
    case 'info':
      return 'bg-sky-50 text-sky-700';
    case 'warning':
      return 'bg-amber-50 text-amber-700';
    case 'success':
      return 'bg-emerald-50 text-emerald-700';
    case 'danger':
      return 'bg-rose-50 text-rose-700';
    case 'muted':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-violet-50 text-violet-700';
  }
}

export function getUnifiedApplicationStateDotClasses(tone: UnifiedApplicationState['tone']): string {
  switch (tone) {
    case 'info':
      return 'bg-sky-400';
    case 'warning':
      return 'bg-amber-400';
    case 'success':
      return 'bg-emerald-400';
    case 'danger':
      return 'bg-rose-400';
    case 'muted':
      return 'bg-slate-400';
    default:
      return 'bg-violet-400';
  }
}
