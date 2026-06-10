import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthContext } from '@golden-crm/shared';
import { JWT_SECRET, type AuthUser } from './auth.js';
import {
  authorize,
  buildAuthContext,
  clearAuthorizationCache,
  resolveActingBranch,
} from '../services/authorizationService.js';

// DEPRECATED: RequestScope is a legacy compatibility shim populated from AuthContext.
// New code must use req.authContext directly. This interface will be removed once all
// legacy routes (contracts, tasks, departments GET) are migrated to requirePermission.
export interface RequestScope {
  userId: number;
  isSuperAdmin: boolean;
  branchId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
      // DEPRECATED: use req.authContext instead.
      scope?: RequestScope;
    }
  }
}

// DEPRECATED: attachScope exists only to keep legacy routes working during migration.
// Remove once all routes read from req.authContext directly.
function attachScope(req: Request, authContext: AuthContext) {
  req.scope = {
    userId: authContext.userId,
    isSuperAdmin: authContext.isSuperAdmin,
    branchId: authContext.actingBranchId,
  };
}

// Exported so routes that skip requirePermission (e.g. /approve, /reject —
// gated by "either-or" permissions checked inline) can still get the same
// cached AuthContext that the middleware would have built.
export async function getOrBuildAuthContext(req: Request & { user: AuthUser }): Promise<AuthContext> {
  if (req.authContext) {
    return req.authContext;
  }

  const authContext = await buildAuthContext({
    user: req.user,
    headerBranchId: req.header('x-branch-id'),
  });

  req.authContext = authContext;
  attachScope(req, authContext);
  return authContext;
}

function ensureUser(req: Request, res: Response): req is Request & { user: AuthUser } {
  if (req.user) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول أولاً' });
    return false;
  }

  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
    return true;
  } catch {
    res.status(401).json({ error: 'غير مصرح: رمز التحقق غير صالح أو منتهي الصلاحية' });
    return false;
  }
}

export function clearPermissionCache(userId?: number) {
  clearAuthorizationCache(userId);
}

export function requirePermission(...keys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!ensureUser(req, res)) {
      return;
    }

    try {
      const authContext = await getOrBuildAuthContext(req);

      const hasAny = keys.some(key => authorize(authContext, { permission: key }).allowed);
      if (!hasAny) {
        return res.status(403).json({ error: 'غير مسموح: الصلاحيات لا تسمح بهذا الإجراء' });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).json({ error: 'خطأ في التحقق من الصلاحيات' });
    }
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!ensureUser(req, res)) {
    return;
  }

  if (req.user.isSuperAdmin !== true) {
    return res.status(403).json({ error: 'غير مسموح: هذا القسم متاح للإدارة العامة فقط' });
  }

  next();
}

export async function requireNotHQOnly(req: Request, res: Response, next: NextFunction) {
  if (!ensureUser(req, res)) {
    return;
  }

  try {
    const authContext = await getOrBuildAuthContext(req);
    const branchId = authContext.actingBranchId;

    if (branchId == null) {
      return res.status(403).json({
        error: 'هذه الصفحة متاحة على مستوى الفرع فقط. يرجى اختيار فرع فعّال أولاً.',
      });
    }

    attachScope(req, authContext);
    return next();
  } catch (err) {
    console.error('Branch-only guard error:', err);
    return res.status(500).json({ error: 'خطأ في تجهيز سياق التفريع' });
  }
}

// AuthContext is required here because branch authorization must use user_branch_assignments,
// not legacy JWT branch_id.
export function resolveTargetBranchId(
  req: Request,
  res: Response,
  bodyBranchId?: number | string | null,
): number | null {
  if (!req.user) {
    res.status(401).json({ error: 'غير مصرح' });
    return null;
  }

  if (!req.authContext) {
    throw new Error('resolveTargetBranchId called before AuthContext was built');
  }

  const authContext = req.authContext;
  const requestedSource = bodyBranchId ?? req.header('x-branch-id');
  const requestedBranchId = resolveActingBranch({
    headerBranchId: requestedSource,
    primaryBranchId: authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null,
    allowedBranchIds: authContext.allowedBranchIds,
    isSuperAdmin: req.user.isSuperAdmin === true,
  });

  if (req.user.isSuperAdmin === true) {
    if (requestedBranchId == null) {
      res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
      return null;
    }

    return requestedBranchId;
  }

  if (requestedBranchId == null) {
    if (authContext.allowedBranchIds.length === 0) {
      res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع فعّال' });
      return null;
    }

    res.status(403).json({ error: 'لا يمكنك تنفيذ هذه العملية على فرع غير مسموح به' });
    return null;
  }

  return requestedBranchId;
}
