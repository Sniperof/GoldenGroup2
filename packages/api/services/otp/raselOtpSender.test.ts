// Rasel adapter (rasel-otp-backend-integration.md): success requires BOTH the
// top-level and the result-level `ok`; the code/API key/full phone must never
// reach a log line or an error message.

import assert from 'node:assert/strict';
import test from 'node:test';
import { RaselOtpSender } from './raselOtpSender.js';

// RASEL_TRIAL_MODE defaults to true and RASEL_TRIAL_ALLOWED_TO defaults to
// 963987223900 (see config/env.ts) — local 0987223900 maps onto it.
const TRIAL_PHONE = '0987223900';
const OTHER_PHONE = '0911111111';
const CODE = '482913';

function mockFetch(handler: (input: unknown, init: unknown) => Promise<Response> | Response) {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (input: unknown, init: unknown) => {
    calls.push({ input, init });
    return handler(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function raselResponse(overrides: {
  topOk?: boolean;
  resultOk?: boolean;
  bodySuccess?: boolean;
} = {}) {
  const { topOk = true, resultOk = true, bodySuccess = true } = overrides;
  return new Response(JSON.stringify({
    status: 200,
    ok: topOk,
    total: 1,
    successCount: bodySuccess ? 1 : 0,
    failCount: bodySuccess ? 0 : 1,
    results: [{
      to: '9639XXXXXXXX',
      status: 200,
      ok: resultOk,
      body: {
        success: bodySuccess,
        requestId: 'msgreq_test_1',
        status: 'sent',
        tracking: { messageId: '9639XXXXXXXX', usageId: 'usage_1' },
      },
    }],
  }), { status: 200 });
}

async function captureConsole<T>(fn: () => Promise<T>) {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => lines.push(a.join(' '));
  console.warn = (...a: unknown[]) => lines.push(a.join(' '));
  console.error = (...a: unknown[]) => lines.push(a.join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } catch (err) {
    return { error: err as Error, lines };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

test('successful send returns provider tracking metadata', async () => {
  const mock = mockFetch(() => raselResponse());
  try {
    const sender = new RaselOtpSender();
    const { result, lines } = await captureConsole(() => sender.send(TRIAL_PHONE, CODE, 'login'));
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(result, {
      delivered: true,
      provider: 'rasel',
      providerRequestId: 'msgreq_test_1',
      providerStatus: 'sent',
      providerMessageId: '9639XXXXXXXX',
      providerUsageId: 'usage_1',
    });
    assert.equal(lines.some((l) => l.includes(CODE)), false, 'the OTP code must never be logged');
    assert.equal(lines.some((l) => l.includes('963987223900')), false, 'the full phone must never be logged');
  } finally {
    mock.restore();
  }
});

test('top-level ok:false is a provider failure even if the result looks fine', async () => {
  const mock = mockFetch(() => raselResponse({ topOk: false }));
  try {
    const sender = new RaselOtpSender();
    const { error } = await captureConsole(() => sender.send(TRIAL_PHONE, CODE, 'login'));
    assert.equal((error as Error & { code?: string }).code, 'sms_provider_failed');
  } finally {
    mock.restore();
  }
});

test('result-level ok:false is a provider failure even if the top level is ok', async () => {
  const mock = mockFetch(() => raselResponse({ resultOk: false, bodySuccess: false }));
  try {
    const sender = new RaselOtpSender();
    const { error } = await captureConsole(() => sender.send(TRIAL_PHONE, CODE, 'login'));
    assert.equal((error as Error & { code?: string }).code, 'sms_provider_failed');
  } finally {
    mock.restore();
  }
});

test('a network error maps to sms_provider_unavailable', async () => {
  const mock = mockFetch(() => { throw new Error('ECONNRESET'); });
  try {
    const sender = new RaselOtpSender();
    const { error, lines } = await captureConsole(() => sender.send(TRIAL_PHONE, CODE, 'login'));
    assert.equal((error as Error & { code?: string }).code, 'sms_provider_unavailable');
    assert.equal(lines.some((l) => l.includes(CODE)), false);
  } finally {
    mock.restore();
  }
});

test('trial mode blocks any number other than the allowed trial number, without calling Rasel', async () => {
  const mock = mockFetch(() => raselResponse());
  try {
    const sender = new RaselOtpSender();
    const { error } = await captureConsole(() => sender.send(OTHER_PHONE, CODE, 'login'));
    assert.equal((error as Error & { code?: string }).code, 'sms_provider_unavailable');
    assert.equal(mock.calls.length, 0, 'trial mode must reject before any network call');
  } finally {
    mock.restore();
  }
});

test('no log line ever contains the raw API key value', async () => {
  const mock = mockFetch(() => raselResponse());
  try {
    const sender = new RaselOtpSender();
    const { lines } = await captureConsole(() => sender.send(TRIAL_PHONE, CODE, 'login'));
    assert.equal(lines.some((l) => l.toLowerCase().includes('x-api-key')), false);
  } finally {
    mock.restore();
  }
});
