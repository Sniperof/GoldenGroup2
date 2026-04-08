import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';
import { loadPermissions } from '../middleware/permission.js';
import type { AuthUser } from '@golden-crm/shared';

// ── Context ────────────────────────────────────────────────────────────────

export type Context = {
  user: AuthUser | null;
};

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return { user: null };
  try {
    const user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
    return { user };
  } catch {
    return { user: null };
  }
}

// ── tRPC instance ──────────────────────────────────────────────────────────

const t = initTRPC.context<Context>().create();

export const router = t.router;

// ── Reusable procedure builders ────────────────────────────────────────────

/** Requires a valid JWT — throws UNAUTHORIZED otherwise. */
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'غير مصرح: يجب تسجيل الدخول أولاً' });
  }
  return next({ ctx: { user: ctx.user } });
});

const authedProcedure = t.procedure.use(isAuthed);

/**
 * Returns a procedure that requires the caller to hold at least one of the
 * given permission keys.  Reuses the same DB-backed cache as the existing
 * Express `requirePermission` middleware.
 */
export function withPermission(...keys: string[]) {
  return authedProcedure.use(async ({ ctx, next }) => {
    const perms = await loadPermissions(ctx.user.id);
    if (!keys.some(k => perms.has(k))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء',
      });
    }
    return next({ ctx });
  });
}
