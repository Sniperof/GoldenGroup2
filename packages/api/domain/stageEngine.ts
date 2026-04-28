import type { ApplicationStage } from '@golden-crm/shared';

export type { ApplicationStage };

export const STAGE_ORDER = [
  'Submitted',
  'Shortlisted',
  'Interview',
  'Training',
  'Final Decision',
] as const satisfies readonly ApplicationStage[];

// ── Terminal decisions — no further actions allowed ─�
export const TERMINAL_DECISIONS = ['Rejected', 'Failed', 'Hired', 'Retreated'];

export function isTerminalDecision(decision: string | null): boolean {
  return decision != null && TERMINAL_DECISIONS.includes(decision);
}

// Backward compat — old code still references these
export const TERMINAL_STATUSES = [
  'Rejected', 'Interview Failed', 'Final Hired', 'Final Rejected', 'Retreated',
];
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Returns true if the given stage is exclusively managed by the training module.
 */
export function isTrainingManagedStage(stage: string): boolean {
  return stage === 'Training';
}

/**
 * Returns true if the transition is an interview result change that must go
 * exclusively through the interview module (POST /result), not the stage endpoint.
 */
export function isInterviewManagedTransition(
  stage: string,
  currentStatus: string,
  newStatus: string,
): boolean {
  return (
    stage === 'Interview' &&
    currentStatus === 'Interview Scheduled' &&
    (newStatus === 'Interview Completed' || newStatus === 'Interview Failed')
  );
}

// ════════════════════════════════════════════════════════════
// Stage-status transitions (automated / operational)
// ════════════════════════════════════════════════════════════

// Valid automated stage_status transitions per stage
const VALID_STAGE_STATUS_TRANSITIONS: Record<string, Record<string, string[]>> = {
  Submitted:       { Pending: ['Under Review'] },
  Shortlisted:     {}, // no internal transitions — enters as 'Ready'
  Interview:       { Scheduled: ['Completed'] },
  Training:        { Scheduled: ['In Progress'], 'In Progress': ['Completed'] },
  'Final Decision': {}, // no internal transitions — enters as 'Awaiting Decision'
};

