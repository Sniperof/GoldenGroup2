import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { JWT_SECRET, type AuthUser } from './auth.js';

// In-memory cache: userId → { permissions: Set<string>, loadedAt: number }
const cache = new Map<number, { permissions: Set<string>; loadedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function loadPermissions(userId: number): Promise<Set<string>> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) return cached.permissions;

  const { rows } = await pool.query(
    `SELECT p.key FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     JOIN hr_users u ON u.role_id = rp.role_id
     WHERE u.id = $1`,
    [userId]
  );
  const perms = new Set(rows.map((r: any) => r.key as string));
  cache.set(userId, { permissions: perms, loadedAt: Date.now() });
  return perms;
}

export function clearPermissionCache(userId?: number) {
  if (userId != null) cache.delete(userId);
  else cache.clear();
}

export function requirePermission(...keys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Parse JWT if not already done
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

    try {
      const perms = await loadPermissions(req.user.id);
      const hasAny = keys.some(k => perms.has(k));
      if (!hasAny) {
        return res.status(403).json({ error: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء' });
      }
      next();
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).json({ error: 'خطأ في التحقق من الصلاحيات' });
    }
  };
}
