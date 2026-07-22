import type { AuthContext, AuthorizationResult, ListAccessPlan } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

export type TrainingCoursePermission =
  | 'jobs.training.view_list'
  | 'jobs.training.view_detail'
  | 'jobs.training.create'
  | 'jobs.training.start'
  | 'jobs.training.record_attendance'
  | 'jobs.training.complete'
  | 'jobs.training.record_result'
  | 'jobs.training.add_trainees'
  | 'jobs.training.view_eligible';

export interface TrainingCourseSubject {
  branchId: number | null;
}

export function getTrainingCourseListAccessPlan(context: AuthContext): ListAccessPlan {
  const plan = resolveListAccessScope(context, 'jobs.training.view_list');

  // Training courses do not have an assigned-user subject. Treating ASSIGNED as
  // BRANCH would silently broaden the grant beyond its configured meaning.
  return plan.scope === 'ASSIGNED' ? { ...plan, scope: 'NONE' } : plan;
}

export function canAccessTrainingCourse(
  context: AuthContext,
  permission: TrainingCoursePermission,
  subject: TrainingCourseSubject,
): AuthorizationResult {
  return authorize(context, {
    permission,
    branchId: subject.branchId,
    assignedUserId: null,
  });
}
