import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import {
  CandidateOwnershipError,
  canManageCandidateOwnership,
  resolveCandidateOwnershipInput,
} from './candidateOwnershipService.js';

function context(
  grants: AuthContext['grants'],
  allowedBranchIds: number[] = [3],
): AuthContext {
  return {
    userId: 17,
    roleId: 4,
    isSuperAdmin: false,
    grants,
    allowedBranchIds,
    actingBranchId: allowedBranchIds[0] ?? null,
  };
}

test('branch ownership is explicit and has no responsible', () => {
  assert.deepEqual(
    resolveCandidateOwnershipInput({ ownershipType: 'BRANCH', responsibleUserId: null }, 17),
    { ownershipType: 'BRANCH', responsibleUserId: null },
  );
  assert.throws(
    () => resolveCandidateOwnershipInput({ ownershipType: 'BRANCH', responsibleUserId: 22 }, 17),
    (error: unknown) =>
      error instanceof CandidateOwnershipError &&
      error.code === 'candidate_branch_ownership_has_responsible',
  );
});

test('empty legacy assignment cannot silently become branch ownership', () => {
  assert.throws(
    () => resolveCandidateOwnershipInput({ assignmentUserIds: [] }, 17),
    (error: unknown) =>
      error instanceof CandidateOwnershipError &&
      error.code === 'candidate_empty_assignment_requires_branch_ownership',
  );
});

test('personal ownership has exactly one responsible and defaults to creator', () => {
  assert.deepEqual(
    resolveCandidateOwnershipInput({}, 17),
    { ownershipType: 'PERSONAL', responsibleUserId: 17 },
  );
  assert.deepEqual(
    resolveCandidateOwnershipInput({ ownershipType: 'PERSONAL', responsibleUserId: 22 }, 17),
    { ownershipType: 'PERSONAL', responsibleUserId: 22 },
  );
  assert.throws(
    () => resolveCandidateOwnershipInput({ assignmentUserIds: [22, 23] }, 17),
    (error: unknown) =>
      error instanceof CandidateOwnershipError &&
      error.code === 'candidate_multiple_responsibles_forbidden',
  );
});

test('assignment management respects GLOBAL and BRANCH subject scope', () => {
  assert.equal(
    canManageCandidateOwnership(
      context([{ permission: 'candidates.assignment.manage', scope: 'GLOBAL' }]),
      99,
    ),
    true,
  );
  assert.equal(
    canManageCandidateOwnership(
      context([{ permission: 'candidates.assignment.manage', scope: 'BRANCH' }]),
      3,
    ),
    true,
  );
  assert.equal(
    canManageCandidateOwnership(
      context([{ permission: 'candidates.assignment.manage', scope: 'BRANCH' }]),
      7,
    ),
    false,
  );
  assert.equal(canManageCandidateOwnership(context([]), 3), false);
});

test('routes preserve branch-owned ASSIGNED invisibility and atomic conversion wiring', () => {
  const candidatesRoute = readFileSync(new URL('../routes/candidates.ts', import.meta.url), 'utf8');
  const clientsRoute = readFileSync(new URL('../routes/clients.ts', import.meta.url), 'utf8');

  assert.match(
    candidatesRoute,
    /EXISTS \(SELECT 1 FROM candidate_assignments WHERE candidate_id = c\.id AND hr_user_id = \$\$\{params\.length\}\)/,
  );
  assert.match(candidatesRoute, /replaceCandidateOwnership\(db, candidateId, ownership/);
  assert.match(candidatesRoute, /candidate_referral_sheet_branch_missing/);
  assert.match(candidatesRoute, /لا يمكن إعادة ربط اسم مقترح منتهٍ/);
  assert.match(clientsRoute, /sourceCandidateId/);
  assert.match(clientsRoute, /FOR UPDATE/);
  assert.match(clientsRoute, /UPDATE candidates[\s\S]*status = 'Qualified'/);
  assert.match(clientsRoute, /await db\.query\('COMMIT'\)/);
});

test('migration adds permission, audit history, one-owner guard and deactivation fallback', () => {
  const migration = readFileSync(
    new URL('../../../migrations/389_candidate_branch_ownership.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /candidates\.assignment\.manage/);
  assert.match(migration, /candidate_ownership_history/);
  assert.match(migration, /enforce_single_candidate_responsible/);
  assert.match(migration, /release_open_candidates_for_hr_user/);
  assert.match(migration, /status NOT IN \('Qualified', 'Junk'\)/);
  assert.match(migration, /legacy_owner_mismatch/);
  assert.match(migration, /requires_reconciliation/);
  assert.match(migration, /NEW\.status IS DISTINCT FROM 'active'/);
});
