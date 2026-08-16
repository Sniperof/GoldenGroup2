// ============================================================
// middleware/rateLimit.ts
// ============================================================
// Fixed-window request limiter for the PUBLIC mobile surface (/api/app/*,
// /api/public/*). Staff routes are out of scope: they are behind auth and a
// known, accountable population.
//
// Scope of protection (deliberately narrow):
//   - This is the coarse outer gate, keyed by client IP. It exists so an
//     anonymous caller cannot loop a public endpoint thousands of times a
//     minute — above all `otp/send`, which spends money per call once a real
//     SMS provider is wired in.
//   - It is NOT the identity rule. Per-phone and per-account caps live in the
//     DB next to the rule they protect (otpService, mobileIntakeThrottle) so
//     they survive restarts and hold across processes.
//
// State is per-process and in memory. With PM2 cluster mode the effective
// limit is (workers × limit) — acceptable for the outer gate precisely because
// the money/identity rules are DB-enforced underneath it.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { APP_RATE_LIMIT_ENABLED } from '../config/env.js';

interface Counter {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Counter>();
let sweepTimer: NodeJS.Timeout | null = null;

function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, counter] of buckets) {
      if (counter.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  // Never hold the event loop open for a cleanup timer.
  sweepTimer.unref?.();
}

/** Visible for tests: drop all counters. */
export function resetRateLimitState(): void {
  buckets.clear();
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Pure counter step. Exported so the window arithmetic is testable without an
 * HTTP layer.
 */
export function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitDecision {
  if (limit <= 0 || windowSeconds <= 0) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
  }
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

function clientKey(req: Request): string {
  // req.ip honours the app's trust-proxy setting (TRUST_PROXY env). Behind a
  // proxy with TRUST_PROXY unset every caller collapses to one key — that is a
  // deployment error, not a silent degradation, so it is logged at boot.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Builds a limiter middleware. `bucket` namespaces the counters so two routes
 * never share a window.
 */
export function rateLimit(options: {
  bucket: string;
  limit: number;
  windowSeconds: number;
  message?: string;
}) {
  ensureSweeper();
  const message = options.message ?? 'تجاوزت الحد المسموح من الطلبات. حاول لاحقاً.';
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!APP_RATE_LIMIT_ENABLED || options.limit <= 0) return next();
    const decision = hitRateLimit(
      `${options.bucket}:${clientKey(req)}`,
      options.limit,
      options.windowSeconds,
    );
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      return res.status(429).json({
        error: message,
        details: { code: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
      });
    }
    return next();
  };
}
