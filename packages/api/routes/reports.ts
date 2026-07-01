// ============================================================
// reports.ts — نقطة الوصول الموحّدة للمؤشرات (reporting-analytics §1.3)
// ============================================================
//   GET  /api/reports/:metricKey            — قيمة المؤشر (من الكاش أو محسوبة).
//   POST /api/reports/:metricKey/refresh     — إعادة حساب يدوية (§7.3).
// التقييد بالنطاق يُفرض داخل metricsService عبر صلاحية المؤشر — لا تقييد يدوي هنا.
// مُركّب خلف requireAuth في index.ts.
// ============================================================

import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../middleware/auth.js';
import { getOrBuildAuthContext } from '../middleware/permission.js';
import { getMetric, ReportingError, type GetMetricParams } from '../services/reporting/metricsService.js';

const router = Router();

function readParams(req: Request): GetMetricParams {
  return {
    preset: typeof req.query.preset === 'string' ? req.query.preset : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    branchId: typeof req.query.branchId === 'string' ? req.query.branchId : undefined,
  };
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof ReportingError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[reports] metric failed:', err);
  res.status(500).json({ error: 'فشل حساب المؤشر' });
}

router.get('/:metricKey', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getMetric(authContext, req.params.metricKey, readParams(req));
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/:metricKey/refresh', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getMetric(authContext, req.params.metricKey, { ...readParams(req), forceRefresh: true });
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

export default router;
