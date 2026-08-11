import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import {
  assertPlanningTeamSubject,
  PlanningCurationError,
} from './planningTaskCuration.js';

function planningAuth(options: {
  scope?: AuthContext['grants'][number]['scope'];
  allowedBranchIds?: number[];
  isSuperAdmin?: boolean;
} = {}): AuthContext {
  return {
    userId: 17,
    roleId: 4,
    isSuperAdmin: options.isSuperAdmin === true,
    grants: options.scope
      ? [{ permission: 'planning.manage', scope: options.scope }]
      : [],
    allowedBranchIds: options.allowedBranchIds ?? [7],
    actingBranchId: options.allowedBranchIds?.[0] ?? 7,
  };
}

function planningTeamSubjectDb(owningBranchId: number | null) {
  return {
    async query(sql: string) {
      if (sql.includes('FROM day_schedules')) {
        return owningBranchId == null
          ? { rows: [] }
          : { rows: [{ teams: [{ supervisor: 51 }], solos: [] }] };
      }
      if (sql.includes('FROM employees')) {
        return { rows: [{ branchId: owningBranchId }] };
      }
      throw new Error(`Unexpected planning subject query: ${sql}`);
    },
  };
}

test('planning team subject denies missing permission, ASSIGNED scope, wrong branch, and missing team', async () => {
  await assert.rejects(
    assertPlanningTeamSubject(
      planningAuth(),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(7) as never,
    ),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 403
      && error.code === 'MISSING_PERMISSION',
  );
  await assert.rejects(
    assertPlanningTeamSubject(
      planningAuth({ scope: 'ASSIGNED' }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(7) as never,
    ),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 403
      && error.code === 'ASSIGNMENT_FORBIDDEN',
  );
  await assert.rejects(
    assertPlanningTeamSubject(
      planningAuth({ scope: 'GLOBAL' }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(8) as never,
    ),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 403
      && error.code === 'TEAM_BRANCH_FORBIDDEN',
  );
  await assert.rejects(
    assertPlanningTeamSubject(
      planningAuth({ scope: 'GLOBAL' }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(null) as never,
    ),
    (error: unknown) =>
      error instanceof PlanningCurationError
      && error.status === 404
      && error.code === 'TEAM_SUBJECT_NOT_FOUND',
  );
});

test('planning team subject allows matching BRANCH, GLOBAL, and explicit super-admin scopes', async () => {
  await assert.doesNotReject(
    assertPlanningTeamSubject(
      planningAuth({ scope: 'BRANCH', allowedBranchIds: [7] }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(7) as never,
    ),
  );
  await assert.doesNotReject(
    assertPlanningTeamSubject(
      planningAuth({ scope: 'GLOBAL', allowedBranchIds: [] }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(7) as never,
    ),
  );
  await assert.doesNotReject(
    assertPlanningTeamSubject(
      planningAuth({ isSuperAdmin: true, allowedBranchIds: [] }),
      '2026-07-30',
      'team_0',
      7,
      planningTeamSubjectDb(7) as never,
    ),
  );
});
