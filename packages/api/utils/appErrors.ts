// ============================================================
// utils/appErrors.ts
// ============================================================
// One error responder for the PUBLIC customer-app surface.
//
// Rule: a public caller sees only what we deliberately decided to tell it.
//   - Deliberate failures (thrown with a `status`) keep their Arabic message
//     and `details` — those strings are written for the app to display.
//   - Anything else is an unexpected internal fault. The caller gets a fixed
//     generic message; the real error text goes to the server log only.
//
// The previous shape (`res.status(500).json({ error: err.message })`) forwarded
// raw driver/SQL text — table and column names included — to anonymous clients.
// ============================================================

import type { Response } from 'express';

export interface AppHttpError {
  status?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export const GENERIC_APP_ERROR_MESSAGE = 'تعذّر إتمام العملية. حاول لاحقاً.';

/** Build a deliberate, client-visible error. */
export function appError(
  status: number,
  message: string,
  details?: Record<string, unknown>,
): Error & AppHttpError {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

/**
 * Decides the public body for a caught error. Pure — exported for tests.
 * `code` is a stable machine-readable slug the app can branch on; it is only
 * present when the thrower supplied one.
 */
export function toPublicAppError(err: unknown): {
  status: number;
  body: { error: string; details?: Record<string, unknown> };
  isInternal: boolean;
} {
  const candidate = err as AppHttpError | null;
  const status = typeof candidate?.status === 'number' ? candidate.status : 0;
  if (status >= 400 && status < 600) {
    return {
      status,
      body: {
        error: candidate?.message || GENERIC_APP_ERROR_MESSAGE,
        ...(candidate?.details ? { details: candidate.details } : {}),
      },
      isInternal: false,
    };
  }
  return {
    status: 500,
    body: { error: GENERIC_APP_ERROR_MESSAGE, details: { code: 'internal_error' } },
    isInternal: true,
  };
}

/**
 * Sends the public error body and logs internals server-side.
 * `label` identifies the call site in the log, never in the response.
 */
export function sendAppError(res: Response, err: unknown, label: string): Response {
  const { status, body, isInternal } = toPublicAppError(err);
  if (isInternal) console.error(`[app:${label}]`, err);
  return res.status(status).json(body);
}
