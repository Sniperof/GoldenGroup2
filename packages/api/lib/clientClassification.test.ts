import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveClientClassification } from './clientClassification.js';

test('OP and FOP map to themselves (any casing / whitespace)', () => {
  assert.equal(deriveClientClassification('OP'), 'OP');
  assert.equal(deriveClientClassification('FOP'), 'FOP');
  assert.equal(deriveClientClassification('op'), 'OP');
  assert.equal(deriveClientClassification('  fop '), 'FOP');
});

test('everything else defaults to Lead — never null', () => {
  assert.equal(deriveClientClassification(null), 'Lead');
  assert.equal(deriveClientClassification(undefined), 'Lead');
  assert.equal(deriveClientClassification(''), 'Lead');
  assert.equal(deriveClientClassification('Suggested'), 'Lead'); // real dev-DB value
  assert.equal(deriveClientClassification('LEAD'), 'Lead');
  assert.equal(deriveClientClassification('anything'), 'Lead');
});
