import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COMPLAINT_BRANCH_ASSIGNABLE_STATUSES,
  REQUIRED_COMPLAINT_HANDLER_PERMISSIONS,
  validateComplaintTriagePriority,
} from './complaintService.js';

test('branch and handler assignment are unavailable before triage or after terminal states', () => {
  assert.equal(COMPLAINT_BRANCH_ASSIGNABLE_STATUSES.includes('new'), false);
  assert.equal(COMPLAINT_BRANCH_ASSIGNABLE_STATUSES.includes('triaged'), true);
  for (const status of ['resolved', 'closed', 'rejected', 'withdrawn'] as const) {
    assert.equal(COMPLAINT_BRANCH_ASSIGNABLE_STATUSES.includes(status), false);
  }
});

test('triage requires an explicit supported priority', () => {
  assert.equal(validateComplaintTriagePriority('critical'), 'critical');
  assert.equal(validateComplaintTriagePriority('normal'), 'normal');
  assert.throws(() => validateComplaintTriagePriority(undefined), /invalid_priority/);
  assert.throws(() => validateComplaintTriagePriority('urgent'), /invalid_priority/);
});

test('complaint handlers require both processing capabilities in lookup and assignment', () => {
  assert.deepEqual(REQUIRED_COMPLAINT_HANDLER_PERMISSIONS, [
    'complaints.start_processing', 'complaints.resolve',
  ]);
  const source = fs.readFileSync(new URL('./complaintService.ts', import.meta.url), 'utf8');
  assert.match(source, /assignComplaintHandler[\s\S]*listEligibleComplaintHandlers\(pool,subject\.handlingBranchId,userId\)/);
  assert.match(source, /listComplaintAssignmentHandlers[\s\S]*listEligibleComplaintHandlers\(pool,subject\.handlingBranchId\)/);
});
