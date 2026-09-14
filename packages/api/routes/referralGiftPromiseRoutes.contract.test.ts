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

test('contract promises are still materialized only from contract approval', () => {
  const materializeCalls = contracts.match(/materializeContractGiftPromises\(/g) ?? [];
  assert.equal(materializeCalls.length, 1);
  const approvalStart = contracts.indexOf("router.post('/:id/approve'");
  assert.ok(approvalStart >= 0);
  assert.ok(contracts.indexOf('materializeContractGiftPromises(', approvalStart) > approvalStart);
});
