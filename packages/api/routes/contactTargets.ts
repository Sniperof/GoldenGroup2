import { Router } from 'express';
import pool from '../db.js';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';

const ACTIVE_OPEN_TASK_STATUSES = ['open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended'];

const router = Router();

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

const marketingTargetSelect = `
  SELECT
    ct.id AS "contactTargetId",
    ct.branch_id AS "branchId",
    ct.target_id AS "clientId",
    c.name AS "customerName",
    COALESCE(
      NULLIF((
        SELECT contact->>'number'
        FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
        WHERE COALESCE((contact->>'isPrimary')::boolean, FALSE) = TRUE
        LIMIT 1
      ), ''),
      NULLIF(c.mobile, ''),
      (
        SELECT contact->>'number'
        FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
        WHERE NULLIF(contact->>'number', '') IS NOT NULL
        LIMIT 1
      ),
      '--'
    ) AS phone,
    ct.supervisor_hr_user_id AS "supervisorHrUserId",
    supervisor.employee_id AS "supervisorEmployeeId",
    supervisor.name AS "supervisorName",
    assignment_supervisors.supervisors AS supervisors,
    ct.zone_id AS "zoneId",
    zone.name AS "zoneName",
    COALESCE(route_match."routeName", '-') AS "routeName",
    ct.status,
    ct.latest_call_outcome AS "latestCallOutcome",
    latest_appointment."latestAppointment",
    ct.created_at AS "createdAt",
    ct.updated_at AS "updatedAt",
    ${buildCustomerOwnershipSelectColumns()}
  FROM contact_targets ct
  JOIN clients c ON c.id = ct.target_id
  LEFT JOIN branches b ON b.id = ct.branch_id
  LEFT JOIN branches cb ON cb.id = c.branch_id
  LEFT JOIN hr_users supervisor ON supervisor.id = ct.supervisor_hr_user_id
  LEFT JOIN geo_units zone ON zone.id = ct.zone_id
  ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'hrUserId', assigned_supervisor.id,
          'employeeId', assigned_supervisor.employee_id,
          'name', assigned_supervisor.name
        )
        ORDER BY ca.assigned_at ASC, ca.id ASC
      ),
      '[]'::json
    ) AS supervisors
    FROM client_assignments ca
    JOIN hr_users assigned_supervisor ON assigned_supervisor.id = ca.hr_user_id
    WHERE ca.client_id = c.id
  ) assignment_supervisors ON TRUE
  LEFT JOIN LATERAL (
    SELECT r.name AS "routeName"
    FROM route_points rp
    JOIN routes r ON r.id = rp.route_id
    WHERE rp.geo_unit_id = ct.zone_id
    ORDER BY r.id ASC
    LIMIT 1
  ) route_match ON TRUE
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', a.id,
      'date', a.date,
      'timeSlot', a.time_slot,
      'teamKey', a.team_key
    ) AS "latestAppointment"
    FROM telemarketing_appointments a
    WHERE a.entity_type = 'client'
      AND a.entity_id = c.id
      AND a.branch_id = ct.branch_id
    ORDER BY a.created_at DESC
    LIMIT 1
  ) latest_appointment ON TRUE
  WHERE ct.branch_id = $1
    AND ct.target_type = 'client'
    AND ct.target_stage = 'lead'
    AND ct.visit_type = 'marketing'
    AND ct.source_type = 'lead'
    AND c.is_candidate = FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM contracts contract
      WHERE contract.customer_id = c.id
    )
    AND EXISTS (
      SELECT 1
      FROM open_tasks ot
      WHERE ot.client_id = c.id
        AND ot.status = ANY($2::varchar[])
    )
    AND NOT EXISTS (
      SELECT 1
      FROM visits visit
      WHERE visit.customer_id = c.id
    )
  ORDER BY c.id
`;

router.get('/marketing', async (req, res) => {
  const branchId = getBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
  return res.json(rows.map((row: any) => ({ ...row, ownership: mapCustomerOwnership(row) })));
});

router.post('/marketing/sync', async (req, res) => {
  const branchId = getBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  await pool.query(
    `
      INSERT INTO contact_targets (
        branch_id,
        target_type,
        target_id,
        target_stage,
        visit_type,
        source_type,
        source_id,
        supervisor_hr_user_id,
        zone_id,
        status
      )
      SELECT
        c.branch_id,
        'client',
        c.id,
        'lead',
        'marketing',
        'lead',
        c.id,
        assignment.hr_user_id,
        CASE
          WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$' THEN c.neighborhood::int
          ELSE NULL
        END,
        'new'
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT ca.hr_user_id
        FROM client_assignments ca
        WHERE ca.client_id = c.id
        ORDER BY ca.assigned_at ASC, ca.id ASC
        LIMIT 1
      ) assignment ON TRUE
      WHERE c.branch_id = $1
        AND c.is_candidate = FALSE
        AND NOT EXISTS (
          SELECT 1
          FROM contracts contract
          WHERE contract.customer_id = c.id
        )
        AND EXISTS (
          SELECT 1
          FROM open_tasks ot
          WHERE ot.client_id = c.id
            AND ot.status = ANY(ARRAY['open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended']::varchar[])
        )
        AND NOT EXISTS (
          SELECT 1
          FROM visits visit
          WHERE visit.customer_id = c.id
        )
      ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type)
      DO UPDATE SET
        supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
        zone_id = EXCLUDED.zone_id,
        source_id = EXCLUDED.source_id,
        updated_at = NOW()
    `,
    [branchId],
  );

  const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
  return res.json({ targets: rows.map((row: any) => ({ ...row, ownership: mapCustomerOwnership(row) })), count: rows.length });
});

export default router;