export function validateStageStatusTransition(
  stage: string,
  currentStageStatus: string,
  newStageStatus: string,
): string | null {
  const stageMap = VALID_STAGE_STATUS_TRANSITIONS[stage];
  if (!stageMap) return `مرحلة غير معروفة: ${stage}`;
  const allowed = stageMap[currentStageStatus];
  if (!allowed || !allowed.includes(newStageStatus)) {
    return `انتقال حالة تشغيلية غير صالح: ${stage}/${currentStageStatus} → ${newStageStatus}`;
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// Decision validation (HR / manual)
// ════════════════════════════════════════════════════════════

// Which decisions are allowed at each stage + stage_status
const VALID_DECISIONS: Record<string, Record<string, string[]>> = {
  Submitted: {
    'Under Review': ['Qualified', 'Rejected', 'Retreated'],
  },
  Shortlisted: {
    Ready: ['Rejected', 'Retreated'],
  },
  Interview: {
    Completed: ['Approved', 'Failed', 'Retreated'],
  },
  Training: {
    Ready:       ['Retreated'],
    Scheduled:   ['Retreated'],
    'In Progress': ['Retreated'],
    Completed:   ['Passed', 'Retraining', 'Rejected', 'Retreated'],
  },
  'Final Decision': {
    'Awaiting Decision': ['Hired', 'Rejected', 'Retreated'],
  },
};

export interface DecisionOptions {
  retrainingCount?: number;
  maxRetrainingCount?: number;
}

export function validateDecision(
  stage: string,
  stageStatus: string,
  decision: string,
  currentDecision: string | null,
  options?: DecisionOptions,
): string | null {
  // Cannot make a new decision if already terminal
  if (isTerminalDecision(currentDecision)) {
    return `لا يمكن اتخاذ قرار جديد — القرار الحالي نهائي: ${currentDecision}`;
  }

  const stageMap = VALID_DECISIONS[stage];
  if (!stageMap) return `مرحلة غير معروفة: ${stage}`;
  const allowed = stageMap[stageStatus];
  if (!allowed || !allowed.includes(decision)) {
    return `قرار غير صالح "${decision}" في ${stage}/${stageStatus}`;
  }

  // Retraining limit
  if (decision === 'Retraining' && options) {
    const count = options.retrainingCount ?? 0;
    const max = options.maxRetrainingCount ?? 1;
    if (count >= max) {
      return `تم استنفاد الحد الأقصى لإعادة التدريب (${max})`;
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// Decision effects — what happens to stage/stageStatus after a decision
// ════════════════════════════════════════════════════════════

export interface DecisionEffect {
  newStage: string;
  newStageStatus: string;
}

export function getDecisionEffect(currentStage: string, decision: string): DecisionEffect {
  switch (decision) {
    case 'Qualified':
      return { newStage: 'Shortlisted', newStageStatus: 'Ready' };
    case 'Approved':
      return { newStage: 'Training', newStageStatus: 'Ready' };
    case 'Passed':
      return { newStage: 'Final Decision', newStageStatus: 'Awaiting Decision' };
    case 'Retraining':
      return { newStage: 'Training', newStageStatus: 'Ready' };
    case 'Hired':
    case 'Rejected':
    case 'Failed':
    case 'Retreated':
      // Terminal decisions — stage stays the same, stageStatus stays the same
      return { newStage: currentStage, newStageStatus: 'current' }; // 'current' = don't change
    default:
      return { newStage: currentStage, newStageStatus: 'current' };
  }
}

// ════════════════════════════════════════════════════════════
// Backward compatibility: derive old application_status
// ════════════════════════════════════════════════════════════

export function deriveApplicationStatus(
  stage: string,
  stageStatus: string,
  decision: string | null,
): string {
  if (decision === 'Retreated') return 'Retreated';

  switch (stage) {
    case 'Submitted':
      if (decision === 'Qualified') return 'Qualified';
      if (decision === 'Rejected') return 'Rejected';
      if (stageStatus === 'Under Review') return 'In Review';
      return 'New';
    case 'Shortlisted':
      if (decision === 'Rejected') return 'Rejected';
      return 'Qualified';
    case 'Interview':
      if (decision === 'Failed') return 'Interview Failed';
      if (stageStatus === 'Completed') return 'Interview Completed';
      return 'Interview Scheduled';
    case 'Training':
      if (decision === 'Approved') return 'Approved';
      if (decision === 'Retraining') return 'Retraining';
      if (decision === 'Rejected') return 'Rejected';
      if (stageStatus === 'Completed') return 'Training Completed';
      if (stageStatus === 'In Progress') return 'Training Started';
      if (stageStatus === 'Scheduled') return 'Training Scheduled';
      return 'Approved';
    case 'Final Decision':
      if (decision === 'Hired') return 'Final Hired';
      if (decision === 'Rejected') return 'Final Rejected';
      return 'Passed';
    default:
      return 'New';
  }
}

// ════════════════════════════════════════════════════════════
// Legacy: validateStageTransition (for backward compat with old endpoint)
// ════════════════════════════════════════════════════════════

export interface StageTransitionOptions {
  retrainingCount?: number;
  maxRetrainingCount?: number;
}

const VALID_TRANSITIONS = new Set([
  'Submitted:New:Submitted:In Review',
  'Submitted:In Review:Shortlisted:Qualified',
  'Submitted:In Review:Submitted:Rejected',
  'Shortlisted:Qualified:Interview:Interview Scheduled',
  'Shortlisted:Qualified:Shortlisted:Rejected',
  'Interview:Interview Scheduled:Interview:Interview Completed',
  'Interview:Interview Completed:Training:Approved',
  'Interview:Interview Completed:Interview:Interview Failed',
  'Final Decision:Passed:Final Decision:Final Rejected',
]);

export function validateStageTransition(
  currentStage: string,
  currentStatus: string,
  newStage: string,
  newStatus: string,
  options?: StageTransitionOptions,
): string | null {
  if (isTerminalStatus(currentStatus)) {
    return `لا يمكن تغيير حالة طلب في حالة نهائية: ${currentStatus}`;
  }
  if (newStatus === 'Retreated') {
    if (newStage !== currentStage) {
      return 'يجب أن تبقى المرحلة كما هي عند تعيين حالة "انسحاب"';
    }
    return null;
  }
  if (newStatus === 'Retraining' && options) {
    const count = options.retrainingCount ?? 0;
    const max = options.maxRetrainingCount ?? 1;
    if (count >= max) {
      return `تم استنفاد الحد الأقصى لإعادة التدريب (${max})`;
    }
  }
  const key = `${currentStage}:${currentStatus}:${newStage}:${newStatus}`;
  if (!VALID_TRANSITIONS.has(key)) {
    return `انتقال غير صالح: ${currentStage}/${currentStatus} → ${newStage}/${newStatus}`;
  }
  return null;
}
