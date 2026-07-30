import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildExcludedTaskTeamPredicate } from './planningContactTargetScope.js';

test('excluded planning tasks are scoped by date, retained team, and status', () => {
  const predicate = buildExcludedTaskTeamPredicate('ot', '$3', '$4');

  assert.match(predicate, /ot\.excluded_for_date = \$4::date/);
  assert.match(predicate, /ot\.assigned_team_key = \$3/);
  assert.match(predicate, /ot\.status IN \('open', 'needs_follow_up', 'assigned'\)/);
});

test('excluded planning task predicate rejects unsafe SQL tokens', () => {
  assert.throws(
    () => buildExcludedTaskTeamPredicate('ot; DROP TABLE open_tasks', '$1', '$2'),
    /Invalid task alias/,
  );
  assert.throws(
    () => buildExcludedTaskTeamPredicate('ot', '$1 OR TRUE', '$2'),
    /Invalid team parameter/,
  );
});

test('dashboard reads layered exclusions while legacy reconciliation stays team-scoped', () => {
  const routeUrl = new URL('../routes/planning.ts', import.meta.url);
  const routeSource = readFileSync(routeUrl, 'utf8');
  const predicateCalls = routeSource.match(/buildExcludedTaskTeamPredicate\('ot'/g) ?? [];

  assert.equal(predicateCalls.length, 2);
  assert.match(
    routeSource,
    /buildPlanningTaskExcludedPredicate\('ot', '\$1', '\$2'\)/,
  );
  assert.match(
    routeSource,
    /buildExcludedTaskTeamPredicate\('ot', '\$1', '\$4'\)/,
  );
  assert.match(
    routeSource,
    /buildExcludedTaskTeamPredicate\('ot', '\$3', '\$4'\)/,
  );
});

test('DEF-017 repair migration only removes provably mismatched untouched data', () => {
  const migrationUrl = new URL('../../../migrations/381_contact_target_team_isolation_repair.sql', import.meta.url);
  const migration = readFileSync(migrationUrl, 'utf8');

  assert.match(migration, /ctot\.date = ot\.excluded_for_date/);
  assert.match(migration, /ctot\.team_key <> ot\.assigned_team_key/);
  assert.match(migration, /ct\.closing_reason = 'manual_supervisor'/);
  assert.match(migration, /telemarketing_task_list_items/);
  assert.match(migration, /telemarketing_call_logs/);
  assert.match(migration, /telemarketing_appointments/);
  assert.match(migration, /public\.open_tasks task/);
});
