import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./clients.ts', import.meta.url), 'utf8');

test('candidate conversion preserves an unknown referral date', () => {
  assert.match(source, /const defaultReferralDate = hasSourceCandidate \? null : currentDateKey\(\)/);
  assert.match(source, /reconcileClientReferrers[\s\S]*\{ defaultReferralDate \}/);
});

test('manual client creation retains the established current-date default', () => {
  assert.match(source, /hasSourceCandidate \? null : currentDateKey\(\)/);
});
