import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request audit context read by the database triggers that own the task
 * activity log (migration 475). db.ts copies it onto every pooled connection
 * as `app.actor_id`, `app.actor_role`, `app.change_context`,
 * `app.reference_id` and `app.change_reason` before handing the connection
 * out. Outside a request (CRON, boot jobs) everything is empty and the
 * triggers attribute the change to role 'system'.
 */
export interface AuditContext {
  actorId?: number | null;
  actorRole?: string | null;
  changeContext?: string | null;
  referenceId?: number | null;
  changeReason?: string | null;
}

const storage = new AsyncLocalStorage<AuditContext>();

/** Opens a mutable audit context for the request; auth fills in the actor. */
export function auditContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  storage.run({}, next);
}

export function setAuditActor(actorId: number | null | undefined, actorRole: string | null | undefined) {
  const store = storage.getStore();
  if (!store) return;
  store.actorId = actorId ?? null;
  store.actorRole = actorRole ?? null;
}

/**
 * Runs `fn` with extra change context (e.g. 'visit_result', 'result_edit').
 * The actor of the surrounding request is kept. Only connections acquired
 * inside `fn` carry the context.
 */
export function runWithChangeContext<T>(
  change: Pick<AuditContext, 'changeContext' | 'referenceId' | 'changeReason'>,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...change }, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

/** Ordered values for the `app.*` settings; '' clears a setting. */
export function auditSettingValues(context: AuditContext | undefined): [string, string, string, string, string] {
  return [
    context?.actorId != null ? String(context.actorId) : '',
    context?.actorRole ?? '',
    context?.changeContext ?? '',
    context?.referenceId != null ? String(context.referenceId) : '',
    context?.changeReason ?? '',
  ];
}
