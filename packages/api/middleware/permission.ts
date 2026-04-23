import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { JWT_SECRET, type AuthUser } from './auth.js';

/**
 * Branch scope attached to the request after auth.
 * - isSuperAdmin=true → read anything, write anywhere (must still pass an
 *   explicit targetBranchId for writes; repositories enforce this).
 * - isSuperAdmin=false → every branch-scoped query MUST filter by branchId,
 *   and writes MUST target branchId.
 */
export interface RequestScope {
  userId: number;
  isSuperAdmin: boolean;
  branchId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      scope?: RequestScope;
    }
  }
}

function attachScope(req: Request) {
  if (!req.user) return;
  req.scope = {
    userId: req.user.id,
    isSuperAdmin: req.user.isSuperAdmin === true,
    branchId: req.user.branchId ?? null,
  };
}

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
    attachScope(req);

    try {
      // Super admin bypasses permission checks (HQ oversees everything).
      if (req.user.isSuperAdmin === true) return next();

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

/**
 * Route guard: only super admins pass.
 * Use on HQ-only routes (branches CRUD, system_lists, geo_units, role templates).
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
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
  attachScope(req);
  if (req.user.isSuperAdmin !== true) {
    return res.status(403).json({ error: 'غير مسموح: هذا القسم متاح للإدارة العامة فقط' });
  }
  next();
}

/**
 * Route guard: rejects super admins who have NOT selected a branch context.
 * Use on branch-only routes (tasks, appointments, planning, operations) that
 * have no meaning at HQ level.
 *
 * Branch-bound users always pass.
 * Super admins pass only if they supply X-Branch-Id (i.e. they've switched
 * into a specific branch's context via the branch switcher).
 */
export function requireNotHQOnly(req: Request, res: Response, next: NextFunction) {
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
  attachScope(req);

  // Branch-bound users always allowed
  if (req.user.isSuperAdmin !== true) return next();

  // Super admin must have selected a branch via X-Branch-Id header
  const headerId = Number(req.header('x-branch-id'));
  if (Number.isFinite(headerId) && headerId > 0) {
    // Override scope.branchId so downstream handlers can rely on it
    if (req.scope) req.scope.branchId = headerId;
    return next();
  }

  return res.status(403).json({
    error: 'هذه الصفحة متاحة على مستوى الفرع فقط — يرجى اختيار فرع من محوّل الفروع',
  });
}

/**
 * Resolve the effective target branch for a write operation.
 *
 * - Branch users can only write to their own branch; supplying any other
 *   branchId returns 403.
 * - Super admins must specify a target branchId explicitly (header
 *   X-Branch-Id or request body `branchId`), otherwise we return 400.
 *
 * Returns the numeric branch id to use, or `null` if the request already
 * failed with a response (caller should stop).
 */
export function resolveTargetBranchId(
  req: Request,
  res: Response,
  bodyBranchId?: number | string | null,
): number | null {
  if (!req.scope) attachScope(req);
  const scope = req.scope;
  if (!scope) {
    res.status(401).json({ error: 'غير مصرح' });
    return null;
  }

  const headerId = Number(req.header('x-branch-id'));
  const bodyId   = bodyBranchId != null ? Number(bodyBranchId) : NaN;
  const requested = Number.isFinite(bodyId) && bodyId > 0
    ? bodyId
    : (Number.isFinite(headerId) && headerId > 0 ? headerId : null);

  if (scope.isSuperAdmin) {
    if (requested == null) {
      res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
      return null;
    }
    return requested;
  }

  // Branch-bound user
  if (scope.branchId == null) {
    res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
    return null;
  }
  if (requested != null && requested !== scope.branchId) {
    res.status(403).json({ error: 'لا يمكنك تنفيذ هذه العملية على فرع آخر' });
    return null;
  }
  return scope.branchId;
}
