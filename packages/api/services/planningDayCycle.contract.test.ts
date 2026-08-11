import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('./planningDayCycle.ts', import.meta.url), 'utf8');
const cleanupJob = readFileSync(new URL('./contactTargetsCleanupJob.ts', import.meta.url), 'utf8');
const planningRoute = readFileSync(new URL('../routes/planning.ts', import.meta.url), 'utf8');
const telemarketingRoute = readFileSync(new URL('../routes/telemarketing.ts', import.meta.url), 'utf8');
const assignedTasks = readFileSync(new URL('./assignedTasks.ts', import.meta.url), 'utf8');
const planningCuration = readFileSync(new URL('./planningTaskCuration.ts', import.meta.url), 'utf8');
const planningTargets = readFileSync(new URL('./planningMarketingTargets.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../../migrations/400_planning_day_cycle.sql', import.meta.url),
  'utf8',
);

test('planning cycle is a durable branch/date/team lifecycle', () => {
  assert.match(migration, /CREATE TABLE public\.planning_day_cycles/);
  assert.match(migration, /UNIQUE \(branch_id, planning_date, team_key\)/);
  assert.match(migration, /'planning', 'ready', 'active', 'closing', 'closed'/);
  assert.match(migration, /ALTER TABLE public\.telemarketing_task_lists[\s\S]*ADD COLUMN status/);
});

test('manual and automatic finalization share one transactional service', () => {
  assert.match(planningRoute, /closePlanningDayCycle\(\{/);
  assert.match(cleanupJob, /closeExpiredPlanningDayCycles\(includeCurrentDate\)/);
  assert.doesNotMatch(cleanupJob, /UPDATE contact_targets/);
  assert.match(service, /await db\.query\('BEGIN'\)/);
  assert.match(service, /await lockPlanningDayMutation\(db, params\.branchId, params\.date\)/);
  assert.match(service, /await db\.query\('COMMIT'\)/);
  assert.match(service, /await db\.query\('ROLLBACK'\)/);
});

test('finalization preserves history while closing every open operational layer', () => {
  assert.match(service, /UPDATE contact_targets[\s\S]*status = 'closed'/);
  assert.match(service, /locked_by_hr_user_id = NULL/);
  assert.match(service, /UPDATE contact_target_open_tasks[\s\S]*link_status = 'closed'/);
  assert.match(service, /UPDATE telemarketing_task_lists[\s\S]*status = 'closed'/);
  assert.match(service, /status IN \('new', 'queued', 'in_call_list', 'contacted'\)/);
  assert.doesNotMatch(service, /DELETE FROM (contact_targets|telemarketing_task_lists|telemarketing_task_list_items)/);
});

test('only unfinished planning tasks are released and every release is audited', () => {
  assert.match(service, /ot\.status = 'assigned'/);
  assert.match(service, /ot\.status = 'in_scheduling'/);
  assert.match(service, /COALESCE\(NULLIF\(ot\.last_waiting_status, ''\), 'open'\)/);
  assert.match(service, /INSERT INTO task_activity_log/);
  assert.match(service, /COUNT\(\*\) FILTER \(WHERE st\.status = 'booked'\)/);
});

test('closed cycles reject planning, generation and telemarketer writes', () => {
  assert.match(planningRoute, /assertPlanningDayCycleWritable\(pool, branchId, date, teamKey\)/);
  assert.match(telemarketingRoute, /assertPlanningDayCycleWritable\(pgClient, branchId, date, teamKey\)/);
  assert.match(assignedTasks, /assertPlanningDayCycleWritable\(db, branchId, date, teamKey\)/);
  assert.match(telemarketingRoute, /taskList\.status === 'closed'/);
  assert.match(service, /PLANNING_DAY_CLOSED/);
});

test('automatic catch-up includes assigned plans even before list generation', () => {
  assert.match(service, /FROM open_tasks[\s\S]*status = 'assigned'/);
  assert.match(service, /assigned_for_date[\s\S]*assigned_team_key/);
  assert.match(cleanupJob, /runContactTargetsCleanupOnce\(true\)/);
  assert.match(cleanupJob, /runContactTargetsCleanupOnce\(false\)/);
});

test('closed plan dashboards stay frozen and exclude newly waiting route matches', () => {
  assert.match(planningRoute, /closedCycle: cycle\.status === 'closed'/);
  assert.match(planningCuration, /if \(params\.closedCycle && target == null\) continue/);
  assert.match(planningTargets, /FROM contact_target_open_tasks committed_link/);
  assert.match(planningTargets, /committed_link\.open_task_id = ot\.id/);
  assert.match(planningTargets, /committed_link\.date = \$4::date/);
  assert.doesNotMatch(
    planningTargets.slice(
      planningTargets.indexOf('-- A committed plan is defined by the immutable contact-target/task bridge'),
      planningTargets.indexOf(') committed_snapshot ON TRUE'),
    ),
    /telemarketing_task_list_items/,
  );
});
