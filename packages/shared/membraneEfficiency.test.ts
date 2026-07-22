import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMembraneEfficiency } from './membraneEfficiency.js';

test('calculates membrane salt rejection in the output/input direction', () => {
  assert.deepEqual(evaluateMembraneEfficiency(15_000, 54), {
    status: 'valid', percentage: 100, issue: null,
  });
  assert.deepEqual(evaluateMembraneEfficiency(45, 1), {
    status: 'valid', percentage: 98, issue: null,
  });
  assert.deepEqual(evaluateMembraneEfficiency(45, 45), {
    status: 'valid', percentage: 0, issue: null,
  });
});

test('keeps the perfect output=0 reading visible', () => {
  assert.deepEqual(evaluateMembraneEfficiency(45, 0), {
    status: 'valid', percentage: 100, issue: null,
  });
});

test('does not disguise physically invalid readings as zero efficiency', () => {
  assert.deepEqual(evaluateMembraneEfficiency(45, 454), {
    status: 'invalid', percentage: null, issue: 'output_exceeds_input',
  });
  assert.deepEqual(evaluateMembraneEfficiency(1, 45), {
    status: 'invalid', percentage: null, issue: 'output_exceeds_input',
  });
});

test('distinguishes incomplete, undefined, and invalid readings', () => {
  assert.deepEqual(evaluateMembraneEfficiency(null, 10), {
    status: 'incomplete', percentage: null, issue: null,
  });
  assert.deepEqual(evaluateMembraneEfficiency(0, 0), {
    status: 'undefined', percentage: null, issue: null,
  });
  assert.equal(evaluateMembraneEfficiency(-1, 0).status, 'invalid');
  assert.equal(evaluateMembraneEfficiency('not-a-number', 0).status, 'invalid');
});
