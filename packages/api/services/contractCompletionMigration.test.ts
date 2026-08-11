import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../migrations/395_contract_cash_financial_completion.sql', import.meta.url),
  'utf8',
);

test('cash completion uses net collections and final price', () => {
  assert.match(
    migration,
    /v_payment_type\s*=\s*'cash'[\s\S]*CASE[\s\S]*entry_type\s*=\s*'refund'[\s\S]*-\s*amount_syp[\s\S]*v_net_payments\s*>=\s*v_final_price/i,
  );
});

test('payment mutations and activation both recompute contract completion', () => {
  assert.match(
    migration,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.trg_payment_entry_recompute[\s\S]*recompute_contract_completion\(NEW\.contract_id\)/i,
  );
  assert.match(
    migration,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.replay_recompute_on_activation[\s\S]*recompute_contract_completion\(NEW\.id\)/i,
  );
});

test('migration reconciles historical active contracts', () => {
  assert.match(
    migration,
    /SELECT\s+public\.recompute_contract_completion\(c\.id\)[\s\S]*WHERE\s+c\.status\s*=\s*'active'/i,
  );
});
