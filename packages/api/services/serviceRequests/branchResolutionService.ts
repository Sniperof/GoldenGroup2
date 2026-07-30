// ============================================================
// serviceRequests/branchResolutionService.ts
// ============================================================
// Resolves external service-request geography to a single branch when the
// branch coverage model can do so unambiguously.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import pool from '../../db.js';

export type BranchResolutionStatus = 'resolved' | 'ambiguous' | 'no_coverage' | 'missing_geo';

export interface BranchResolutionCandidate {
  branchId: number;
  branchName: string;
}

export interface BranchResolutionResult {
  status: BranchResolutionStatus;
  branchId: number | null;
  geoUnitId: number | null;
  reason: string;
  candidates: BranchResolutionCandidate[];
}

export async function resolveBranchForServiceGeoUnit(
  geoUnitId: number | null | undefined,
  db: Pool | PoolClient = pool,
): Promise<BranchResolutionResult> {
  if (!Number.isInteger(geoUnitId) || Number(geoUnitId) <= 0) {
    return {
      status: 'missing_geo',
      branchId: null,
      geoUnitId: null,
      reason: 'No valid geo unit was supplied with the request.',
      candidates: [],
    };
  }

  const resolvedGeoUnitId = Number(geoUnitId);
  const { rows } = await db.query<BranchResolutionCandidate>(
    `
    WITH RECURSIVE
      selected AS (
        SELECT id, parent_id
          FROM public.geo_units
         WHERE id = $1
      ),
      ancestors AS (
        SELECT id, parent_id FROM selected
        UNION ALL
        SELECT g.id, g.parent_id
          FROM public.geo_units g
          JOIN ancestors a ON a.parent_id = g.id
      ),
      descendants AS (
        SELECT id, parent_id FROM selected
        UNION ALL
        SELECT g.id, g.parent_id
          FROM public.geo_units g
          JOIN descendants d ON g.parent_id = d.id
      ),
      explicit_coverage AS (
        SELECT b.id AS branch_id,
               b.name AS branch_name,
               bgc.geo_unit_id AS coverage_geo_id
          FROM public.branches b
          JOIN public.branch_geo_coverage bgc ON bgc.branch_id = b.id
         WHERE b.status = 'active'
      ),
      fallback_coverage AS (
        SELECT b.id AS branch_id,
               b.name AS branch_name,
               b.location_geo_id AS coverage_geo_id
          FROM public.branches b
         WHERE b.status = 'active'
           AND b.location_geo_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.branch_geo_coverage bgc WHERE bgc.branch_id = b.id
           )
      ),
      branch_coverage AS (
        SELECT * FROM explicit_coverage
        UNION ALL
        SELECT * FROM fallback_coverage
      )
    SELECT DISTINCT
           branch_id AS "branchId",
           branch_name AS "branchName"
      FROM branch_coverage
     WHERE coverage_geo_id IN (SELECT id FROM ancestors)
        OR coverage_geo_id IN (SELECT id FROM descendants)
     ORDER BY branch_id ASC
    `,
    [resolvedGeoUnitId],
  );

  if (rows.length === 0) {
    return {
      status: 'no_coverage',
      branchId: null,
      geoUnitId: resolvedGeoUnitId,
      reason: 'No active branch coverage matched the request geography.',
      candidates: [],
    };
  }

  if (rows.length > 1) {
    return {
      status: 'ambiguous',
      branchId: null,
      geoUnitId: resolvedGeoUnitId,
      reason: 'More than one active branch matched the request geography.',
      candidates: rows,
    };
  }

  return {
    status: 'resolved',
    branchId: rows[0].branchId,
    geoUnitId: resolvedGeoUnitId,
    reason: 'Resolved from branch geographic coverage.',
    candidates: rows,
  };
}
