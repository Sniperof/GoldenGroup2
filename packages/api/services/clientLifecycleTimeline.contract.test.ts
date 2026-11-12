import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clientLifecycleTimeline.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../routes/clients.ts', import.meta.url), 'utf8');

// Milestones only (user decision 2026-11-02): a timeline of 1,000 «task added»
// and «visit cancelled» lines hides the contract and the emergency.
test('the timeline keeps milestones and leaves out the noise', () => {
  // Both stored spellings of a postponement, plus a cancelled visit task.
  assert.match(source, /const NON_MILESTONE_DECISIONS = \['cancelled', 'rescheduled', 'reschedule'\]/);
  assert.equal(source.match(/r\.final_decision <> ALL\(\$\d::text\[\]\)/g)?.length, 2);
  assert.match(source, /ot\.task_type <> ALL\(\$2::text\[\]\)/);
  for (const auto of ['device_delivery', 'device_installation', 'device_activation', 'periodic_maintenance', 'installment_collection']) {
    assert.match(source.slice(source.indexOf('AUTO_GENERATED_TASK_TYPES')), new RegExp(`'${auto}'`));
  }
  // Actual money only — the installment schedule (charges) is not an event.
  assert.match(source, /f\.kind IN \('payment', 'refund'\)/);
  assert.match(source, /ct\.status NOT IN \('draft', 'discarded'\)/);
});

// A second label table here showed «refused_to_pay» in English (2026-11-02):
// outcomes travel as codes and the screen words them with the app's one table.
test('task outcomes are worded by the app-wide decision labels, not a local copy', () => {
  assert.doesNotMatch(source, /RESULT_LABELS|paid_full|refused_to_pay/);
  assert.match(source, /decision: \{ code: r\.final_decision, taskType: r\.task_type \}/);
  const tab = readFileSync(new URL('../../web/src/pages/clientProfile/LifecycleTab.tsx', import.meta.url), 'utf8');
  assert.match(tab, /taskDecisionLabel\(event\.decision\.code, event\.decision\.taskType\)/);
});

test('a contract is dated by its sale date, not the import date', () => {
  assert.match(source, /const signed = dateOnlyOf\(ct\.contract_date\)/);
  assert.match(source, /reliable: signed != null \? isReliable\(signed\) : false/);
});

test('each category follows the permission of its own profile tab', () => {
  assert.match(source, /money: \['clients\.account_statement\.view'\]/);
  assert.match(source, /contracts: \['clients\.purchase_history\.view', 'contracts\.view_list'\]/);
  assert.match(source, /complaints: \['complaints\.view_list'\]/);
  assert.match(source, /allowed\.money \? pool\.query/);
});

// The tab has its own key (491), granted to every clients.view holder with the
// same scope so applying it changes nobody's access.
test('the lifecycle tab is gated by its own scope-aware permission', () => {
  assert.match(route, /router\.get\('\/:id\/lifecycle', requirePermission\('clients\.lifecycle\.view'\)/);
  assert.match(route, /const access = canViewClientLifecycle\(authContext, subject\)/);
  const policy = readFileSync(new URL('../policies/clientPolicy.ts', import.meta.url), 'utf8');
  assert.match(policy, /authorizeClientPermission\(context, 'clients\.lifecycle\.view', client\)/);
  const migration = readFileSync(new URL('../../../migrations/491_client_lifecycle_permission.sql', import.meta.url), 'utf8');
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
  assert.match(migration, /SELECT g\.role_id, lifecycle_perm\.id, g\.scope_type/);
  assert.match(migration, /view_perm\.key = 'clients\.view'/);
  const profile = readFileSync(new URL('../../web/src/pages/ClientProfile.tsx', import.meta.url), 'utf8');
  assert.match(profile, /hasPermission\('clients\.lifecycle\.view'\)/);
});
