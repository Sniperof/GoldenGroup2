import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('migrations/467_backfill_imported_contract_financial_movements.sql', 'utf8');

test('historical contract ledger backfill reproduces every canonical contract movement source', () => {
  assert.match(migration, /'contract'/);
  assert.match(migration, /'contract_installment'/);
  assert.match(migration, /'contract_payment'/);
  assert.match(migration, /payment\.entry_type = 'refund'/);
});

test('historical backfill preserves draft, trial, free, and cancelled contract boundaries', () => {
  const activeCompletedGate = /contract\.status IN \('active', 'completed'\)/g;
  const definitiveGate = /contract\.sale_subtype = 'definitive'/g;

  assert.equal(migration.match(activeCompletedGate)?.length, 3);
  assert.equal(migration.match(definitiveGate)?.length, 3);
  assert.doesNotMatch(migration, /contract\.status IN \('active', 'completed', 'cancelled'\)/);
});

test('historical backfill quarantines schedules that exceed the contract final price', () => {
  assert.equal(migration.match(/\) <= contract\.final_price/g)?.length, 3);
});

test('historical backfill is append-only and idempotent', () => {
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE)\s+(?:FROM\s+)?public\.financial_movements\b/i);
  assert.equal(
    migration.match(/ON CONFLICT \(source_type, source_ref_id, kind\) WHERE source_ref_id IS NOT NULL\s+DO NOTHING/gi)?.length,
    3,
  );
});

test('historical installment dates use the report business timezone explicitly', () => {
  assert.match(migration, /installment\.due_date::timestamp AT TIME ZONE 'Asia\/Damascus'/);
});
