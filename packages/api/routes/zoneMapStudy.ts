import { Router } from 'express';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { toZoneMapWire } from '@golden-crm/shared';
import { requirePermission } from '../middleware/permission.js';
import { getZoneMapStudy, setAreaCenter, ZoneMapValidationError } from '../services/zoneMapStudy.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const gzipAsync = promisify(gzip);

function handleError(err: any, res: import('express').Response) {
  if (err instanceof ZoneMapValidationError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error('Zone map study error:', err);
  return res.status(500).json({ error: err?.message || 'Zone map study failed' });
}

// GET /api/planning/zone-map?date=YYYY-MM-DD — live picture for the planning day.
router.get('/', requirePermission('planning.zone_study.view'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : null;
    const branchId = req.authContext?.actingBranchId ?? null;
    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    // Tens of thousands of tasks on a big branch: compact tuples (shared wire
    // format), gzipped here since the API has no compression middleware.
    const body = JSON.stringify(toZoneMapWire(await getZoneMapStudy({ branchId, date })));
    res.type('application/json');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && body.length > 2048) {
      res.set({ 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return res.send(await gzipAsync(body));
    }
    return res.send(body);
  } catch (err) {
    return handleError(err, res);
  }
});

// PUT /api/planning/zone-map/areas/:geoUnitId/center — body { lat, lng } (both null clears).
router.put('/areas/:geoUnitId/center', requirePermission('planning.zone_study.manage'), async (req, res) => {
  try {
    const branchId = req.authContext?.actingBranchId ?? null;
    const userId = req.authContext?.userId ?? null;
    if (branchId == null) return res.status(400).json({ error: 'A branch context is required' });
    if (userId == null) return res.status(401).json({ error: 'غير مصرح' });
    const lat = req.body?.lat ?? null;
    const lng = req.body?.lng ?? null;
    return res.json(await setAreaCenter({
      branchId,
      geoUnitId: Number(req.params.geoUnitId),
      lat: lat == null ? null : Number(lat),
      lng: lng == null ? null : Number(lng),
      userId,
    }));
  } catch (err) {
    return handleError(err, res);
  }
});

export default router;
