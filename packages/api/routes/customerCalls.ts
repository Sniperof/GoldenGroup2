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
// Returns call logs for a customer, newest-first.
// Optional ?contactId= filter. Branch-scoped users see only their branch.

router.get(
  '/:customerId/calls',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['customerId'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    const { rows: clientRows } = await pool.query(
      'SELECT id FROM clients WHERE id = $1',
      [customerId],
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'الزبون غير موجود' });
    }

    const branchId = getBranchId(req);
    const superAdmin = isSuperAdmin(req);
    const contactIdFilter = (req.query['contactId'] as string) || null;

    const params: any[] = [customerId];
    const filters: string[] = [];

    if (!superAdmin && branchId != null) {
      params.push(branchId);
      filters.push(`(ccl.branch_id = $${params.length} OR ccl.branch_id IS NULL)`);
    }

    if (contactIdFilter) {
      params.push(contactIdFilter);
      filters.push(`ccl.contact_id = $${params.length}`);
    }

    const whereExtra = filters.length > 0 ? 'AND ' + filters.join(' AND ') : '';

    const { rows } = await pool.query(
      `
      SELECT
        ccl.id,
        ccl.customer_id            AS "customerId",
        ccl.contact_id             AS "contactId",
        ccl.contact_number         AS "contactNumber",
        ccl.contact_label          AS "contactLabel",
        ccl.caller_id              AS "callerId",
        ccl.caller_role            AS "callerRole",
        ccl.call_date              AS "callDate",
        ccl.outcome,
        ccl.source_type            AS "sourceType",
        ccl.source_id              AS "sourceId",
        ccl.notes,
        ccl.branch_id              AS "branchId",
        ccl.action_log             AS "actionLog",
        ccl.answered_by            AS "answeredBy",
        ccl.communication_channel  AS "communicationChannel",
        ccl.status,
        ccl.created_at             AS "createdAt",
        COALESCE(
          hu.full_name,
          hu.first_name || ' ' || hu.last_name,
          'مجهول'
        )                          AS "callerName"
      FROM customer_call_logs ccl
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE ccl.customer_id = $1
        ${whereExtra}
      ORDER BY ccl.call_date DESC
      `,
      params,
    );

    return res.json(rows);
  },
);

// ── GET /api/customers/:customerId/calls/stats ───────────────────────────────
// Outcome counts for a customer.

router.get(
  '/:customerId/calls/stats',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['customerId'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    const { rows } = await pool.query(
      `
      SELECT outcome, COUNT(*)::int AS count
      FROM customer_call_logs
      WHERE customer_id = $1
      GROUP BY outcome
      ORDER BY count DESC
      `,
      [customerId],
    );

    return res.json(rows);
  },
);

// ── POST /api/customers/:customerId/calls ────────────────────────────────────
// Records a new call log entry.

router.post(
  '/:customerId/calls',
  requirePermission('clients.edit', 'telemarketing.calls.create'),
  async (req, res) => {
    const customerId = parseInt(req.params['customerId'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

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
      answeredBy,
      communicationChannel,
      status = 'completed',
    } = req.body;

    if (!outcome || typeof outcome !== 'string') {
      return res.status(400).json({ error: 'حقل النتيجة (outcome) مطلوب' });
    }

    const callerId = getCallerId(req);
    const branchId = getBranchId(req);
    const superAdmin = isSuperAdmin(req);

    if (!superAdmin && branchId == null) {
      return res.status(400).json({ error: 'سياق الفرع مطلوب لتسجيل المكالمة' });
    }

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
        notes, branch_id, action_log,
        answered_by, communication_channel, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16
      )
      RETURNING
        id,
        customer_id            AS "customerId",
        contact_id             AS "contactId",
        contact_number         AS "contactNumber",
        contact_label          AS "contactLabel",
        caller_id              AS "callerId",
        caller_role            AS "callerRole",
        call_date              AS "callDate",
        outcome,
        source_type            AS "sourceType",
        source_id              AS "sourceId",
        notes,
        branch_id              AS "branchId",
        action_log             AS "actionLog",
        answered_by            AS "answeredBy",
        communication_channel  AS "communicationChannel",
        status,
        created_at             AS "createdAt"
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
        answeredBy ?? null,
        communicationChannel ?? null,
        status,
      ],
    );

    return res.status(201).json(rows[0]);
  },
);

// ── PATCH /api/calls/:callId ─────────────────────────────────────────────────
// Updates a pending log entry (e.g., after reply received to a text message).

router.patch(
  '/calls/:callId',
  requirePermission('clients.edit', 'telemarketing.calls.create'),
  async (req, res) => {
    const { callId } = req.params;
    if (!callId) {
      return res.status(400).json({ error: 'معرّف المكالمة مطلوب' });
    }

    const { outcome, notes, status, answeredBy } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (outcome !== undefined) {
      params.push(outcome);
      updates.push(`outcome = $${params.length}`);
    }
    if (notes !== undefined) {
      params.push(notes);
      updates.push(`notes = $${params.length}`);
    }
    if (status !== undefined) {
      params.push(status);
      updates.push(`status = $${params.length}`);
    }
    if (answeredBy !== undefined) {
      params.push(answeredBy);
      updates.push(`answered_by = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    params.push(callId);
    const { rows } = await pool.query(
      `
      UPDATE customer_call_logs
      SET ${updates.join(', ')}
      WHERE id = $${params.length}
      RETURNING
        id,
        customer_id            AS "customerId",
        contact_id             AS "contactId",
        contact_number         AS "contactNumber",
        contact_label          AS "contactLabel",
        caller_id              AS "callerId",
        caller_role            AS "callerRole",
        call_date              AS "callDate",
        outcome,
        source_type            AS "sourceType",
        source_id              AS "sourceId",
        notes,
        branch_id              AS "branchId",
        action_log             AS "actionLog",
        answered_by            AS "answeredBy",
        communication_channel  AS "communicationChannel",
        status,
        created_at             AS "createdAt"
      `,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'سجل المكالمة غير موجود' });
    }

    return res.json(rows[0]);
  },
);

export default router;
