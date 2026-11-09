import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildClientLifecycleStatusSql } from './customerOwnership.js';

const migration = readFileSync(new URL('../../../migrations/492_client_offer_presented.sql', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const job = readFileSync(new URL('./clientOfferPresentedJob.ts', import.meta.url), 'utf8');

// 2026-11-09: migrated demo visits carry no open task, so the rule's only path
// (through open_tasks) left ~50k clients whose offer was presented LEAD.
test('the FOP rule also reads the client_offer_presented fact by key', () => {
  const sql = buildClientLifecycleStatusSql('c');
  assert.match(sql, /FROM client_offer_presented lifecycle_cop\s+WHERE lifecycle_cop\.client_id = c\.id/);
  // The rule itself is unchanged: still the offer_presented result, through open_tasks too.
  assert.match(sql, /lifecycle_vtr\.final_decision = 'offer_presented'/);
  // No visit-level join in the per-client rule: that built the 70k set per query.
  assert.doesNotMatch(sql, /field_visits/);
});

test('the fact is the same rule: a closed demo visit task with an offer_presented result', () => {
  assert.match(migration, /vt\.task_type = 'device_demo'\s+AND vt\.status = 'closed'\s+AND r\.final_decision = 'offer_presented'/);
  for (const table of ['visit_task_results', 'visit_tasks', 'field_visits']) {
    assert.match(migration, new RegExp(`CREATE TRIGGER trg_client_offer_presented_on_\\w+\\s+AFTER [^;]*ON public\\.${table}`), table);
  }
  assert.match(migration, /SELECT \* FROM public\.reconcile_client_offer_presented\(\);/);
});

test('a copy made with triggers disabled is reconciled at boot and daily', () => {
  assert.match(index, /import\('\.\/services\/clientOfferPresentedJob\.js'\)\.then\(\(mod\) =>\s*mod\.startClientOfferPresentedJob\(\)/);
  assert.match(job, /void run\('boot'\)/);
  assert.match(job, /SELECT added, removed FROM public\.reconcile_client_offer_presented\(\)/);
});
