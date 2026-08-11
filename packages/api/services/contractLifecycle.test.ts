import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveContractWriteStatus } from './contractLifecycle.js';

test('contract create/edit cannot activate a contract from client input', () => {
  assert.equal(deriveContractWriteStatus('active'), 'draft');
  assert.equal(deriveContractWriteStatus('draft'), 'draft');
  assert.equal(deriveContractWriteStatus(undefined), 'draft');
  assert.equal(deriveContractWriteStatus(null), 'draft');
});

test('contract create/edit preserves only explicit terminal states', () => {
  assert.equal(deriveContractWriteStatus('cancelled'), 'cancelled');
  assert.equal(deriveContractWriteStatus('completed'), 'completed');
  assert.equal(deriveContractWriteStatus('discarded'), 'discarded');
});
