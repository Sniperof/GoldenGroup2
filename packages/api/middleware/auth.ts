import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@golden-crm/shared';
import { JWT_SECRET } from '../config/env.js';

export type { AuthUser };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً' });
  }

  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Legacy guard kept for untouched routes; no new callers should be added.
    if (!req.user) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً' });
      }

      try {
        req.user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
      } catch {
        return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
      }
    }

    if (req.user.isSuperAdmin !== true && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء' });
    }

    next();
  };
}

export { JWT_SECRET };
