import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLAINT_CATEGORY_LABELS_AR,
  DEVICE_COMPLAINT_CATEGORIES,
  isComplaintTransitionAllowed,
  TECHNICAL_COMPLAINT_CATEGORIES,
} from './complaints.js';

test('every complaint category exposed to users has an Arabic label', () => {
  const categories = [...TECHNICAL_COMPLAINT_CATEGORIES, ...DEVICE_COMPLAINT_CATEGORIES];

  for (const category of categories) {
    assert.match(COMPLAINT_CATEGORY_LABELS_AR[category], /[\u0600-\u06FF]/);
  }
});

test('complaint lifecycle permits only the approved forward steps', () => {
  assert.equal(isComplaintTransitionAllowed('new', 'triaged'), true);
  assert.equal(isComplaintTransitionAllowed('triaged', 'assigned'), true);
  assert.equal(isComplaintTransitionAllowed('assigned', 'in_progress'), true);
  assert.equal(isComplaintTransitionAllowed('in_progress', 'awaiting_complainant'), true);
  assert.equal(isComplaintTransitionAllowed('awaiting_complainant', 'in_progress'), true);
  assert.equal(isComplaintTransitionAllowed('in_progress', 'resolved'), true);
  assert.equal(isComplaintTransitionAllowed('resolved', 'closed'), true);
  assert.equal(isComplaintTransitionAllowed('new', 'resolved'), false);
  assert.equal(isComplaintTransitionAllowed('closed', 'new'), false);
});

test('terminal complaints can only be reopened internally to processing', () => {
  for (const status of ['closed', 'rejected', 'withdrawn'] as const) {
    assert.equal(isComplaintTransitionAllowed(status, 'in_progress'), true);
    assert.equal(isComplaintTransitionAllowed(status, 'triaged'), false);
  }
});
