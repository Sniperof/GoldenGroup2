import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../migrations/409_contract_activation_trigger_order.sql', import.meta.url),
  'utf8',
);

test('contract activation materializes the device before recomputing completion', () => {
  const materializeIndex = migration.indexOf('CREATE TRIGGER trg_10_materialize_device_on_activation');
  const recomputeIndex = migration.indexOf('CREATE TRIGGER trg_20_replay_recompute_on_activation');

  assert.notEqual(materializeIndex, -1);
  assert.notEqual(recomputeIndex, -1);
  assert.ok(materializeIndex < recomputeIndex);
  assert.ok('trg_10_materialize_device_on_activation' < 'trg_20_replay_recompute_on_activation');
});

test('migration removes legacy and replacement trigger names before recreating them', () => {
  for (const triggerName of [
    'trg_contracts_replay_recompute_on_activation',
    'trg_materialize_device_on_activation',
    'trg_10_materialize_device_on_activation',
    'trg_20_replay_recompute_on_activation',
  ]) {
    assert.match(migration, new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${triggerName}`, 'i'));
  }
});

test('replacement triggers retain the activation guards', () => {
  assert.match(
    migration,
    /CREATE\s+TRIGGER\s+trg_10_materialize_device_on_activation[\s\S]*NEW\.contract_type\s*=\s*'sale_contract'[\s\S]*NEW\.status\s*=\s*'active'[\s\S]*OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'active'[\s\S]*materialize_device_on_activation\(\)/i,
  );
  assert.match(
    migration,
    /CREATE\s+TRIGGER\s+trg_20_replay_recompute_on_activation[\s\S]*NEW\.status\s*=\s*'active'[\s\S]*OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'active'[\s\S]*replay_recompute_on_activation\(\)/i,
  );
});
