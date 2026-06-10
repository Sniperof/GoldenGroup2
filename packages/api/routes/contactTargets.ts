import { Router } from 'express';
import pool from '../db.js';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';
import { getSystemSettingNumber } from '../services/systemSettings.js';

const ACTIVE_OPEN_TASK_STATUSES = ['open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended'];

// DEC-005 D26 closing_reason vocabulary (mirrored from migration 224 COMMENT)
const ALLOWED_CLOSING_REASONS = new Set([
  'booked',
  'manual_telemarketer',
  'manual_supervisor',
  'auto_closed_by_cron',
  'cooldown_set',
]);

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
  -- Plan 2026-06-10 Phase 2.1 — read "latest appointment" from field_visits
  -- (origin_type='telemarketing') instead of the legacy telemarketing_appointments
  -- table. The 3 historic rows were migrated to field_visits in Phase 0
  -- (migration 270) so this LATERAL is now the single source of truth.
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', fv.id,
      'date', fv.scheduled_date,
      'timeSlot', fv.scheduled_time,
      'teamKey', fv.team_snapshot->>'teamKey'
    ) AS "latestAppointment"
    FROM field_visits fv
    WHERE fv.origin_type = 'telemarketing'
      AND fv.client_id = c.id
      AND fv.branch_id = ct.branch_id
    ORDER BY fv.created_at DESC
    LIMIT 1
  ) latest_appointment ON TRUE
  WHERE ct.branch_id = $1
    AND ct.target_type = 'client'
    -- DEC-005 D30: target_stage / source_type dropped (or CHECK-pinned to 'lead').
    AND ct.visit_type = 'marketing'
    AND c.is_candidate = FALSE
    -- DEC-005 D-customer-filters: cooldown + do_not_contact
    AND c.do_not_contact = FALSE
    AND (c.cooldown_until IS NULL OR c.cooldown_until < CURRENT_DATE)
    AND EXISTS (
      SELECT 1
      FROM open_tasks ot
      WHERE ot.client_id = c.id
        AND ot.status = ANY($2::varchar[])
    )
    -- DEC-005 section 4: NOT EXISTS contracts filter removed (wrong assumption —
    --   clients with contracts can still have open marketing tasks for new devices)
    -- DEC-005 section 4: NOT EXISTS visits (legacy) filter removed (the legacy
    --   visits table will be dropped in Phase 9; D23 governs field_visits filtering)
  ORDER BY c.id
`;

/**
 * @swagger
 * components:
 *   schemas:
 *     ContactTarget:
 *       type: object
 *       properties:
 *         contactTargetId:
 *           type: integer
 *         branchId:
 *           type: integer
 *         clientId:
 *           type: integer
 *         customerName:
 *           type: string
 *         phone:
 *           type: string
 *         supervisorHrUserId:
 *           type: integer
 *         supervisorEmployeeId:
 *           type: string
 *         supervisorName:
 *           type: string
 *         supervisors:
 *           type: array
 *           items:
 *             type: object
 *         zoneId:
 *           type: integer
 *         zoneName:
 *           type: string
 *         routeName:
 *           type: string
 *         status:
 *           type: string
 *         latestCallOutcome:
 *           type: string
 *         latestAppointment:
 *           type: object
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         ownership:
 *           type: object
 */

/**
 * @swagger
 * /api/contact-targets/marketing:
 *   get:
 *     tags: [Contact Targets]
 *     summary: Retrieve marketing contact targets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ContactTarget'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/marketing', async (req, res) => {
  const branchId = getBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
  return res.json(rows.map((row: any) => ({ ...row, ownership: mapCustomerOwnership(row) })));
});

/**
 * @swagger
 * /api/contact-targets/marketing/sync:
 *   post:
 *     tags: [Contact Targets]
 *     summary: Sync marketing contact targets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 targets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ContactTarget'
 *                 count:
 *                   type: integer
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
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
        -- clients.neighborhood is INTEGER; NULL is fine here.
        c.neighborhood,
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
        -- DEC-005 D-customer-filters
        AND c.do_not_contact = FALSE
        AND (c.cooldown_until IS NULL OR c.cooldown_until < CURRENT_DATE)
        AND EXISTS (
          SELECT 1
          FROM open_tasks ot
          WHERE ot.client_id = c.id
            AND ot.status = ANY(ARRAY['open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended']::varchar[])
        )
        -- DEC-005 §4: removed NOT EXISTS contracts + NOT EXISTS visits (legacy)
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

// ============================================================================
// Manual close + optional cooldown activation (DEC-005 D26 + D29)
// ============================================================================

/**
 * @swagger
 * /api/contact-targets/{id}/close:
 *   post:
 *     tags: [Contact Targets]
 *     summary: Manually close a contact target (DEC-005 D26)
 *     description: |
 *       Sets contact_targets.status = 'closed' + closing_reason + closed_by +
 *       closed_at. Optionally activates client cooldown via `activateCooldown`
 *       (DEC-005 D29 — manual path). Auto-cooldown on `not_interested` outcome
 *       is handled separately in telemarketing.ts.
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/close', async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }
    const targetId = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'contact_target id غير صالح' });
    }

    const authContext: any = (req as any).authContext;
    const userId = authContext?.userId ?? null;

    const {
      closingReason,
      activateCooldown,
      cooldownReason,
      cooldownDays,
    } = req.body as {
      closingReason?: string;
      activateCooldown?: boolean;
      cooldownReason?: string;
      cooldownDays?: number;
    };

    // Default the closing_reason based on caller role per DEC-005 D26.
    // Telemarketers / supervisors can supply 'manual_telemarketer' or
    // 'manual_supervisor'; we don't hard-enforce role here, the UI surface
    // does (telemarketer-only button vs supervisor button).
    const finalClosingReason = (closingReason && ALLOWED_CLOSING_REASONS.has(closingReason))
      ? closingReason
      : 'manual_telemarketer';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: targetRows } = await client.query(
        `UPDATE contact_targets
            SET status         = 'closed',
                closing_reason = $1,
                closed_by      = $2,
                closed_at      = NOW(),
                updated_at     = NOW()
          WHERE id = $3 AND branch_id = $4
          RETURNING id, target_id AS "clientId", closing_reason AS "closingReason"`,
        [finalClosingReason, userId, targetId, branchId],
      );
      if (targetRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'contact_target غير موجود في الفرع الحالي' });
      }

      let cooldownPayload: any = null;
      if (activateCooldown === true) {
        if (!cooldownReason || !cooldownReason.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'سبب التهدئة مطلوب عند تفعيلها (cooldownReason)' });
        }
        const days = Number.isFinite(cooldownDays) && cooldownDays! > 0
          ? Math.floor(cooldownDays!)
          : await getSystemSettingNumber('default_cooldown_days', 7);

        const { rows: clientRows } = await client.query(
          `UPDATE clients
              SET cooldown_until  = CURRENT_DATE + ($1 || ' days')::INTERVAL,
                  cooldown_reason = $2,
                  cooldown_set_by = $3,
                  cooldown_set_at = NOW()
            WHERE id = $4
            RETURNING cooldown_until  AS "cooldownUntil",
                      cooldown_reason AS "cooldownReason"`,
          [days, cooldownReason.trim(), userId, targetRows[0].clientId],
        );
        cooldownPayload = clientRows[0] ?? null;
      }

      await client.query('COMMIT');
      return res.json({
        contactTarget: targetRows[0],
        cooldown: cooldownPayload,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
