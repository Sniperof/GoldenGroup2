import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validateRouteAssignmentPayload(body: any): { ok: true; routes: any[]; extraZones: number[] } | { ok: false; error: string } {
  const routes = body?.routes ?? [];
  const extraZones = body?.extraZones ?? [];

  if (!Array.isArray(routes)) {
    return { ok: false, error: 'routes must be an array' };
  }

  if (!Array.isArray(extraZones)) {
    return { ok: false, error: 'extraZones must be an array' };
  }

  const seenRouteIds = new Set<number>();
  for (let index = 0; index < routes.length; index += 1) {
    const comp = routes[index];
    if (!comp || typeof comp !== 'object' || Array.isArray(comp)) {
      return { ok: false, error: `Route composition ${index + 1} is invalid` };
    }

    if (!isPositiveInteger(comp.routeId)) {
      return { ok: false, error: `Route composition ${index + 1} must include a valid routeId` };
    }

    if (seenRouteIds.has(comp.routeId)) {
      return { ok: false, error: `Route ${comp.routeId} is duplicated in this work coverage` };
    }
    seenRouteIds.add(comp.routeId);

    if (!isNonNegativeInteger(comp.startIdx) || !isNonNegativeInteger(comp.endIdx)) {
      return { ok: false, error: `Route composition ${index + 1} must include valid startIdx and endIdx` };
    }

    if (comp.startIdx > comp.endIdx) {
      return { ok: false, error: `Route composition ${index + 1} has startIdx greater than endIdx` };
    }

    if (comp.direction !== 'forward' && comp.direction !== 'reverse') {
      return { ok: false, error: `Route composition ${index + 1} has invalid direction` };
    }
  }

  const seenExtraZones = new Set<number>();
  for (const zoneId of extraZones) {
    if (!isPositiveInteger(zoneId)) {
      return { ok: false, error: 'extraZones must contain valid geo unit ids' };
    }

    if (seenExtraZones.has(zoneId)) {
      return { ok: false, error: `Extra zone ${zoneId} is duplicated in this work coverage` };
    }
    seenExtraZones.add(zoneId);
  }

  return { ok: true, routes, extraZones };
}

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments');
  const result: Record<string, any> = {};
  rows.forEach((r: any) => {
    result[r.key] = { routes: r.routes, extraZones: r.extra_zones };
  });
  res.json(result);
});

router.get('/:key', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments WHERE key = $1', [req.params.key]);
  if (rows.length > 0) {
    res.json({ routes: rows[0].routes, extraZones: rows[0].extra_zones });
  } else {
    res.json({ routes: [], extraZones: [] });
  }
});

router.put('/:key', async (req, res) => {
  const validation = validateRouteAssignmentPayload(req.body);
  if (validation.ok === false) {
    return res.status(400).json({ error: validation.error });
  }

  const { rows } = await pool.query(
    `INSERT INTO route_assignments (key, routes, extra_zones) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET routes=$2, extra_zones=$3 RETURNING *`,
    [req.params.key, JSON.stringify(validation.routes), JSON.stringify(validation.extraZones)]
  );
  res.json({ routes: rows[0].routes, extraZones: rows[0].extra_zones });
});

export default router;
