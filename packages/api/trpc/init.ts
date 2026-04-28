import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import type { AuthContext, AuthUser } from '@golden-crm/shared';
import { JWT_SECRET } from '../middleware/auth.js';
import { authorize, buildAuthContext } from '../services/authorizationService.js';

export type Context = {
  user: AuthUser | null;
  authContext: AuthContext | null;
  xBranchId: number | null;
};

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  const hb = Number(req.headers['x-branch-id']);
  const xBranchId = Number.isFinite(hb) && hb > 0 ? hb : null;

  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, authContext: null, xBranchId };
  }

  try {
    const user = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthUser;
    return { user, authContext: null, xBranchId };
  } catch {
    return { user: null, authContext: null, xBranchId };
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'غير مصرح: يجب تسجيل الدخول أولاً' });
  }

  return next({ ctx: { user: ctx.user, authContext: ctx.authContext, xBranchId: ctx.xBranchId } });
});

const authedProcedure = t.procedure.use(isAuthed);

export function withPermission(...keys: string[]) {
  return authedProcedure.use(async ({ ctx, next }) => {
    const authContext = await buildAuthContext({
      user: ctx.user,
      headerBranchId: ctx.xBranchId,
    });

    if (!keys.some(key => authorize(authContext, { permission: key }).allowed)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'غير مسموح: صلاحياتك لا تسمح بهذا الإجراء',
      });
    }

    return next({ ctx: { ...ctx, authContext } });
  });
}
