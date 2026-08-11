import type { AuthContext, CandidateOwnershipType } from '@golden-crm/shared';
import { authorize } from './authorizationService.js';
import { eligibleHrUserWithPermissionCondition } from './assigneeEligibility.js';

export type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type CandidateOwnershipDecision =
  | { ownershipType: 'BRANCH'; responsibleUserId: null }
  | { ownershipType: 'PERSONAL'; responsibleUserId: number };

export class CandidateOwnershipError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export function hasCandidateOwnershipPayload(payload: Record<string, any>): boolean {
  return (
    payload.ownershipType !== undefined ||
    payload.responsibleUserId !== undefined ||
    payload.assignmentUserIds !== undefined
  );
}

export function canManageCandidateOwnership(
  context: AuthContext,
  branchId: number | null,
): boolean {
  return authorize(context, {
    permission: 'candidates.assignment.manage',
    branchId,
  }).allowed;
}

function positiveUserId(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

/**
 * Resolve the write contract without touching the database.
 *
 * `ownershipType` is authoritative. A legacy non-empty assignmentUserIds array
 * remains accepted during the rollout, but an empty array is deliberately
 * rejected because it cannot distinguish omission from an explicit branch
 * ownership decision.
 */
export function resolveCandidateOwnershipInput(
  payload: Record<string, any>,
  fallbackUserId: number,
): CandidateOwnershipDecision {
  const requestedType = payload.ownershipType as CandidateOwnershipType | undefined;
  if (requestedType !== undefined && requestedType !== 'PERSONAL' && requestedType !== 'BRANCH') {
    throw new CandidateOwnershipError('نوع ملكية الاسم المقترح غير صالح', 400, 'candidate_ownership_type_invalid');
  }

  if (requestedType === 'BRANCH') {
    const explicitResponsible = positiveUserId(payload.responsibleUserId);
    const legacyAssignments = Array.isArray(payload.assignmentUserIds) ? payload.assignmentUserIds : [];
    if (explicitResponsible != null || legacyAssignments.length > 0) {
      throw new CandidateOwnershipError(
        'ملكية الفرع لا تقبل مسؤولاً شخصياً',
        400,
        'candidate_branch_ownership_has_responsible',
      );
    }
    return { ownershipType: 'BRANCH', responsibleUserId: null };
  }

  if (Array.isArray(payload.assignmentUserIds)) {
    const ids = Array.from(new Set(payload.assignmentUserIds.map(positiveUserId).filter((id): id is number => id != null)));
    if (ids.length === 0) {
      throw new CandidateOwnershipError(
        'الإسناد الفارغ يتطلب اختيار ملكية الفرع صراحة',
        400,
        'candidate_empty_assignment_requires_branch_ownership',
      );
    }
    if (ids.length > 1) {
      throw new CandidateOwnershipError(
        'يسمح بمسؤول واحد فقط لكل اسم مقترح',
        400,
        'candidate_multiple_responsibles_forbidden',
      );
    }
    return { ownershipType: 'PERSONAL', responsibleUserId: ids[0] };
  }

  const requestedResponsible = positiveUserId(payload.responsibleUserId ?? payload.ownerUserId);
  return {
    ownershipType: 'PERSONAL',
    responsibleUserId: requestedResponsible ?? fallbackUserId,
  };
}

export async function assertEligibleCandidateResponsible(
  db: Queryable,
  userId: number,
  branchId: number,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT u.id
       FROM hr_users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE u.id = $1
        AND u.branch_id = $2
        AND ${eligibleHrUserWithPermissionCondition('u', 'r', 'e', 'candidates.can_be_assigned')}`,
    [userId, branchId],
  );
  if (!rows[0]) {
    throw new CandidateOwnershipError(
      'الموظف المحدد غير مؤهل لإسناد الأسماء إليه أو ليس ضمن فرع العملية',
      400,
      'candidate_responsible_ineligible',
    );
  }
}

export async function validateCandidateOwnershipDecision(
  db: Queryable,
  context: AuthContext,
  branchId: number,
  decision: CandidateOwnershipDecision,
  options: { allowImplicitSelf?: boolean } = {},
): Promise<void> {
  const isImplicitSelf =
    options.allowImplicitSelf === true &&
    decision.ownershipType === 'PERSONAL' &&
    decision.responsibleUserId === context.userId;

  if (!isImplicitSelf && !canManageCandidateOwnership(context, branchId)) {
    throw new CandidateOwnershipError(
      'لا تملك صلاحية تحديد أو تغيير مسؤول الاسم المقترح',
      403,
      'candidate_assignment_forbidden',
    );
  }

  if (decision.ownershipType === 'PERSONAL') {
    await assertEligibleCandidateResponsible(db, decision.responsibleUserId, branchId);
  }
}

export async function replaceCandidateOwnership(
  db: Queryable,
  candidateId: number,
  decision: CandidateOwnershipDecision,
  assignedBy: number,
): Promise<void> {
  const { rows: currentRows } = await db.query(
    `SELECT hr_user_id AS "responsibleUserId"
       FROM candidate_assignments
      WHERE candidate_id = $1
      ORDER BY assigned_at, id
      LIMIT 1`,
    [candidateId],
  );
  const currentResponsibleUserId = currentRows[0]?.responsibleUserId == null
    ? null
    : Number(currentRows[0].responsibleUserId);
  const currentOwnershipType: CandidateOwnershipType = currentResponsibleUserId == null ? 'BRANCH' : 'PERSONAL';
  const ownershipChanged =
    currentOwnershipType !== decision.ownershipType ||
    currentResponsibleUserId !== decision.responsibleUserId;

  if (!ownershipChanged) return;

  await db.query(
    `INSERT INTO candidate_ownership_history (
       candidate_id, from_ownership_type, from_hr_user_id,
       to_ownership_type, to_hr_user_id, reason, changed_by
     )
     VALUES ($1, $2, $3, $4, $5, 'manual_assignment', $6)`,
    [
      candidateId,
      currentOwnershipType,
      currentResponsibleUserId,
      decision.ownershipType,
      decision.responsibleUserId,
      assignedBy,
    ],
  );
  await db.query('DELETE FROM candidate_assignments WHERE candidate_id = $1', [candidateId]);
  if (decision.ownershipType === 'PERSONAL') {
    await db.query(
      `INSERT INTO candidate_assignments (candidate_id, hr_user_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [candidateId, decision.responsibleUserId, assignedBy],
    );
  }
}
