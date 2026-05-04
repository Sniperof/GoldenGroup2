import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

function getCallerId(req: any): number | null {
  const userId = req.authContext?.userId;
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isSuperAdmin(req: any): boolean {
  return req.authContext?.isSuperAdmin === true;
}

// ── GET /api/customers/:customerId/calls ─────────────────────────────────────
// Returns all call logs for a customer ordered newest-first.
// Branch-scoped users only see logs recorded under their branch (or null).
// Super-admins see everything.

router.get(
  '/:customerId/calls',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['customerId'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    // Verify customer exists
    const { rows: clientRows } = await pool.query(
      'SELECT id FROM clients WHERE id = $1',
      [customerId],
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'الزبون غير موجود' });
    }

    const branchId = getBranchId(req);
    const superAdmin = isSuperAdmin(req);

    // Build scope filter
    const params: any[] = [customerId];
    let branchFilter = '';
    if (!superAdmin && branchId != null) {
      params.push(branchId);
      branchFilter = `AND (ccl.branch_id = $${params.length} OR ccl.branch_id IS NULL)`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        ccl.id,
        ccl.customer_id       AS "customerId",
        ccl.contact_id        AS "contactId",
        ccl.contact_number    AS "contactNumber",
        ccl.contact_label     AS "contactLabel",
        ccl.caller_id         AS "callerId",
        ccl.caller_role       AS "callerRole",
        ccl.call_date         AS "callDate",
        ccl.outcome,
        ccl.source_type       AS "sourceType",
        ccl.source_id         AS "sourceId",
        ccl.notes,
        ccl.branch_id         AS "branchId",
        ccl.action_log        AS "actionLog",
        ccl.created_at        AS "createdAt",
        COALESCE(
          hu.full_name,
          hu.first_name || ' ' || hu.last_name,
          'مجهول'
        )                     AS "callerName"
      FROM customer_call_logs ccl
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE ccl.customer_id = $1
        ${branchFilter}
      ORDER BY ccl.call_date DESC
      `,
      params,
    );

    return res.json(rows);
  },
);

// ── POST /api/customers/:customerId/calls ────────────────────────────────────
// Records a new call log entry for the given customer.

router.post(
  '/:customerId/calls',
  requirePermission('clients.edit', 'telemarketing.calls.create'),
  async (req, res) => {
    const customerId = parseInt(req.params['customerId'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    // Verify customer exists
    const { rows: clientRows } = await pool.query(
      'SELECT id FROM clients WHERE id = $1',
      [customerId],
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'الزبون غير موجود' });
    }

    const {
      contactId,
      contactNumber,
      contactLabel,
      outcome,
      notes,
      sourceType = 'direct_call',
      sourceId,
      actionLog,
    } = req.body;

    if (!outcome || typeof outcome !== 'string') {
      return res.status(400).json({ error: 'حقل النتيجة (outcome) مطلوب' });
    }

    const callerId = getCallerId(req);
    const branchId = getBranchId(req);
    const superAdmin = isSuperAdmin(req);

    // Branch-scope guard: non-super users must have a branch context
    if (!superAdmin && branchId == null) {
      return res.status(400).json({ error: 'سياق الفرع مطلوب لتسجيل المكالمة' });
    }

    // Resolve caller role from authContext grants
    const callerRole: string | null =
      (req.authContext as any)?.callerRole ??
      (req.authContext?.grants?.[0] as any)?.role ??
      null;

    const id = uuidv4();
    const { rows } = await pool.query(
      `
      INSERT INTO customer_call_logs (
        id, customer_id, contact_id, contact_number, contact_label,
        caller_id, caller_role, outcome, source_type, source_id,
        notes, branch_id, action_log
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13
      )
      RETURNING
        id,
        customer_id     AS "customerId",
        contact_id      AS "contactId",
        contact_number  AS "contactNumber",
        contact_label   AS "contactLabel",
        caller_id       AS "callerId",
        caller_role     AS "callerRole",
        call_date       AS "callDate",
        outcome,
        source_type     AS "sourceType",
        source_id       AS "sourceId",
        notes,
        branch_id       AS "branchId",
        action_log      AS "actionLog",
        created_at      AS "createdAt"
      `,
      [
        id,
        customerId,
        contactId ?? null,
        contactNumber ?? null,
        contactLabel ?? null,
        callerId,
        callerRole,
        outcome,
        sourceType,
        sourceId ?? null,
        notes ?? null,
        branchId,
        actionLog ? JSON.stringify(actionLog) : '{}',
      ],
    );

    return res.status(201).json(rows[0]);
  },
);

export default router;
