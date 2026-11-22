import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenTaskEligibilityPredicate } from './planningMarketingTargets.js';

const compact = (sql: string) => sql.replace(/\s+/g, ' ');

test('needs_follow_up enters the plan FOR the promised day when anchored on execution day D', () => {
  // D = execution day; the call happens on D-1. expected_date <= D means a
  // task promised for E is in the plan for E (called E-1, visited E).
  const sql = compact(buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning', '$4::date'));
  assert.match(sql, /ot\.expected_date <= \$4::date \)/);
  assert.doesNotMatch(sql, /expected_date <= \$4::date \+ INTERVAL/);
});

test('the legacy CURRENT_DATE anchor (the call day) keeps the one-day lead', () => {
  const sql = compact(buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning'));
  assert.match(sql, /ot\.expected_date <= CURRENT_DATE \+ INTERVAL '1 day'/);
});
