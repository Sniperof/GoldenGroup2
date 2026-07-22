// ============================================================
// middleware/appAuth.ts
// ============================================================
// Customer-app bearer auth. Verifies the app access token AND re-checks
// app_accounts.status on every call (DEC-013 §7) so a suspend takes effect
// immediately, not only at token expiry. 401 = auth/expired (mobile refreshes);
// 403 suspended = drop to visitor.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AppAccountClaims } from '../services/appAccounts/appAuthService.js';

declare global {
  namespace Express {
    interface Request {
      appAccount?: AppAccountClaims;
    }
  }
}

export async function requireAppAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يلزم تسجيل الدخول' });
  }
  try {
    req.appAccount = await verifyAccessToken(header.slice(7));
    next();
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('App auth error:', err);
    return res.status(500).json({ error: 'خطأ في التحقق من الجلسة' });
  }
}
