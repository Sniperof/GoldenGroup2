// Separate file: RASEL_KILL_SWITCH is read once at module import time (see
// config/env.ts). Static `import` statements are hoisted above any other
// top-level code in ESM, so setting process.env before a static import still
// runs too late — the module must be loaded with a dynamic import instead.

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.RASEL_KILL_SWITCH = 'true';
const { RaselOtpSender } = await import('./raselOtpSender.js');

test('the kill switch blocks sending immediately, without calling Rasel', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
  try {
    const sender = new RaselOtpSender();
    await assert.rejects(
      () => sender.send('0987223900', '482913', 'login'),
      (err: Error & { code?: string }) => err.code === 'sms_provider_unavailable',
    );
    assert.equal(called, false, 'the kill switch must reject before any network call');
  } finally {
    globalThis.fetch = original;
  }
});
