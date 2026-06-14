import { Router } from 'express';
import type { ZoneStudyMode } from '@golden-crm/shared';
import { requirePermission } from '../middleware/permission.js';
import {
  getOrCreateSnapshot,
  refreshSnapshot,
  pickZone,
  unpickZone,
  ZoneStudyFrozenError,
  ZoneStudyConflictError,
  ZoneStudyValidationError,
} from '../services/zoneStudy.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null;
}
function parseMode(value: unknown): ZoneStudyMode | null {
  return value === 'auto' || value === 'manual' ? value : null;
}

function handleError(err: any, res: import('express').Response) {
  if (err instanceof ZoneStudyFrozenError) {
    return res.status(403).json({ error: err.message, code: err.code });
  }
  if (err instanceof ZoneStudyConflictError) {
    return res.status(409).json({ error: err.message, code: err.code });
  }
  if (err instanceof ZoneStudyValidationError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error('Zone study error:', err);
  return res.status(500).json({ error: err?.message || 'Zone study failed' });
}

// GET /api/planning/zone-study?date=YYYY-MM-DD&mode=auto|manual
router.get('/', requirePermission('planning.zone_study.view'), async (req, res) => {
  try {
    const date = parseDate(req.query.date);
    const mode = parseMode(req.query.mode);
    const branchId = req.authContext?.actingBranchId ?? null;
    const userId = req.authContext?.userId ?? null;

    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!mode) return res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    if (userId == null) return res.status(401).json({ error: 'غير مصرح' });

    const result = await getOrCreateSnapshot({ date, branchId, mode, userId });
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
});

// POST /api/planning/zone-study/refresh?date=YYYY-MM-DD&mode=auto|manual
router.post('/refresh', requirePermission('planning.zone_study.manage'), async (req, res) => {
  try {
    const date = parseDate(req.query.date);
    const mode = parseMode(req.query.mode);
    const branchId = req.authContext?.actingBranchId ?? null;
    const userId = req.authContext?.userId ?? null;

    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!mode) return res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    if (userId == null) return res.status(401).json({ error: 'غير مصرح' });

    const result = await refreshSnapshot({ date, branchId, mode, userId });
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
});

// POST /api/planning/zone-study/manual/pick?date=YYYY-MM-DD  body: { zoneId }
router.post('/manual/pick', requirePermission('planning.zone_study.manage'), async (req, res) => {
  try {
    const date = parseDate(req.query.date);
    const branchId = req.authContext?.actingBranchId ?? null;
    const userId = req.authContext?.userId ?? null;
    const zoneId = Number(req.body?.zoneId);

    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    if (userId == null) return res.status(401).json({ error: 'غير مصرح' });
    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return res.status(400).json({ error: 'zoneId is required' });
    }

    const result = await pickZone({ date, branchId, userId, zoneId });
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
});

// DELETE /api/planning/zone-study/manual/pick/:zoneId?date=YYYY-MM-DD
router.delete('/manual/pick/:zoneId', requirePermission('planning.zone_study.manage'), async (req, res) => {
  try {
    const date = parseDate(req.query.date);
    const branchId = req.authContext?.actingBranchId ?? null;
    const userId = req.authContext?.userId ?? null;
    const zoneId = Number(req.params.zoneId);

    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    if (userId == null) return res.status(401).json({ error: 'غير مصرح' });
    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return res.status(400).json({ error: 'zoneId is required' });
    }

    const result = await unpickZone({ date, branchId, userId, zoneId });
    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
});

export default router;
