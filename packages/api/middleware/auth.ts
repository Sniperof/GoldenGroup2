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
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If req.user is not set yet, try to parse the JWT first
    if (!req.user) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً' });
      }
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
        req.user = payload;
      } catch {
        return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
      }
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء' });
    }
    next();
  };
}

export { JWT_SECRET };
