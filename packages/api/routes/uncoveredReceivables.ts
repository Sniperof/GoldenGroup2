// ============================================================
// uncoveredReceivables.ts — «ذمم بلا مهمة تحصيل» (detection + manual create)
// ============================================================
//   GET  /api/receivables/uncovered          tasks.collection.view  paged list + summary
//   GET  /api/receivables/uncovered/summary  tasks.collection.view  totals only (client indicator)
//   POST /api/receivables/uncovered/tasks    open_tasks.edit        create collection tasks (≤50)
//
// Read scope follows the «تحصيل الذمم» table's own key (tasks.collection.view):
// GLOBAL → every branch (optionally narrowed by ?branchId / X-Branch-Id),
// BRANCH → the caller's assigned branches. Create re-checks open_tasks.edit on
// each installment's own branch (canEditOpenTask), like the manual create route.
// ============================================================

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import {
  UNCOVERED_CREATE_BATCH_LIMIT,
  UNCOVERED_KINDS,
  UNCOVERED_REASONS,
  createTasksForUncovered,
  getUncoveredSummary,
  listUncoveredReceivables,
  type UncoveredFilters,
  type UncoveredReason,
} from '../services/uncoveredReceivables.js';
import type { InstallmentKind } from '../services/installmentCollectionTasks.js';

const router = Router();
router.use(requireAuth);

const READ_KEY = 'tasks.collection.view';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Resolves the caller's scope + filters; returns an error tuple when refused. */
function resolveRequest(req: any): { error?: { status: number; message: string }; plan?: any; filters?: UncoveredFilters } {
  const plan = resolveListAccessScope(req.authContext!, READ_KEY);
  if (plan.scope === 'NONE') return { error: { status: 403, message: 'ليس لديك صلاحية عرض ذمم التحصيل' } };
  if (plan.scope !== 'GLOBAL' && (plan.allowedBranchIds ?? []).length === 0) {
    return { error: { status: 403, message: 'لا يوجد فرع متاح' } };
  }
  const requested = Number(req.query.branchId ?? req.header('x-branch-id'));
  const branchId = Number.isInteger(requested) && requested > 0 ? requested : null;
  if (branchId && plan.scope !== 'GLOBAL' && !plan.allowedBranchIds.includes(branchId)) {
    return { error: { status: 403, message: 'ليس لديك صلاحية الوصول لهذا الفرع' } };
  }
  const kind = str(req.query.kind) as InstallmentKind;
  const reason = str(req.query.reason) as UncoveredReason;
  const dueFrom = str(req.query.dueFrom);
  const dueTo = str(req.query.dueTo);
  const clientId = Number(req.query.clientId);
  return {
    plan,
    filters: {
      branchId,
      kind: UNCOVERED_KINDS.includes(kind) ? kind : null,
      reason: UNCOVERED_REASONS.includes(reason) ? reason : null,
      overdueOnly: req.query.overdueOnly === 'true' || req.query.overdueOnly === '1',
      dueFrom: DATE_RE.test(dueFrom) ? dueFrom : null,
      dueTo: DATE_RE.test(dueTo) ? dueTo : null,
      search: str(req.query.search).slice(0, 100) || null,
      clientId: Number.isInteger(clientId) && clientId > 0 ? clientId : null,
    },
  };
}

router.get('/uncovered', requirePermission(READ_KEY), async (req, res) => {
  try {
    const { error, plan, filters } = resolveRequest(req);
    if (error) return res.status(error.status).json({ error: error.message });
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(req.query.pageSize ?? req.query.limit) || 25)));
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';
    return res.json(await listUncoveredReceivables(pool, plan, filters!, { page, pageSize, sortDir }));
  } catch (err: any) {
    console.error('[receivables] GET /uncovered failed:', err);
    return res.status(500).json({ error: 'فشل تحميل الذمم بلا مهمة تحصيل' });
  }
});

router.get('/uncovered/summary', requirePermission(READ_KEY), async (req, res) => {
  try {
    const { error, plan, filters } = resolveRequest(req);
    if (error) return res.status(error.status).json({ error: error.message });
    const { listTotal: _t, listAmountSyp: _a, ...summary } = await getUncoveredSummary(pool, plan, filters!);
    return res.json(summary);
  } catch (err: any) {
    console.error('[receivables] GET /uncovered/summary failed:', err);
    return res.status(500).json({ error: 'فشل تحميل ملخص الذمم بلا مهمة تحصيل' });
  }
});

router.post('/uncovered/tasks', requirePermission('open_tasks.edit'), async (req, res) => {
  const raw = Array.isArray(req.body?.items) ? req.body.items : [];
  const seen = new Set<string>();
  const items: Array<{ kind: InstallmentKind; installmentId: number }> = [];
  for (const it of raw) {
    const kind = it?.kind as InstallmentKind;
    const installmentId = Number(it?.installmentId);
    if (!UNCOVERED_KINDS.includes(kind) || !Number.isInteger(installmentId) || installmentId <= 0) {
      return res.status(400).json({ error: 'عنصر غير صالح — المطلوب kind و installmentId' });
    }
    const key = `${kind}:${installmentId}`;
    if (!seen.has(key)) { seen.add(key); items.push({ kind, installmentId }); }
  }
  if (items.length === 0) return res.status(400).json({ error: 'لم يُحدَّد أي قسط' });
  if (items.length > UNCOVERED_CREATE_BATCH_LIMIT) {
    return res.status(400).json({ error: `الحد الأقصى ${UNCOVERED_CREATE_BATCH_LIMIT} قسطاً في المرة الواحدة` });
  }
  try {
    const results = await createTasksForUncovered(() => pool.connect(), req.authContext!, items);
    const created = results.filter((r) => r.status === 'created').length;
    return res.json({ created, skipped: results.length - created, results });
  } catch (err: any) {
    console.error('[receivables] POST /uncovered/tasks failed:', err);
    return res.status(500).json({ error: 'فشل إنشاء مهام التحصيل' });
  }
});

export default router;
