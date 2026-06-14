import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@golden-crm/shared';
import { JWT_SECRET } from '../config/env.js';
import { loadSessionUserFromToken, SessionUserError } from '../services/sessionUserService.js';

export type { AuthUser };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function sendSessionUserError(res: Response, err: unknown): boolean {
  if (!(err instanceof SessionUserError)) {
    return false;
  }

  const status = err.code === 'USER_INACTIVE' ? 403 : 401;
  res.status(status).json({ error: err.message });
  return true;
}

async function loadUserFromAuthorizationHeader(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new SessionUserError('INVALID_TOKEN_USER', 'غير مصرح: يجب تسجيل الدخول أولاً');
  }

  const tokenUser = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
  return loadSessionUserFromToken(tokenUser);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    req.user = await loadUserFromAuthorizationHeader(req);
    return next();
  } catch (err) {
    if (sendSessionUserError(res, err)) return;
    return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Legacy guard kept for untouched routes; no new callers should be added.
    if (!req.user) {
      try {
        req.user = await loadUserFromAuthorizationHeader(req);
      } catch (err) {
        if (sendSessionUserError(res, err)) return;
        return res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
      }
    }

    if (req.user.isSuperAdmin !== true && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء' });
    }

    return next();
  };
}

export { JWT_SECRET };
