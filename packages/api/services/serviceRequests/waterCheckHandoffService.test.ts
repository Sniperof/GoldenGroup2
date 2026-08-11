import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WATER_CHECK_DEVICE_DEMO_CREATION_ORIGIN } from './waterCheckHandoffService.js';

test('water-check handoff uses a device-demo constitutional origin, not a call origin', () => {
  assert.equal(WATER_CHECK_DEVICE_DEMO_CREATION_ORIGIN, 'manual_creation');
  const source = readFileSync(new URL('./waterCheckHandoffService.ts', import.meta.url), 'utf8');
  assert.match(source, /'device_demo'/);
  assert.match(source, /'service_request'/);
  assert.match(source, /source_service_request_id/);
  assert.doesNotMatch(source, /service_request_call/);
});
