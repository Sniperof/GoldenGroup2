import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorHandler } from './apiErrorHandler.js';

test('returns a JSON 500 response for an unhandled API error', () => {
  let statusCode: number | null = null;
  let payload: unknown;
  let forwarded: unknown;
  const response = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    apiErrorHandler(
      new Error('database unavailable'),
      { method: 'PUT', originalUrl: '/api/employees/1/system-account' } as any,
      response as any,
      (error?: unknown) => { forwarded = error; },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 500);
  assert.deepEqual(payload, { error: 'حدث خطأ داخلي في الخادم' });
  assert.equal(forwarded, undefined);
});

test('forwards the error when response headers were already sent', () => {
  const error = new Error('late failure');
  let forwarded: unknown;

  apiErrorHandler(
    error,
    { method: 'GET', originalUrl: '/api/health' } as any,
    { headersSent: true } as any,
    (nextError?: unknown) => { forwarded = nextError; },
  );

  assert.equal(forwarded, error);
});

test('does not change error handling for non-API routes', () => {
  const error = new Error('page failure');
  let forwarded: unknown;

  apiErrorHandler(
    error,
    { method: 'GET', originalUrl: '/account-deletion' } as any,
    { headersSent: false } as any,
    (nextError?: unknown) => { forwarded = nextError; },
  );

  assert.equal(forwarded, error);
});

test('preserves a known client-error status without returning HTML', () => {
  let statusCode: number | null = null;
  let payload: unknown;
  const response = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    apiErrorHandler(
      Object.assign(new Error('invalid JSON'), { status: 400 }),
      { method: 'POST', originalUrl: '/api/employees' } as any,
      response as any,
      () => {},
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 400);
  assert.deepEqual(payload, { error: 'تعذر معالجة الطلب' });
});
