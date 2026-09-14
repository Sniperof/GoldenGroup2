// ============================================================
// dashboardLayout.ts — تخطيط الداشبورد لكل مستخدم (reporting-analytics §6.3)
// ============================================================
//   GET /api/me/dashboard-layout  — تخطيط المستخدم الحالي (مصفوفة widgets).
//   PUT /api/me/dashboard-layout  — حفظ التخطيط (إضافة/حذف/ترتيب).
// كل مستخدم يملك صفًا واحدًا (user_id PK). مُركّب خلف requireAuth في index.ts.
// ============================================================

import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../middleware/auth.js';
import { getOrBuildAuthContext } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import { resolveEffectiveScope } from '../services/reporting/metricsService.js';
import { DashboardLayoutValidationError, normalizeDashboardLayout } from '../services/reporting/dashboardLayoutPolicy.js';
import pool from '../db.js';

const router = Router();

function normalizeForUser(authContext: Awaited<ReturnType<typeof getOrBuildAuthContext>>, input: unknown, strict: boolean) {
  return normalizeDashboardLayout(input, (permission, branchId) => {
    const plan = resolveListAccessScope(authContext, permission);
    if (plan.scope === 'NONE') {
      throw new DashboardLayoutValidationError(403, 'لا تملك صلاحية عرض أحد المؤشرات المختارة');
    }
    if (branchId != null) {
      try {
        resolveEffectiveScope({ scope: plan.scope, allowedBranchIds: plan.allowedBranchIds }, { preset: 'month', branchId });
      } catch {
        throw new DashboardLayoutValidationError(403, 'لا يمكنك تثبيت مؤشر على فرع غير مسموح');
      }
    }
  }, strict);
}

router.get('/dashboard-layout', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const { rows } = await pool.query(
      'SELECT layout FROM user_dashboard_layouts WHERE user_id = $1 LIMIT 1',
      [authContext.userId],
    );
    const customized = rows.length > 0;
    res.json({ layout: normalizeForUser(authContext, rows[0]?.layout ?? [], false), customized });
  } catch (err) {
    console.error('[dashboard-layout] load failed:', err);
    res.status(500).json({ error: 'فشل تحميل تخطيط الداشبورد' });
  }
});

router.put('/dashboard-layout', async (req: Request, res: Response) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const layout = normalizeForUser(authContext, req.body?.layout, true);
    await pool.query(
      `INSERT INTO user_dashboard_layouts (user_id, layout, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
      [authContext.userId, JSON.stringify(layout)],
    );
    res.json({ layout, customized: true });
  } catch (err) {
    console.error('[dashboard-layout] save failed:', err);
    if (err instanceof DashboardLayoutValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'فشل حفظ تخطيط الداشبورد' });
  }
});

export default router;
