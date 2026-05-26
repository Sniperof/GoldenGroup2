import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  id, contract_id AS "contractId", type, scheduled_date AS "scheduledDate",
  adjusted_date AS "adjustedDate", original_amount AS "originalAmount",
  remaining_balance AS "remainingBalance", assigned_telemarketer_id AS "assignedTelemarketerId",
  status, escalated
`;

/**
 * @swagger
 * components:
 *   schemas:
 *     Due:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         contractId:
 *           type: integer
 *         type:
 *           type: string
 *         scheduledDate:
 *           type: string
 *         adjustedDate:
 *           type: string
 *         originalAmount:
 *           type: number
 *         remainingBalance:
 *           type: number
 *         assignedTelemarketerId:
 *           type: integer
 *         status:
 *           type: string
 *         escalated:
 *           type: boolean
 */

/**
 * @swagger
 * /api/dues:
 *   get:
 *     tags: [Dues]
 *     summary: Retrieve list of dues
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Due'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const conditions: string[] = [];
  const params: any[] = [];

  if (!authContext.isSuperAdmin) {
    conditions.push(`c.branch_id = $${params.push(authContext.actingBranchId)}`);
  } else {
    const hb = Number(req.headers['x-branch-id'] ?? req.query.branchId);
    if (Number.isFinite(hb) && hb > 0) conditions.push(`c.branch_id = $${params.push(hb)}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT d.id, d.contract_id AS "contractId", d.type,
            d.scheduled_date AS "scheduledDate", d.adjusted_date AS "adjustedDate",
            d.original_amount AS "originalAmount", d.remaining_balance AS "remainingBalance",
            d.assigned_telemarketer_id AS "assignedTelemarketerId", d.status, d.escalated
     FROM dues d JOIN contracts c ON c.id = d.contract_id ${where} ORDER BY d.id`,
    params,
  );
  res.json(rows.map(d => ({ ...d, originalAmount: Number(d.originalAmount), remainingBalance: Number(d.remainingBalance) })));
});

/**
 * @swagger
 * /api/dues/{id}:
 *   put:
 *     tags: [Dues]
 *     summary: Update due details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Due ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               status:
 *                 type: string
 *               escalated:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Due'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const d = req.body;
  const id = req.params.id;

  const { rows: existing } = await pool.query(
    `SELECT d.id, d.contract_id AS "contractId", d.type,
            d.scheduled_date AS "scheduledDate", d.adjusted_date AS "adjustedDate",
            d.original_amount AS "originalAmount", d.remaining_balance AS "remainingBalance",
            d.assigned_telemarketer_id AS "assignedTelemarketerId", d.status, d.escalated,
            c.branch_id AS "branchId"
     FROM dues d JOIN contracts c ON c.id = d.contract_id WHERE d.id = $1`,
    [id],
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'الذمة المالية غير موجودة' });
    return;
  }

  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branchId });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  const current = existing[0];
  const merged = {
    type: d.type ?? current.type,
    scheduledDate: d.scheduledDate ?? current.scheduledDate,
    adjustedDate: d.adjustedDate ?? current.adjustedDate,
    originalAmount: d.originalAmount ?? current.originalAmount,
    remainingBalance: d.remainingBalance ?? current.remainingBalance,
    assignedTelemarketerId: d.assignedTelemarketerId !== undefined ? d.assignedTelemarketerId : current.assignedTelemarketerId,
    status: d.status ?? current.status,
    escalated: d.escalated !== undefined ? d.escalated : current.escalated,
  };

  const { rows } = await pool.query(
    `UPDATE dues SET type=$1, scheduled_date=$2, adjusted_date=$3,
      original_amount=$4, remaining_balance=$5, assigned_telemarketer_id=$6,
      status=$7, escalated=$8 WHERE id=$9 RETURNING ${selectFields}`,
    [merged.type, merged.scheduledDate, merged.adjustedDate, merged.originalAmount, merged.remainingBalance,
     merged.assignedTelemarketerId || null, merged.status, merged.escalated || false, id]
  );
  res.json(rows[0] ? { ...rows[0], originalAmount: Number(rows[0].originalAmount), remainingBalance: Number(rows[0].remainingBalance) } : null);
});

export default router;
