import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

function getCallerId(req: any): number | null {
  const userId = req.authContext?.userId ?? req.user?.id;
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId ?? req.user?.branchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isSuperAdmin(req: any): boolean {
  return req.authContext?.isSuperAdmin === true || req.user?.isSuperAdmin === true;
}

// ── GET /api/customers/:customerId/calls ─────────────────────────────────────
// Returns call logs for a customer, newest-first.
// Optional ?contactId= filter. Branch-scoped users see only their branch.
/**
 * @swagger
 * /api/customers/{customerId}/calls:
 *   get:
 *     tags: [System → Customer Calls]
 *     summary: Get call logs for a customer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: customerId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Customer ID
 *       - in: query
 *         name: contactId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter calls by contact ID
 *     responses:
 *       200:
 *         description: List of customer call logs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   customerId:
 *                     type: integer
 *                   contactId:
 *                     type: string
 *                   contactNumber:
 *                     type: string
 *                   contactLabel:
 *                     type: string
 *                   callerId:
 *                     type: integer
 *                   callerRole:
 *                     type: string
 *                   callDate:
 *                     type: string
 *                     format: date-time
 *                   outcome:
 *                     type: string
 *                   sourceType:
 *                     type: string
 *                   sourceId:
 *                     type: string
 *                   notes:
 *                     type: string
 *                   branchId:
 *                     type: integer
 *                   actionLog:
 *                     type: object
 *                   answeredBy:
 *                     type: string
 *                   communicationChannel:
 *                     type: string
 *                   status:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   callerName:
 *                     type: string
 *                   linkedTasks:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         taskId:
 *                           type: integer
 *                         taskType:
 *                           type: string
 *                         arabicLabel:
 *                           type: string
 *       400:
 *         description: Invalid customer ID
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get(
  '/:customerId/calls',
  requirePermission('clients.view'),
  async (req, res) => {
    try {
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
        COALESCE(hu.name, 'مجهول') AS "callerName",
        COALESCE(
          (SELECT json_agg(jsonb_build_object(
                   'taskId',      ot.id,
                   'taskType',    ot.task_type,
                   'arabicLabel', COALESCE(ttc.arabic_label, ot.task_type)
                 ) ORDER BY ot.id)
             FROM call_task_links ctl
             JOIN open_tasks ot ON ot.id = ctl.task_id
             LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
            WHERE ctl.call_id = ccl.id),
          '[]'::json
        ) AS "linkedTasks"
      FROM customer_call_logs ccl
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE ccl.customer_id = $1
        ${whereExtra}
      ORDER BY ccl.call_date DESC
      `,
      params,
    );

    return res.json(rows);
    } catch (err: any) {
      console.error('Error fetching customer calls:', err);
      return res.status(500).json({ error: 'خطأ في جلب سجل الاتصال' });
    }
  },
);

// ── GET /api/customers/:customerId/calls/stats ───────────────────────────────
// Outcome counts for a customer.
/**
 * @swagger
 * /api/customers/{customerId}/calls/stats:
 *   get:
 *     tags: [System → Customer Calls]
 *     summary: Get outcome statistics for a customer's calls
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: customerId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Call log statistics by outcome
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   outcome:
 *                     type: string
 *                   count:
 *                     type: integer
 *       400:
 *         description: Invalid customer ID
 *       500:
 *         description: Server error
 */
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
/**
 * @swagger
 * /api/customers/{customerId}/calls:
 *   post:
 *     tags: [System → Customer Calls]
 *     summary: Record a new call log entry for a customer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: customerId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - outcome
 *             properties:
 *               contactId:
 *                 type: string
 *               contactNumber:
 *                 type: string
 *               contactLabel:
 *                 type: string
 *               outcome:
 *                 type: string
 *               notes:
 *                 type: string
 *               callDate:
 *                 type: string
 *                 format: date-time
 *               sourceType:
 *                 type: string
 *                 default: direct_call
 *               sourceId:
 *                 type: string
 *               taskId:
 *                 type: integer
 *               taskListId:
 *                 type: integer
 *               taskListItemId:
 *                 type: string
 *               actionLog:
 *                 type: object
 *               answeredBy:
 *                 type: string
 *               communicationChannel:
 *                 type: string
 *               status:
 *                 type: string
 *                 default: completed
 *     responses:
 *       201:
 *         description: Call log recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 customerId:
 *                   type: integer
 *                 contactId:
 *                   type: string
 *                 contactNumber:
 *                   type: string
 *                 contactLabel:
 *                   type: string
 *                 callerId:
 *                   type: integer
 *                 callerRole:
 *                   type: string
 *                 callDate:
 *                   type: string
 *                   format: date-time
 *                 outcome:
 *                   type: string
 *                 sourceType:
 *                   type: string
 *                 sourceId:
 *                   type: string
 *                 notes:
 *                   type: string
 *                 branchId:
 *                   type: integer
 *                 actionLog:
 *                   type: object
 *                 answeredBy:
 *                   type: string
 *                 communicationChannel:
 *                   type: string
 *                 status:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid input or missing context
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.post(
  '/:customerId/calls',
  // TODO: add requirePermission('customers.call') once that permission is defined
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
      callDate,
      sourceType = 'direct_call',
      sourceId,
      taskId,
      taskListId,
      taskListItemId,
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
      req.user?.role ??
      null;

    const id = uuidv4();
    const { rows } = await pool.query(
      `
      INSERT INTO customer_call_logs (
        id, customer_id, contact_id, contact_number, contact_label,
        caller_id, caller_role, call_date, outcome, source_type, source_id,
        notes, branch_id, action_log,
        answered_by, communication_channel, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, COALESCE($8::timestamptz, NOW()), $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17
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
        callDate ?? null,
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

    const call = rows[0];

    if (sourceType === 'telemarketing_task') {
      let openTaskId: number | null = Number.isInteger(taskId) && taskId > 0 ? taskId : null;

      if (openTaskId == null) {
        const sourceKey = taskListItemId ?? sourceId;
        if (sourceKey != null) {
          const lookupParams: any[] = [String(sourceKey)];
          const lookupFilters: string[] = ['id = $1'];

          if (taskListId) {
            lookupParams.push(taskListId);
            lookupFilters.push(`task_list_id = $${lookupParams.length}`);
          }

          const { rows: taskRows } = await pool.query(
            `SELECT open_task_id FROM telemarketing_task_list_items WHERE ${lookupFilters.join(' AND ')} LIMIT 1`,
            lookupParams,
          );

          const resolvedTaskId = taskRows[0]?.open_task_id;
          openTaskId = Number.isInteger(resolvedTaskId) && resolvedTaskId > 0 ? resolvedTaskId : null;
        }
      }

      // Link the call to ALL tasks in the same contact_target, not just the primary one.
      // This allows viewing the call from any sibling task's detail page.
      const itemKey = taskListItemId ?? sourceId;
      if (itemKey != null) {
        const { rows: allTaskRows } = await pool.query(
          `SELECT DISTINCT tli2.open_task_id
             FROM telemarketing_task_list_items tli
             JOIN telemarketing_task_list_items tli2
               ON tli2.contact_target_id = tli.contact_target_id
                  AND tli2.open_task_id IS NOT NULL
            WHERE tli.id = $1`,
          [String(itemKey)],
        );
        for (const { open_task_id } of allTaskRows) {
          if (open_task_id) {
            await pool.query(
              'INSERT INTO call_task_links (call_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [call.id, open_task_id],
            );
          }
        }
        // Fallback: also link the explicitly provided taskId if not already covered
        if (openTaskId != null) {
          await pool.query(
            'INSERT INTO call_task_links (call_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [call.id, openTaskId],
          );
        }
      } else if (openTaskId != null) {
        await pool.query(
          'INSERT INTO call_task_links (call_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [call.id, openTaskId],
        );
      }
    }

    return res.status(201).json(call);
  },
);

// ── PATCH /api/calls/:callId ─────────────────────────────────────────────────
// Updates a pending log entry (e.g., after reply received to a text message).
/**
 * @swagger
 * /api/customers/calls/{callId}:
 *   patch:
 *     tags: [System → Customer Calls]
 *     summary: Update an existing call log entry by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: callId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Call log ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               outcome:
 *                 type: string
 *               notes:
 *                 type: string
 *               status:
 *                 type: string
 *               answeredBy:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated call log
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 customerId:
 *                   type: integer
 *                 contactId:
 *                   type: string
 *                 contactNumber:
 *                   type: string
 *                 contactLabel:
 *                   type: string
 *                 callerId:
 *                   type: integer
 *                 callerRole:
 *                   type: string
 *                 callDate:
 *                   type: string
 *                   format: date-time
 *                 outcome:
 *                   type: string
 *                 sourceType:
 *                   type: string
 *                 sourceId:
 *                   type: string
 *                 notes:
 *                   type: string
 *                 branchId:
 *                   type: integer
 *                 actionLog:
 *                   type: object
 *                 answeredBy:
 *                   type: string
 *                 communicationChannel:
 *                   type: string
 *                 status:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Call log not found
 *       500:
 *         description: Server error
 */
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

// ── GET /api/customers/:id/purchase-history ───────────────────────────────────
/**
 * @swagger
 * /api/customers/{id}/purchase-history:
 *   get:
 *     tags: [System → Customer Calls]
 *     summary: Get purchase history for a customer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer purchase history records and summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 customerId:
 *                   type: integer
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       customerId:
 *                         type: integer
 *                       branchId:
 *                         type: integer
 *                       purchaseDate:
 *                         type: string
 *                       sourceType:
 *                         type: string
 *                       sourceId:
 *                         type: string
 *                       sourceLabel:
 *                         type: string
 *                       itemType:
 *                         type: string
 *                       itemId:
 *                         type: integer
 *                       itemName:
 *                         type: string
 *                       itemCode:
 *                         type: string
 *                       quantity:
 *                         type: integer
 *                       unitPrice:
 *                         type: number
 *                       totalPrice:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       paymentType:
 *                         type: string
 *                       isInstalled:
 *                         type: boolean
 *                       oldPartRemoved:
 *                         type: boolean
 *                       warrantyContext:
 *                         type: string
 *                       warrantyUntil:
 *                         type: string
 *                       deviceContext:
 *                         type: object
 *                         properties:
 *                           contractId:
 *                             type: integer
 *                           deviceModelName:
 *                             type: string
 *                       discountInfo:
 *                         type: object
 *                       notes:
 *                         type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalPurchases:
 *                       type: integer
 *                     totalDevices:
 *                       type: integer
 *                     totalParts:
 *                       type: integer
 *                     totalSpent:
 *                       type: number
 *       400:
 *         description: Invalid customer ID
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/purchase-history',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['id'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    try {
      const { rows: clientRows } = await pool.query(
        'SELECT id FROM clients WHERE id = $1',
        [customerId],
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: 'الزبون غير موجود' });
      }

      const { rows: records } = await pool.query(
        `
        (
          SELECT
            'contract_device_' || c.id::text AS id,
            c.customer_id,
            c.branch_id,
            c.contract_date::text AS purchase_date,
            'contract' AS source_type,
            c.id::text AS source_id,
            'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
            'device' AS item_type,
            c.device_model_id AS item_id,
            c.device_model_name AS item_name,
            NULL::varchar AS item_code,
            1 AS quantity,
            c.base_price AS unit_price,
            c.base_price AS total_price,
            'SYP' AS currency,
            c.payment_type,
            TRUE AS is_installed,
            NULL::boolean AS old_part_removed,
            CASE
              WHEN d.is_golden_warranty = TRUE THEN 'golden_warranty'
              ELSE 'contract_warranty'
            END AS warranty_context,
            CASE
              WHEN d.is_golden_warranty = TRUE THEN d.golden_warranty_end_date
              ELSE d.contract_warranty_end_date
            END AS warranty_until,
            c.id AS device_context_id,
            c.device_model_name AS device_context_name,
            CASE
              WHEN c.base_price > c.final_price THEN jsonb_build_object(
                'originalPrice', c.base_price,
                'discountAmount', c.base_price - c.final_price,
                'finalContractPrice', c.final_price
              )
              ELSE NULL
            END AS discount_info,
            NULL::text AS notes
          FROM contracts c
          LEFT JOIN installed_devices d ON d.contract_id = c.id
          WHERE c.customer_id = $1
            AND c.device_model_id IS NOT NULL
            AND c.status NOT IN ('draft', 'discarded')
        )
        UNION ALL
        (
          SELECT
            'contract_item_' || cli.id::text AS id,
            c.customer_id,
            c.branch_id,
            c.contract_date::text AS purchase_date,
            'contract' AS source_type,
            c.id::text AS source_id,
            'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
            CASE
              WHEN sp.maintenance_type = 'Periodic' THEN 'periodic_part'
              WHEN sp.maintenance_type = 'Emergency' THEN 'emergency_part'
              ELSE 'accessory'
            END AS item_type,
            cli.spare_part_id AS item_id,
            COALESCE(cli.description, sp.name, 'قطعة ملحقة') AS item_name,
            sp.code AS item_code,
            cli.quantity,
            cli.unit_price,
            cli.total_price,
            'SYP' AS currency,
            c.payment_type,
            cli.is_installed,
            NULL::boolean AS old_part_removed,
            'contract_warranty' AS warranty_context,
            d.contract_warranty_end_date AS warranty_until,
            c.id AS device_context_id,
            c.device_model_name AS device_context_name,
            NULL::jsonb AS discount_info,
            NULL::text AS notes
          FROM contract_line_items cli
          JOIN contracts c ON c.id = cli.contract_id
          LEFT JOIN installed_devices d ON d.contract_id = c.id
          LEFT JOIN spare_parts sp ON sp.id = cli.spare_part_id
          WHERE c.customer_id = $1
            AND cli.item_type = 'accessory'
            AND c.status NOT IN ('draft', 'discarded')
        )
        UNION ALL
        (
          SELECT
            'emergency_' || vtepu.id::text AS id,
            fv.client_id AS customer_id,
            fv.branch_id,
            COALESCE(vtr.closed_at::date::text, fv.scheduled_date::text) AS purchase_date,
            'emergency_maintenance' AS source_type,
            vt.id::text AS source_id,
            'صيانة طارئة #' || vt.id::text AS source_label,
            'emergency_part' AS item_type,
            vtepu.spare_part_id AS item_id,
            COALESCE(vtepu.part_name_snapshot, sp.name, 'قطعة صيانة') AS item_name,
            sp.code AS item_code,
            vtepu.quantity,
            vtepu.unit_price,
            (vtepu.quantity * COALESCE(vtepu.unit_price, 0)) AS total_price,
            'SYP' AS currency,
            COALESCE(vtef.payment_method, 'maintenance_paid') AS payment_type,
            CASE WHEN erp.placement_state = 'customer_stock' THEN FALSE ELSE TRUE END AS is_installed,
            vtepu.old_part_removed,
            CASE
              WHEN d.is_golden_warranty = TRUE
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= d.golden_warranty_end_date
                THEN 'golden_warranty'
              WHEN d.contract_warranty_end_date IS NOT NULL
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= d.contract_warranty_end_date
                THEN 'contract_warranty'
              ELSE 'no_warranty'
            END AS warranty_context,
            CASE
              WHEN d.is_golden_warranty = TRUE
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= d.golden_warranty_end_date
                THEN d.golden_warranty_end_date
              WHEN d.contract_warranty_end_date IS NOT NULL
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= d.contract_warranty_end_date
                THEN d.contract_warranty_end_date
              ELSE NULL
            END AS warranty_until,
            c.id AS device_context_id,
            c.device_model_name AS device_context_name,
            NULL::jsonb AS discount_info,
            NULL::text AS notes
          FROM visit_task_emergency_parts_used vtepu
          JOIN visit_task_results vtr ON vtr.id = vtepu.visit_task_result_id
          JOIN visit_tasks vt ON vt.id = vtr.visit_task_id
          LEFT JOIN emergency_result_parts erp
            ON erp.open_task_id = vt.source_open_task_id
           AND COALESCE(erp.spare_part_id, -1) = COALESCE(vtepu.spare_part_id, -1)
           AND erp.part_name_snapshot = vtepu.part_name_snapshot
          JOIN field_visits fv ON fv.id = vt.field_visit_id
          LEFT JOIN visit_task_emergency_financials vtef ON vtef.visit_task_result_id = vtr.id
          LEFT JOIN spare_parts sp ON sp.id = vtepu.spare_part_id
          LEFT JOIN contracts c ON c.id = vt.contract_id
          LEFT JOIN installed_devices d ON d.contract_id = c.id
          WHERE fv.client_id = $1
        )
        ORDER BY purchase_date DESC NULLS LAST
        `,
        [customerId],
      );

      return res.json({
        customerId,
        records: records.map(r => ({
          ...r,
          purchaseDate: r.purchase_date,
          sourceType: r.source_type,
          sourceId: r.source_id,
          sourceLabel: r.source_label,
          itemType: r.item_type,
          itemId: r.item_id,
          itemName: r.item_name,
          itemCode: r.item_code,
          quantity: r.quantity,
          unitPrice: r.unit_price,
          totalPrice: r.total_price,
          currency: r.currency,
          paymentType: r.payment_type,
          isInstalled: r.is_installed,
          oldPartRemoved: r.old_part_removed,
          warrantyContext: r.warranty_context,
          warrantyUntil: r.warranty_until,
          deviceContext: {
            contractId: r.device_context_id,
            deviceModelName: r.device_context_name,
          },
          discountInfo: r.discount_info,
          notes: r.notes,
        })),
        summary: {
          totalPurchases: records.length,
          totalDevices: records.filter(r => r.item_type === 'device').length,
          totalParts: records.filter(r => r.item_type !== 'device').length,
          totalSpent: records.reduce((sum, r) => sum + Number(r.total_price || 0), 0),
        },
      });
    } catch (err: any) {
      console.error('[customers] GET /:id/purchase-history error:', err);
      return res.status(500).json({ error: 'خطأ في جلب سجل المشتريات' });
    }
  },
);

// ── GET /api/customers/:id/parts-stock ───────────────────────────────────────
/**
 * @swagger
 * /api/customers/{id}/parts-stock:
 *   get:
 *     tags: [System → Customer Calls]
 *     summary: Get current uninstalled parts stock for a customer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Current customer parts stock
 *       404:
 *         description: Customer not found
 */
router.get(
  '/:id/parts-stock',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['id'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    try {
      const { rows: clientRows } = await pool.query(
        'SELECT id FROM clients WHERE id = $1',
        [customerId],
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: 'الزبون غير موجود' });
      }

      const { rows } = await pool.query(
        `
        WITH stock_entries AS (
          -- Source A: uninstalled parts/accessories that came from active/completed contracts.
          -- This is the only source we can assert safely today.
          SELECT
            'contract'::text AS source_type,
            c.id::text AS source_id,
            'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
            c.contract_date::text AS received_at,
            COALESCE('spare_part_' || cli.spare_part_id::text, 'line_item_' || cli.id::text) AS stock_key,
            CASE
              WHEN sp.maintenance_type = 'Periodic' THEN 'periodic_part'
              WHEN sp.maintenance_type = 'Emergency' THEN 'emergency_part'
              ELSE 'accessory'
            END AS item_type,
            cli.spare_part_id AS item_id,
            COALESCE(sp.name, cli.description, 'قطعة غير معرّفة') AS item_name,
            sp.code AS item_code,
            cli.quantity::integer AS quantity_available
          FROM contract_line_items cli
          JOIN contracts c ON c.id = cli.contract_id
          LEFT JOIN spare_parts sp ON sp.id = cli.spare_part_id
          WHERE c.customer_id = $1
            AND cli.item_type = 'accessory'
            AND COALESCE(cli.is_installed, FALSE) = FALSE
            AND c.status IN ('active', 'completed')

          UNION ALL

          -- Source B: emergency parts explicitly delivered to the customer
          -- without being installed yet.
          SELECT
            'emergency_maintenance'::text AS source_type,
            ot.id::text AS source_id,
            'مهمة طارئة #' || ot.id::text AS source_label,
            COALESCE(vtr.closed_at::date::text, fv.scheduled_date::text) AS received_at,
            COALESCE('spare_part_' || erp.spare_part_id::text, 'emergency_part_' || erp.id::text) AS stock_key,
            CASE
              WHEN erp.maintenance_type = 'Periodic' THEN 'periodic_part'
              WHEN erp.maintenance_type = 'Emergency' THEN 'emergency_part'
              ELSE 'accessory'
            END AS item_type,
            erp.spare_part_id AS item_id,
            erp.part_name_snapshot AS item_name,
            erp.part_code_snapshot AS item_code,
            erp.quantity::integer AS quantity_available
          FROM emergency_result_parts erp
          JOIN open_tasks ot ON ot.id = erp.open_task_id
          JOIN visit_tasks vt ON vt.open_task_id = ot.id
          JOIN field_visits fv ON fv.id = vt.field_visit_id
          LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
          LEFT JOIN contracts c ON c.id = ot.contract_id
          WHERE fv.client_id = $1
            AND erp.placement_state = 'customer_stock'
            AND (c.id IS NULL OR c.status IN ('active', 'completed'))

          -- Future sources go here as additional UNION ALL branches.
          -- Example candidates:
          --   * emergency maintenance tasks that explicitly mark a part as
          --     delivered to the customer but not yet installed.
          --   * installation/service tasks that reserve or return a part.
          --
          -- We are not adding those sources yet because the current task
          -- payloads do not expose a trustworthy "customer stock" state.
        )
        SELECT
          stock_key AS stock_id,
          item_type,
          item_id,
          item_name,
          item_code,
          SUM(quantity_available)::integer AS quantity_available,
          MIN(received_at)::text AS first_received_at,
          MAX(received_at)::text AS last_received_at,
          COUNT(DISTINCT source_id)::integer AS sources_count,
          json_agg(
            DISTINCT jsonb_build_object(
              'sourceType', source_type,
              'sourceId', source_id,
              'sourceLabel', source_label,
              'receivedAt', received_at
            )
          ) AS sources
        FROM stock_entries
        GROUP BY stock_key, item_type, item_id, item_name, item_code
        ORDER BY MAX(received_at) DESC NULLS LAST, item_name
        `,
        [customerId],
      );

      return res.json({
        customerId,
        records: rows.map((r: any) => ({
          stockId: r.stock_id,
          itemType: r.item_type,
          itemId: r.item_id,
          itemName: r.item_name,
          itemCode: r.item_code,
          quantityAvailable: Number(r.quantity_available || 0),
          firstReceivedAt: r.first_received_at,
          lastReceivedAt: r.last_received_at,
          sourcesCount: Number(r.sources_count || 0),
          sources: Array.isArray(r.sources) ? r.sources : [],
        })),
        summary: {
          totalUniqueItems: rows.length,
          totalUnits: rows.reduce((sum: number, r: any) => sum + Number(r.quantity_available || 0), 0),
          periodicItems: rows.filter((r: any) => r.item_type === 'periodic_part').length,
          emergencyItems: rows.filter((r: any) => r.item_type === 'emergency_part').length,
          accessoryItems: rows.filter((r: any) => r.item_type === 'accessory').length,
        },
      });
    } catch (err: any) {
      console.error('[customers] GET /:id/parts-stock error:', err);
      return res.status(500).json({ error: 'خطأ في جلب مخزون الزبون' });
    }
  },
);

export default router;
