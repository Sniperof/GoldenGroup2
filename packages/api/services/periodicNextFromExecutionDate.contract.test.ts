import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./periodicMaintenanceTasks.ts', import.meta.url), 'utf8');

const nextFn = source.slice(
  source.indexOf('export async function generateNextPeriodicMaintenanceTask('),
  source.indexOf('export async function createManualPeriodicMaintenanceTask('),
);

test('next periodic restarts from the execution visit date, not the previous due date', () => {
  assert.ok(nextFn.length > 0, 'generateNextPeriodicMaintenanceTask not found');
  assert.doesNotMatch(nextFn, /due_date AS "currentDueDate"/);
  assert.match(nextFn, /SELECT fv\.scheduled_date\s+FROM visit_tasks vt\s+JOIN field_visits fv ON fv\.id = vt\.field_visit_id/);
  assert.match(nextFn, /\[executedByTaskId, intervalDays\]/);
});

test('a periodic covered inside an emergency restarts from the emergency visit', () => {
  const supersede = source.slice(source.indexOf('superseded_within_emergency:'));
  assert.match(supersede, /generateNextPeriodicMaintenanceTask\(\s*db,\s*input\.periodicTaskId,\s*input\.actorUserId \?\? null,\s*input\.emergencyTaskId,\s*\)/);
});
