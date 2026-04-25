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
    return res.status(401).json({ error: 'ØºÙŠØ± Ù…ØµØ±Ø­: ÙŠØ¬Ø¨ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø£ÙˆÙ„Ø§Ù‹' });
  }

  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: 'ØºÙŠØ± Ù…ØµØ±Ø­: Ø±Ù…Ø² Ø§Ù„ØªØ­Ù‚Ù‚ ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Legacy guard kept for untouched routes; no new callers should be added.
    if (!req.user) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'ØºÙŠØ± Ù…ØµØ±Ø­: ÙŠØ¬Ø¨ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø£ÙˆÙ„Ø§Ù‹' });
      }

      try {
        req.user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
      } catch {
        return res.status(401).json({ error: 'ØºÙŠØ± Ù…ØµØ±Ø­: Ø±Ù…Ø² Ø§Ù„ØªØ­Ù‚Ù‚ ØºÙŠØ± ØµØ§Ù„Ø­ Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©' });
      }
    }

    if (req.user.isSuperAdmin !== true && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­: ØµÙ„Ø§Ø­ÙŠØ§ØªÙƒ Ù„Ø§ ØªØ³Ù…Ø­ Ø¨Ù‡Ø°Ø§ Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡' });
    }

    next();
  };
}

export { JWT_SECRET };
