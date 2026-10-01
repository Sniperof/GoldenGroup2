import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const candidates = readFileSync(new URL('./candidates.ts', import.meta.url), 'utf8');
const sheets = readFileSync(new URL('./referralSheets.ts', import.meta.url), 'utf8');
const gifts = readFileSync(new URL('./gifts.ts', import.meta.url), 'utf8');
const contracts = readFileSync(new URL('./contracts.ts', import.meta.url), 'utf8');

test('candidate and name-list creation persist their promise inside the source transaction', () => {
  const candidateCreate = candidates.slice(candidates.indexOf("router.post('/',"), candidates.indexOf("router.put('/:id'"));
  assert.match(candidateCreate, /BEGIN[\s\S]*createReferralGiftPromise[\s\S]*COMMIT/);
  assert.match(candidateCreate, /sourceType: 'candidate'/);

  const sheetCreate = sheets.slice(sheets.indexOf("router.post('/',"), sheets.indexOf("router.put('/:id'"));
  assert.match(sheetCreate, /BEGIN[\s\S]*createReferralGiftPromise[\s\S]*COMMIT/);
  assert.match(sheetCreate, /sourceType: 'name_list'/);
});

test('referral editing authorizes the concrete candidate or name-list subject', () => {
  const start = gifts.indexOf("router.patch('/records/:id/referral-promise'");
  const end = gifts.indexOf("router.post('/records'", start);
  const route = gifts.slice(start, end);
  assert.match(route, /canEditCandidate/);
  assert.match(route, /canEditReferralSheet/);
  assert.match(route, /updateReferralGiftPromise/);
  assert.match(route, /conditionId = normalizePositiveInt\(req\.body\?\.conditionId\)/);
  assert.doesNotMatch(route, /conditionLabel: req\.body/);
});

test('contract promises are materialized only at sale closure: approval (non-trial) or trial settlement', () => {
  // The single direct call lives in the sale-closure helper.
  const materializeCalls = contracts.match(/materializeContractGiftPromises\(/g) ?? [];
  assert.equal(materializeCalls.length, 1);
  const helperStart = contracts.indexOf('async function materializeSaleClosureEffects(');
  assert.ok(helperStart >= 0);
  assert.ok(contracts.indexOf('materializeContractGiftPromises(', helperStart) > helperStart);

  // The helper runs from exactly two routes: /approve (skipped for trial
  // contracts — no gifts before the purchase decision) and /settle.
  const closureCalls = contracts.match(/await materializeSaleClosureEffects\(/g) ?? [];
  assert.equal(closureCalls.length, 2);
  const approveStart = contracts.indexOf("router.post('/:id/approve'");
  const settleStart = contracts.indexOf("router.post('/:id/settle'");
  assert.ok(approveStart >= 0 && settleStart > approveStart);
  const approveRoute = contracts.slice(approveStart, settleStart);
  assert.match(approveRoute, /if \(!isTrialContract\(c\.saleSubtype\)\) \{\s*await materializeSaleClosureEffects\(/);
  const nextRoute = contracts.indexOf('\nrouter.', settleStart + 1);
  const settleRoute = contracts.slice(settleStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(settleRoute, /await materializeSaleClosureEffects\(/);
});
