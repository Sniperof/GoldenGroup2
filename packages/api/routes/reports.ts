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
import { getBreakdown } from '../services/reporting/breakdownService.js';
import { buildVisibleReportCatalog } from '../services/reporting/tabularReportCatalog.js';
import { exportTabularReportRun, generateTabularReport, getTabularReportRun } from '../services/reporting/tabularReportService.js';

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
  console.error('[reports] request failed:', err);
  res.status(500).json({ error: 'فشل تجهيز بيانات التقرير' });
}

function readTabularParams(req: Request) {
  return {
    branchId: typeof req.query.branchId === 'string' ? req.query.branchId : undefined,
    employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
    geoUnitId: typeof req.query.geoUnitId === 'string' ? req.query.geoUnitId : undefined,
    geoIds: typeof req.query.geoIds === 'string' ? req.query.geoIds : undefined,
    fromDate: typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined,
    toDate: typeof req.query.toDate === 'string' ? req.query.toDate : undefined,
    page: typeof req.query.page === 'string' ? req.query.page : undefined,
    limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
  };
}

// ── كتالوج وتقارير جدولية — قبل /:metricKey حتى لا تُفسّر كأسماء مؤشرات ──
router.get('/catalog', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    res.json({ groups: buildVisibleReportCatalog(authContext) });
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/tabular/:reportKey/generate', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const input = req.body ?? {};
    const data = await generateTabularReport(authContext, req.params.reportKey, {
      branchId: input.branchId, employeeId: input.employeeId, geoUnitId: input.geoUnitId, geoIds: input.geoIds,
      fromDate: input.fromDate, toDate: input.toDate,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/tabular/runs/:runId', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getTabularReportRun(authContext, req.params.runId, readTabularParams(req));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) { handleError(err, res); }
});

router.get('/tabular/runs/:runId/export', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const output = await exportTabularReportRun(authContext, req.params.runId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${output.filename}"`);
    res.setHeader('X-Report-Exported-At', output.exportedAt.toISOString());
    res.send(output.buffer);
  } catch (err) {
    handleError(err, res);
  }
});

// ── المؤشرات التجميعية (Funnel/Bar/Donut) — مسار مستقل بمقطعين فلا يتصادم مع /:metricKey ──
router.get('/breakdown/:metricKey', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getBreakdown(authContext, req.params.metricKey, readParams(req));
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/breakdown/:metricKey/refresh', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getBreakdown(authContext, req.params.metricKey, { ...readParams(req), forceRefresh: true });
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

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
