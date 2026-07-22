import assert from 'node:assert/strict';
import test from 'node:test';
import type { MetricComputeContext } from './metricsCatalog.js';
import { appendCandidateScope, appendClientScope, appendReferralSheetScope } from './reportingScope.js';

function context(scope: MetricComputeContext['scope']): MetricComputeContext {
  const now = new Date('2026-07-22T10:00:00.000Z');
  return {
    scope,
    branchIds: scope === 'GLOBAL' ? [] : [3, 7],
    userId: 42,
    from: now,
    to: now,
    prevFrom: now,
    prevTo: now,
  };
}

test('candidate ASSIGNED scope matches candidate_assignments and branch scope', () => {
  const params: unknown[] = [];
  const sql = appendCandidateScope(context('ASSIGNED'), params);

  assert.match(sql, /c\.branch_id = ANY\(\$1\)/);
  assert.match(sql, /FROM candidate_assignments ca_scope/);
  assert.match(sql, /ca_scope\.candidate_id = c\.id/);
  assert.match(sql, /ca_scope\.hr_user_id = \$2/);
  assert.deepEqual(params, [[3, 7], 42]);
});

test('referral-sheet ASSIGNED scope matches assigned_hr_user_id used by its list', () => {
  const params: unknown[] = [];
  const sql = appendReferralSheetScope(context('ASSIGNED'), params);

  assert.match(sql, /s\.branch_id = ANY\(\$1\)/);
  assert.match(sql, /s\.assigned_hr_user_id = \$2/);
  assert.doesNotMatch(sql, /owner_user_id/);
  assert.deepEqual(params, [[3, 7], 42]);
});

test('GLOBAL reporting scope adds no branch or assignment predicate', () => {
  for (const appendScope of [appendCandidateScope, appendClientScope, appendReferralSheetScope]) {
    const params: unknown[] = [];
    assert.equal(appendScope(context('GLOBAL'), params), '');
    assert.deepEqual(params, []);
  }
});
