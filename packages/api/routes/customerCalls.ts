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
              WHEN c.is_golden_warranty = TRUE THEN 'golden_warranty'
              ELSE 'contract_warranty'
            END AS warranty_context,
            CASE
              WHEN c.is_golden_warranty = TRUE THEN c.golden_warranty_end_date
              ELSE c.contract_warranty_end_date
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
          WHERE c.customer_id = $1
            AND c.device_model_id IS NOT NULL
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
            c.contract_warranty_end_date AS warranty_until,
            c.id AS device_context_id,
            c.device_model_name AS device_context_name,
            NULL::jsonb AS discount_info,
            NULL::text AS notes
          FROM contract_line_items cli
          JOIN contracts c ON c.id = cli.contract_id
          LEFT JOIN spare_parts sp ON sp.id = cli.spare_part_id
          WHERE c.customer_id = $1
            AND cli.item_type = 'accessory'
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
            TRUE AS is_installed,
            vtepu.old_part_removed,
            CASE
              WHEN c.is_golden_warranty = TRUE
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.golden_warranty_end_date
                THEN 'golden_warranty'
              WHEN c.contract_warranty_end_date IS NOT NULL
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.contract_warranty_end_date
                THEN 'contract_warranty'
              ELSE 'no_warranty'
            END AS warranty_context,
            CASE
              WHEN c.is_golden_warranty = TRUE
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.golden_warranty_end_date
                THEN c.golden_warranty_end_date
              WHEN c.contract_warranty_end_date IS NOT NULL
                AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.contract_warranty_end_date
                THEN c.contract_warranty_end_date
              ELSE NULL
            END AS warranty_until,
            c.id AS device_context_id,
            c.device_model_name AS device_context_name,
            NULL::jsonb AS discount_info,
            NULL::text AS notes
          FROM visit_task_emergency_parts_used vtepu
          JOIN visit_tasks vt ON vt.id = vtepu.visit_task_id
          JOIN field_visits fv ON fv.id = vt.field_visit_id
          LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
          LEFT JOIN visit_task_emergency_financials vtef ON vtef.visit_task_id = vt.id
          LEFT JOIN spare_parts sp ON sp.id = vtepu.spare_part_id
          LEFT JOIN contracts c ON c.id = vt.contract_id
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

export default router;
