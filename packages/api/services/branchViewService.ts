// ============================================================
// services/branchViewService.ts
// ============================================================
// ONE answer to "which branches does this list request cover?".
//
// Every records list used to hand-write the same three-way rule, each slightly
// differently — and that is how a GLOBAL operator came to be refused a branch
// in clients/candidates/name lists while employees/tasks let them in. Lists now
// ask this function and only translate its answer into SQL.
//
//   GLOBAL (or super admin) → every branch, or the one selected in the switcher.
//   BRANCH / ASSIGNED       → the actor's assigned branches; selecting a branch
//                             outside them is refused (never silently widened
//                             or silently ignored).
//   no grant                → refused.
//
// ASSIGNED adds the personal-ownership predicate on top; that part stays in the
// route because the ownership column differs per entity.
//
// See docs/constitution/standards/branch-scope-and-visibility-standard.md.
// A contract test (branchViewContract.test.ts) forbids re-introducing the
// hand-written `allowedBranchIds.includes(requested…)` guard in routes.
// ============================================================

import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { resolveListAccessScope } from './authorizationService.js';

export type BranchViewFailureReason = 'MISSING_PERMISSION' | 'NO_BRANCH' | 'BRANCH_FORBIDDEN';

export interface BranchViewGranted {
  ok: true;
  /** Scope of the section's view permission (super admin → GLOBAL). */
  scope: ScopeType;
  /** Branches the rows must belong to; null = every branch (GLOBAL, nothing selected). */
  branchIds: number[] | null;
  /** The validated switcher / filter selection, if any. */
  selectedBranchId: number | null;
  userId: number;
}

export interface BranchViewRefused {
  ok: false;
  reason: BranchViewFailureReason;
}

export type BranchView = BranchViewGranted | BranchViewRefused;

/** Parse an X-Branch-Id header / ?branchId value. Anything not a positive integer = no selection. */
export function readRequestedBranchId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function resolveBranchView(
  context: AuthContext,
  permission: string,
  requestedBranchId: number | null,
): BranchView {
  const plan = resolveListAccessScope(context, permission);
  if (plan.scope === 'NONE') {
    return { ok: false, reason: 'MISSING_PERMISSION' };
  }

  if (plan.scope === 'GLOBAL') {
    return {
      ok: true,
      scope: 'GLOBAL',
      branchIds: requestedBranchId == null ? null : [requestedBranchId],
      selectedBranchId: requestedBranchId,
      userId: context.userId,
    };
  }

  const assigned = plan.allowedBranchIds ?? [];
  if (assigned.length === 0) {
    return { ok: false, reason: 'NO_BRANCH' };
  }
  if (requestedBranchId != null && !assigned.includes(requestedBranchId)) {
    return { ok: false, reason: 'BRANCH_FORBIDDEN' };
  }

  return {
    ok: true,
    scope: plan.scope,
    branchIds: requestedBranchId == null ? [...assigned] : [requestedBranchId],
    selectedBranchId: requestedBranchId,
    userId: context.userId,
  };
}

const REFUSAL_MESSAGES: Record<BranchViewFailureReason, string> = {
  MISSING_PERMISSION: 'غير مسموح',
  NO_BRANCH: 'لا يوجد فرع فعّال متاح لهذه العملية',
  BRANCH_FORBIDDEN: 'ليس لديك صلاحية الوصول لهذا الفرع',
};

/** Uniform 403 body for a refused view; `code` lets the UI tell the cases apart. */
// Takes the union: this project's compiler settings do not narrow on `ok`.
export function sendBranchViewRefusal(res: any, view: BranchView) {
  const reason = (view as BranchViewRefused).reason ?? 'MISSING_PERMISSION';
  return res.status(403).json({ error: REFUSAL_MESSAGES[reason], code: reason });
}
