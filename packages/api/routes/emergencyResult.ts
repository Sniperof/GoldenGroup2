/**
 * Emergency Maintenance Result — 4-phase system
 *
 * Phase 1 (pre-state):  PUT  /api/emergency-result/:taskId/pre-state
 * Phase 2 (actions):    PUT  /api/emergency-result/:taskId/actions
 * Phase 3 (post-state): PUT  /api/emergency-result/:taskId/post-state
 * Phase 4 (costs):      PUT  /api/emergency-result/:taskId/costs
 * Full result:          GET  /api/emergency-result/:taskId
 * Device history:       GET  /api/emergency-result/device/:contractId/history
 */

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     DeviceTechnicalState:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         contractId:
 *           type: integer
 *         openTaskId:
 *           type: integer
 *         phase:
 *           type: string
 *         waterSourceType:
 *           type: string
 *         waterSourceTds:
 *           type: number
 *         waterPressure:
 *           type: string
 *         hasPressureRegulator:
 *           type: boolean
 *         tapTdsBefore:
 *           type: number
 *         pumpPressure:
 *           type: number
 *         membraneOutputTds:
 *           type: number
 *         membraneInputTds:
 *           type: number
 *         membraneFlow:
 *           type: string
 *         flowCupSize:
 *           type: string
 *         sterilizationTransformer:
 *           type: string
 *         uvLamp:
 *           type: string
 *         sterilizationSleeve:
 *           type: string
 *         highPressureTds:
 *           type: number
 *         lowPressureSwitch:
 *           type: string
 *         tankTds:
 *           type: number
 *         valveType:
 *           type: string
 *         pumpTransformer:
 *           type: string
 *         hasFifthTap:
 *           type: boolean
 *         deviceConnection:
 *           type: string
 *         additionalNotes:
 *           type: string
 *         recordedBy:
 *           type: integer
 *         createdAt:
 *           type: string
 *           format: date-time
 *         membraneEfficiency:
 *           type: number
 *     EmergencyMaintenanceAction:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         actionTypeId:
 *           type: integer
 *         actionTypeLabel:
 *           type: string
 *         actionsTaken:
 *           type: string
 *         partsUsed:
 *           type: array
 *           items:
 *             type: object
 *         technicianNotes:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     EmergencyResultCosts:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         finalDecision:
 *           type: string
 *         closingNotes:
 *           type: string
 *         laborCost:
 *           type: number
 *         partsCost:
 *           type: number
 *         totalCost:
 *           type: number
 *         transportFee:
 *           type: number
 *         assemblyFee:
 *           type: number
 *         discountPercentage:
 *           type: number
 *         discountReasonId:
 *           type: integer
 *         paymentMethod:
 *           type: string
 *         collectedAmount:
 *           type: number
 *         invoiceNotes:
 *           type: string
 *         decisionReasonId:
 *           type: integer
 *         followUpPriority:
 *           type: string
 *         followUpExpectedDate:
 *           type: string
 *           format: date
 *         paymentType:
 *           type: string
 *         installmentMonths:
 *           type: integer
 *         paymentDelivery:
 *           type: string
 *         transferCompanyId:
 *           type: integer
 *         barterDescription:
 *           type: string
 *         barterValueSyp:
 *           type: number
 *         pay1Currency:
 *           type: string
 *         pay1Amount:
 *           type: number
 *         pay1ExchangeRate:
 *           type: number
 *         pay2Currency:
 *           type: string
 *         pay2Amount:
 *           type: number
 *         pay2ExchangeRate:
 *           type: number
 *         closingNote:
 *           type: string
 *         closingEmployeeId:
 *           type: integer
 *         closingEmployeeName:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *     EmergencyResultPart:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         sparePartId:
 *           type: integer
 *         partNameSnapshot:
 *           type: string
 *         partCodeSnapshot:
 *           type: string
 *         maintenanceType:
 *           type: string
 *         unitPrice:
 *           type: number
 *         quantity:
 *           type: integer
 *         lineTotal:
 *           type: number
 *         retrieved:
 *           type: boolean
 *         noRetrievalReasonId:
 *           type: integer
 *         noRetrievalReasonText:
 *           type: string
 *         noRetrievalReasonLabel:
 *           type: string
 *     EmergencyPaymentEntry:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         method:
 *           type: string
 *         amountValue:
 *           type: number
 *         currency:
 *           type: string
 *         exchangeRate:
 *           type: number
 *         amountSyp:
 *           type: number
 *         transferCompanyId:
 *           type: integer
 *         transferCompanyName:
 *           type: string
 *         barterDescription:
 *           type: string
 *         sortOrder:
 *           type: integer
 *     EmergencyInstallment:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         installmentNumber:
 *           type: integer
 *         dueDate:
 *           type: string
 *           format: date
 *         amountSyp:
 *           type: number
 *         status:
 *           type: string
 *         dueId:
 *           type: integer
 */
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

const TECH_STATE_FIELDS = `
  id, contract_id AS "contractId", open_task_id AS "openTaskId", phase,
  water_source_type AS "waterSourceType", water_source_tds AS "waterSourceTds",
  water_pressure AS "waterPressure", has_pressure_regulator AS "hasPressureRegulator",
  tap_tds_before AS "tapTdsBefore", pump_pressure AS "pumpPressure",
  membrane_output_tds AS "membraneOutputTds", membrane_input_tds AS "membraneInputTds",
  membrane_flow AS "membraneFlow", flow_cup_size AS "flowCupSize",
  sterilization_transformer AS "sterilizationTransformer",
  uv_lamp AS "uvLamp", sterilization_sleeve AS "sterilizationSleeve",
  high_pressure_tds AS "highPressureTds", low_pressure_switch AS "lowPressureSwitch",
  tank_tds AS "tankTds", valve_type AS "valveType", pump_transformer AS "pumpTransformer",
  has_fifth_tap AS "hasFifthTap", device_connection AS "deviceConnection",
  additional_notes AS "additionalNotes", recorded_by AS "recordedBy", created_at AS "createdAt"
`;

function mapNum(v: any) { return v != null ? Number(v) : null; }
function mapTechState(r: any) {
  return {
    ...r,
    waterSourceTds:    mapNum(r.waterSourceTds),
    tapTdsBefore:      mapNum(r.tapTdsBefore),
    pumpPressure:      mapNum(r.pumpPressure),
    membraneOutputTds: mapNum(r.membraneOutputTds),
    membraneInputTds:  mapNum(r.membraneInputTds),
    highPressureTds:   mapNum(r.highPressureTds),
    tankTds:           mapNum(r.tankTds),
    // computed
    membraneEfficiency: (r.membraneOutputTds != null && r.membraneInputTds != null && Number(r.membraneInputTds) > 0)
      ? Math.round((1 - Number(r.membraneOutputTds) / Number(r.membraneInputTds)) * 100)
      : null,
  };
}

async function getTaskMeta(taskId: number) {
  const { rows } = await pool.query(
    `SELECT ot.id, ot.status, ot.contract_id AS "contractId",
            ot.em_pre_state_id AS "preStateId", ot.em_post_state_id AS "postStateId",
            ot.em_action_id AS "actionId", ot.em_costs_id AS "costsId",
            ot.created_at AS "taskDate",
            c.name AS "clientName", c.mobile AS "clientPhone",
            ctr.contract_number AS "contractRef"
       FROM open_tasks ot
       LEFT JOIN clients c ON c.id = ot.client_id
       LEFT JOIN contracts ctr ON ctr.id = ot.contract_id
      WHERE ot.id = $1`,
    [taskId],
  );
  return rows[0] ?? null;
}

// ── GET /emergency-result/:taskId — full result ───────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}:
 *   get:
 *     tags: [Emergency Results]
 *     summary: Retrieve full emergency result
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     responses:
 *       200:
 *         description: Successful retrieval
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.get('/:taskId', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });

    const [preRow, postRow, actionRow, costsRow] = await Promise.all([
      meta.preStateId
        ? pool.query(`SELECT ${TECH_STATE_FIELDS} FROM device_technical_states WHERE id = $1`, [meta.preStateId]).then(r => r.rows[0])
        : null,
      meta.postStateId
        ? pool.query(`SELECT ${TECH_STATE_FIELDS} FROM device_technical_states WHERE id = $1`, [meta.postStateId]).then(r => r.rows[0])
        : null,
      meta.actionId
        ? pool.query(
            `SELECT ema.id, ema.action_type_id AS "actionTypeId", eat.arabic_label AS "actionTypeLabel",
                    ema.actions_taken AS "actionsTaken", ema.parts_used AS "partsUsed",
                    ema.technician_notes AS "technicianNotes", ema.created_at AS "createdAt", ema.updated_at AS "updatedAt"
               FROM emergency_maintenance_actions ema
               LEFT JOIN emergency_action_types eat ON eat.id = ema.action_type_id
              WHERE ema.id = $1`, [meta.actionId]).then(r => r.rows[0])
        : null,
      meta.costsId
        ? pool.query(
            `SELECT erc.id, final_decision AS "finalDecision", closing_notes AS "closingNotes",
                    labor_cost AS "laborCost", parts_cost AS "partsCost", total_cost AS "totalCost",
                    transport_fee AS "transportFee", assembly_fee AS "assemblyFee",
                    discount_percentage AS "discountPercentage", discount_reason_id AS "discountReasonId",
                    payment_method AS "paymentMethod", collected_amount AS "collectedAmount",
                    invoice_notes AS "invoiceNotes",
                    decision_reason_id AS "decisionReasonId",
                    follow_up_priority AS "followUpPriority", follow_up_expected_date AS "followUpExpectedDate",
                    payment_type AS "paymentType", installment_months AS "installmentMonths",
                    payment_delivery AS "paymentDelivery", transfer_company_id AS "transferCompanyId",
                    barter_description AS "barterDescription", barter_value_syp AS "barterValueSyp",
                    pay1_currency AS "pay1Currency", pay1_amount AS "pay1Amount", pay1_exchange_rate AS "pay1ExchangeRate",
                    pay2_currency AS "pay2Currency", pay2_amount AS "pay2Amount", pay2_exchange_rate AS "pay2ExchangeRate",
                    closing_note AS "closingNote",
                    erc.closing_employee_id AS "closingEmployeeId",
                    emp.name AS "closingEmployeeName",
                    erc.created_at AS "createdAt"
               FROM emergency_result_costs erc
               LEFT JOIN employees emp ON emp.id = erc.closing_employee_id
              WHERE erc.id = $1`, [meta.costsId]).then(r => r.rows[0])
        : null,
    ]);

    res.json({
      taskId,
      taskMeta: {
        clientName:   meta.clientName   ?? null,
        clientPhone:  meta.clientPhone  ?? null,
        contractRef:  meta.contractRef  ?? null,
        taskDate:     meta.taskDate     ?? null,
      },
      phases: {
        preState:  preRow  ? mapTechState(preRow)  : null,
        actions:   actionRow ?? null,
        postState: postRow ? mapTechState(postRow) : null,
        costs:     costsRow ? {
          ...costsRow,
          laborCost:          mapNum(costsRow.laborCost),
          partsCost:          mapNum(costsRow.partsCost),
          totalCost:          mapNum(costsRow.totalCost),
          transportFee:       mapNum(costsRow.transportFee),
          assemblyFee:        mapNum(costsRow.assemblyFee),
          discountPercentage: mapNum(costsRow.discountPercentage),
          collectedAmount:    mapNum(costsRow.collectedAmount),
          barterValueSyp:     mapNum(costsRow.barterValueSyp),
          pay1Amount:         mapNum(costsRow.pay1Amount),
          pay1ExchangeRate:   mapNum(costsRow.pay1ExchangeRate),
          pay2Amount:         mapNum(costsRow.pay2Amount),
          pay2ExchangeRate:   mapNum(costsRow.pay2ExchangeRate),
          installmentMonths:  costsRow.installmentMonths ? Number(costsRow.installmentMonths) : null,
        } : null,
      },
      completedPhases: {
        preState:  !!meta.preStateId,
        actions:   !!meta.actionId,
        postState: !!meta.postStateId,
        costs:     !!meta.costsId,
      },
    });
  } catch (err: any) {
    console.error('[emergency-result] GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:taskId/pre-state — save Phase 1 ────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/pre-state:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save or update phase 1 pre-state
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceTechnicalState'
 *     responses:
 *       200:
 *         description: Pre-state saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceTechnicalState'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:taskId/pre-state', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });

    const b = req.body ?? {};
    const recordedBy = (req.authContext as any)?.userId ?? null;

    const fields = [
      'water_source_type', 'water_source_tds', 'water_pressure', 'has_pressure_regulator',
      'tap_tds_before', 'pump_pressure', 'membrane_output_tds', 'membrane_input_tds',
      'membrane_flow', 'flow_cup_size',
      'sterilization_transformer', 'uv_lamp', 'sterilization_sleeve',
      'high_pressure_tds', 'low_pressure_switch', 'tank_tds',
      'valve_type', 'pump_transformer', 'has_fifth_tap', 'device_connection',
      'additional_notes',
    ];
    const camel: Record<string, string> = {
      water_source_type: 'waterSourceType', water_source_tds: 'waterSourceTds',
      water_pressure: 'waterPressure', has_pressure_regulator: 'hasPressureRegulator',
      tap_tds_before: 'tapTdsBefore', pump_pressure: 'pumpPressure',
      membrane_output_tds: 'membraneOutputTds', membrane_input_tds: 'membraneInputTds',
      membrane_flow: 'membraneFlow', flow_cup_size: 'flowCupSize',
      sterilization_transformer: 'sterilizationTransformer', uv_lamp: 'uvLamp',
      sterilization_sleeve: 'sterilizationSleeve', high_pressure_tds: 'highPressureTds',
      low_pressure_switch: 'lowPressureSwitch', tank_tds: 'tankTds',
      valve_type: 'valveType', pump_transformer: 'pumpTransformer',
      has_fifth_tap: 'hasFifthTap', device_connection: 'deviceConnection',
      additional_notes: 'additionalNotes',
    };

    let stateId = meta.preStateId;
    if (stateId) {
      // Update existing
      const sets = fields.map((f, i) => `${f} = $${i + 1}`);
      const vals = fields.map(f => b[camel[f]] ?? null);
      await pool.query(
        `UPDATE device_technical_states SET ${sets.join(', ')} WHERE id = $${fields.length + 1}`,
        [...vals, stateId],
      );
    } else {
      // Insert new
      const cols = ['open_task_id', 'contract_id', 'phase', 'recorded_by', ...fields];
      const vals = [taskId, meta.contractId ?? null, 'pre', recordedBy, ...fields.map(f => b[camel[f]] ?? null)];
      const params = vals.map((_, i) => `$${i + 1}`);
      const { rows } = await pool.query(
        `INSERT INTO device_technical_states (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING id`,
        vals,
      );
      stateId = rows[0].id;
      await pool.query('UPDATE open_tasks SET em_pre_state_id = $1 WHERE id = $2', [stateId, taskId]);
    }

    const { rows: updated } = await pool.query(
      `SELECT ${TECH_STATE_FIELDS} FROM device_technical_states WHERE id = $1`, [stateId],
    );
    res.json(mapTechState(updated[0]));
  } catch (err: any) {
    console.error('[emergency-result] pre-state error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:taskId/post-state — save Phase 3 (same fields, phase='post') ────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/post-state:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save or update phase 3 post-state
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceTechnicalState'
 *     responses:
 *       200:
 *         description: Post-state saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceTechnicalState'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:taskId/post-state', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });

    const b = req.body ?? {};
    const recordedBy = (req.authContext as any)?.userId ?? null;

    const fields = [
      'water_source_type', 'water_source_tds', 'water_pressure', 'has_pressure_regulator',
      'tap_tds_before', 'pump_pressure', 'membrane_output_tds', 'membrane_input_tds',
      'membrane_flow', 'flow_cup_size',
      'sterilization_transformer', 'uv_lamp', 'sterilization_sleeve',
      'high_pressure_tds', 'low_pressure_switch', 'tank_tds',
      'valve_type', 'pump_transformer', 'has_fifth_tap', 'device_connection',
      'additional_notes',
    ];
    const camel: Record<string, string> = {
      water_source_type: 'waterSourceType', water_source_tds: 'waterSourceTds',
      water_pressure: 'waterPressure', has_pressure_regulator: 'hasPressureRegulator',
      tap_tds_before: 'tapTdsBefore', pump_pressure: 'pumpPressure',
      membrane_output_tds: 'membraneOutputTds', membrane_input_tds: 'membraneInputTds',
      membrane_flow: 'membraneFlow', flow_cup_size: 'flowCupSize',
      sterilization_transformer: 'sterilizationTransformer', uv_lamp: 'uvLamp',
      sterilization_sleeve: 'sterilizationSleeve', high_pressure_tds: 'highPressureTds',
      low_pressure_switch: 'lowPressureSwitch', tank_tds: 'tankTds',
      valve_type: 'valveType', pump_transformer: 'pumpTransformer',
      has_fifth_tap: 'hasFifthTap', device_connection: 'deviceConnection',
      additional_notes: 'additionalNotes',
    };

    let stateId = meta.postStateId;
    if (stateId) {
      const sets = fields.map((f, i) => `${f} = $${i + 1}`);
      const vals = fields.map(f => b[camel[f]] ?? null);
      await pool.query(
        `UPDATE device_technical_states SET ${sets.join(', ')} WHERE id = $${fields.length + 1}`,
        [...vals, stateId],
      );
    } else {
      const cols = ['open_task_id', 'contract_id', 'phase', 'recorded_by', ...fields];
      const vals = [taskId, meta.contractId ?? null, 'post', recordedBy, ...fields.map(f => b[camel[f]] ?? null)];
      const params = vals.map((_, i) => `$${i + 1}`);
      const { rows } = await pool.query(
        `INSERT INTO device_technical_states (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING id`,
        vals,
      );
      stateId = rows[0].id;
      await pool.query('UPDATE open_tasks SET em_post_state_id = $1 WHERE id = $2', [stateId, taskId]);
    }

    const { rows: updated } = await pool.query(
      `SELECT ${TECH_STATE_FIELDS} FROM device_technical_states WHERE id = $1`, [stateId],
    );
    res.json(mapTechState(updated[0]));
  } catch (err: any) {
    console.error('[emergency-result] post-state error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:taskId/actions — save Phase 2 ──────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/actions:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save or update phase 2 maintenance actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmergencyMaintenanceAction'
 *     responses:
 *       200:
 *         description: Actions saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmergencyMaintenanceAction'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:taskId/actions', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });

    const { actionTypeId, actionsTaken, partsUsed, technicianNotes } = req.body ?? {};
    const recordedBy = (req.authContext as any)?.userId ?? null;

    let actionId = meta.actionId;
    if (actionId) {
      await pool.query(
        `UPDATE emergency_maintenance_actions
            SET action_type_id = $1, actions_taken = $2, parts_used = $3::jsonb,
                technician_notes = $4, updated_at = NOW()
          WHERE id = $5`,
        [actionTypeId ?? null, actionsTaken ?? null, JSON.stringify(partsUsed ?? []), technicianNotes ?? null, actionId],
      );
    } else {
      const { rows } = await pool.query(
        `INSERT INTO emergency_maintenance_actions
           (open_task_id, action_type_id, actions_taken, parts_used, technician_notes, recorded_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
        [taskId, actionTypeId ?? null, actionsTaken ?? null, JSON.stringify(partsUsed ?? []), technicianNotes ?? null, recordedBy],
      );
      actionId = rows[0].id;
      await pool.query('UPDATE open_tasks SET em_action_id = $1 WHERE id = $2', [actionId, taskId]);
    }

    const { rows } = await pool.query(
      `SELECT ema.id, ema.action_type_id AS "actionTypeId", eat.arabic_label AS "actionTypeLabel",
              ema.actions_taken AS "actionsTaken", ema.parts_used AS "partsUsed",
              ema.technician_notes AS "technicianNotes", ema.updated_at AS "updatedAt"
         FROM emergency_maintenance_actions ema
         LEFT JOIN emergency_action_types eat ON eat.id = ema.action_type_id
        WHERE ema.id = $1`, [actionId],
    );
    res.json(rows[0]);
  } catch (err: any) {
    console.error('[emergency-result] actions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:taskId/costs — save Phase 4 (final decision + financials) ───────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/costs:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save or update phase 4 costs and financials
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmergencyResultCosts'
 *     responses:
 *       200:
 *         description: Costs saved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:taskId/costs', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });

    const {
      finalDecision, closingNotes,
      partsCost, transportFee, assemblyFee,
      discountPercentage, discountReasonId, discountReasonText,
      paymentMethod, collectedAmount, invoiceNotes,
      decisionReasonId, decisionReasonText,
      followUpPriority, followUpExpectedDate,
      // new payment fields
      paymentType, installmentMonths,
      paymentDelivery, transferCompanyId,
      barterDescription, barterValueSyp,
      pay1Currency, pay1Amount, pay1ExchangeRate,
      pay2Currency, pay2Amount, pay2ExchangeRate,
      closingNote,
      closingEmployeeId,
    } = req.body ?? {};

    if (!finalDecision) return res.status(400).json({ error: 'finalDecision مطلوب' });
    if (!['resolved','unresolved','needs_followup','cancelled'].includes(finalDecision)) {
      return res.status(400).json({ error: 'finalDecision غير صالح' });
    }

    const recordedBy = (req.authContext as any)?.userId ?? null;
    const pCost  = Number(partsCost)          || 0;
    const tFee   = Number(transportFee)       || 0;
    const aFee   = Number(assemblyFee)        || 0;
    const discPct = Number(discountPercentage) || 0;
    const subtotal = pCost + tFee + aFee;
    const discAmt  = Math.round(subtotal * discPct / 100);
    const total    = subtotal - discAmt;

    // ── Status mapping ──────────────────────────────────────────────────────
    const statusMap: Record<string, string> = {
      resolved:      'completed',
      unresolved:    'needs_follow_up',
      needs_followup:'needs_follow_up',
      cancelled:     'cancelled',
    };
    const newTaskStatus = statusMap[finalDecision] ?? 'needs_follow_up';

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      // Compute total paid in SYP from multi-currency inputs
      const p1Syp = pay1Currency === 'usd'
        ? (Number(pay1Amount) || 0) * (Number(pay1ExchangeRate) || 0)
        : (Number(pay1Amount) || 0);
      const p2Syp = pay2Currency
        ? (pay2Currency === 'usd'
          ? (Number(pay2Amount) || 0) * (Number(pay2ExchangeRate) || 0)
          : (Number(pay2Amount) || 0))
        : 0;
      const totalPaidSyp = p1Syp + p2Syp;

      const costsVals = [
        finalDecision, closingNotes ?? null,
        0, pCost, total,
        paymentMethod ?? null, totalPaidSyp, invoiceNotes ?? null,
        tFee, aFee, discPct,
        discountReasonId ?? null, discountReasonText ?? null,
        decisionReasonId ?? null, decisionReasonText ?? null,
        // new payment fields
        paymentType ?? null, installmentMonths ? Number(installmentMonths) : null,
        paymentDelivery ?? null, transferCompanyId ? Number(transferCompanyId) : null,
        barterDescription ?? null, barterValueSyp ? Number(barterValueSyp) : null,
        pay1Currency ?? null, pay1Amount ? Number(pay1Amount) : null, pay1ExchangeRate ? Number(pay1ExchangeRate) : null,
        pay2Currency ?? null, pay2Amount ? Number(pay2Amount) : null, pay2ExchangeRate ? Number(pay2ExchangeRate) : null,
        closingNote ?? null,
        closingEmployeeId ? Number(closingEmployeeId) : null,
      ];

      let costsId = meta.costsId;
      if (costsId) {
        await db.query(
          `UPDATE emergency_result_costs
              SET final_decision = $1, closing_notes = $2, labor_cost = $3, parts_cost = $4,
                  total_cost = $5, payment_method = $6, collected_amount = $7,
                  invoice_notes = $8, transport_fee = $9, assembly_fee = $10,
                  discount_percentage = $11, discount_reason_id = $12, discount_reason_text = $13,
                  decision_reason_id = $14, decision_reason_text = $15,
                  payment_type = $16, installment_months = $17,
                  payment_delivery = $18, transfer_company_id = $19,
                  barter_description = $20, barter_value_syp = $21,
                  pay1_currency = $22, pay1_amount = $23, pay1_exchange_rate = $24,
                  pay2_currency = $25, pay2_amount = $26, pay2_exchange_rate = $27,
                  closing_note = $28,
                  closing_employee_id = $29,
                  updated_at = NOW()
            WHERE id = $30`,
          [...costsVals, costsId],
        );
      } else {
        const { rows } = await db.query(
          `INSERT INTO emergency_result_costs
             (open_task_id, final_decision, closing_notes, labor_cost, parts_cost, total_cost,
              payment_method, collected_amount, invoice_notes, transport_fee, assembly_fee,
              discount_percentage, discount_reason_id, discount_reason_text,
              decision_reason_id, decision_reason_text,
              payment_type, installment_months,
              payment_delivery, transfer_company_id,
              barter_description, barter_value_syp,
              pay1_currency, pay1_amount, pay1_exchange_rate,
              pay2_currency, pay2_amount, pay2_exchange_rate,
              closing_note, closing_employee_id, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                   $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING id`,
          [taskId, ...costsVals, recordedBy],
        );
        costsId = rows[0].id;
        await db.query('UPDATE open_tasks SET em_costs_id = $1 WHERE id = $2', [costsId, taskId]);
      }

      // Update open_task status
      await db.query('UPDATE open_tasks SET status = $1 WHERE id = $2', [newTaskStatus, taskId]);

      // ── needs_followup: create new emergency task ───────────────────────
      let followUpTaskId: number | null = null;
      if (finalDecision === 'needs_followup' && meta.contractId) {
        const { rows: newTaskRows } = await db.query(
          `INSERT INTO open_tasks
             (client_id, branch_id, contract_id, task_type, task_family, reason,
              status, priority, expected_date, source, notes, created_by)
           SELECT client_id, branch_id, $1, 'emergency_maintenance', 'emergency',
                  'service_request', 'needs_follow_up', $2, $3::date, 'emergency_follow_up', $4, $5
             FROM open_tasks WHERE id = $6
           RETURNING id`,
          [
            meta.contractId,
            followUpPriority ?? 'High',
            followUpExpectedDate ?? null,
            closingNotes?.trim() || null,
            recordedBy,
            taskId,
          ],
        );
        followUpTaskId = newTaskRows[0]?.id ?? null;

        if (followUpTaskId) {
          await db.query(
            'UPDATE emergency_result_costs SET follow_up_task_id = $1, follow_up_priority = $2, follow_up_expected_date = $3 WHERE id = $4',
            [followUpTaskId, followUpPriority ?? 'High', followUpExpectedDate ?? null, costsId],
          );
        }
      }

      await db.query('COMMIT');

      const result = { costsId, followUpTaskId, taskStatus: newTaskStatus };
      return res.json(result);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  } catch (err: any) {
    console.error('[emergency-result] costs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:taskId/parts — save parts list ─────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/parts:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Update spare parts list for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               parts:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/EmergencyResultPart'
 *     responses:
 *       200:
 *         description: Parts list updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmergencyResultPart'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/:taskId/parts', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const { parts } = req.body ?? {};
    if (!Array.isArray(parts)) return res.status(400).json({ error: 'parts must be array' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Delete existing parts for this task
      await db.query('DELETE FROM emergency_result_parts WHERE open_task_id = $1', [taskId]);
      // Insert new parts
      const rows: any[] = [];
      for (const p of parts) {
        if (!p.partNameSnapshot?.trim()) continue;
        const { rows: inserted } = await db.query(
          `INSERT INTO emergency_result_parts
             (open_task_id, spare_part_id, part_name_snapshot, part_code_snapshot,
              maintenance_type, unit_price, quantity, retrieved,
              no_retrieval_reason_id, no_retrieval_reason_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            taskId,
            p.sparePartId ?? null,
            p.partNameSnapshot.trim(),
            p.partCodeSnapshot ?? null,
            p.maintenanceType ?? null,
            Number(p.unitPrice) || 0,
            Number(p.quantity) || 1,
            p.retrieved !== false,
            p.noRetrievalReasonId ?? null,
            p.noRetrievalReasonText ?? null,
          ],
        );
        rows.push(inserted[0]);
      }
      await db.query('COMMIT');
      res.json(rows);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:taskId/parts — get parts list ──────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/parts:
 *   get:
 *     tags: [Emergency Results]
 *     summary: Retrieve spare parts list for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     responses:
 *       200:
 *         description: Successful retrieval
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmergencyResultPart'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:taskId/parts', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT erp.id, erp.spare_part_id AS "sparePartId",
              erp.part_name_snapshot AS "partNameSnapshot",
              erp.part_code_snapshot AS "partCodeSnapshot",
              erp.maintenance_type AS "maintenanceType",
              erp.unit_price AS "unitPrice", erp.quantity, erp.line_total AS "lineTotal",
              erp.retrieved, erp.no_retrieval_reason_id AS "noRetrievalReasonId",
              erp.no_retrieval_reason_text AS "noRetrievalReasonText",
              sl.value AS "noRetrievalReasonLabel"
         FROM emergency_result_parts erp
         LEFT JOIN system_lists sl ON sl.id = erp.no_retrieval_reason_id
        WHERE erp.open_task_id = $1
        ORDER BY erp.id`,
      [req.params.taskId],
    );
    res.json(rows.map((r: any) => ({ ...r, unitPrice: Number(r.unitPrice), lineTotal: Number(r.lineTotal) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /device/:contractId/history — device technical history ────────────────
/**
 * @swagger
 * /api/emergency-result/device/{contractId}/history:
 *   get:
 *     tags: [Emergency Results]
 *     summary: Retrieve device technical states history by contract ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: contractId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Contract ID
 *     responses:
 *       200:
 *         description: Successful retrieval
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DeviceTechnicalState'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/device/:contractId/history', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${TECH_STATE_FIELDS},
              ot.task_type AS "taskType",
              et.problem_description AS "problemDescription"
         FROM device_technical_states dts
         LEFT JOIN open_tasks ot ON ot.id = dts.open_task_id
         LEFT JOIN emergency_tickets et ON et.open_task_id = dts.open_task_id
        WHERE dts.contract_id = $1
        ORDER BY dts.created_at DESC`,
      [req.params.contractId],
    );
    res.json(rows.map(mapTechState));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:taskId/payment-entries ─────────────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/payment-entries:
 *   get:
 *     tags: [Emergency Results]
 *     summary: Retrieve payment entries for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     responses:
 *       200:
 *         description: Successful retrieval
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmergencyPaymentEntry'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:taskId/payment-entries', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta?.costsId) return res.json([]);
    const { rows } = await pool.query(
      `SELECT epe.id, epe.method, epe.amount_value AS "amountValue",
              epe.currency, epe.exchange_rate AS "exchangeRate",
              epe.amount_syp AS "amountSyp",
              epe.transfer_company_id AS "transferCompanyId",
              sl.value AS "transferCompanyName",
              epe.barter_description AS "barterDescription",
              epe.sort_order AS "sortOrder"
         FROM emergency_payment_entries epe
         LEFT JOIN system_lists sl ON sl.id = epe.transfer_company_id
        WHERE epe.costs_id = $1
        ORDER BY epe.sort_order, epe.id`,
      [meta.costsId],
    );
    res.json(rows.map(r => ({ ...r, amountValue: mapNum(r.amountValue), exchangeRate: mapNum(r.exchangeRate), amountSyp: mapNum(r.amountSyp) })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:taskId/payment-entries ─────────────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/payment-entries:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save payment entries for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entries:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/EmergencyPaymentEntry'
 *     responses:
 *       200:
 *         description: Payment entries saved successfully
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.put('/:taskId/payment-entries', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!meta.costsId) return res.status(400).json({ error: 'يجب حفظ التكاليف أولاً' });

    const { entries } = req.body ?? {};
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be array' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM emergency_payment_entries WHERE costs_id = $1', [meta.costsId]);

      let totalSyp = 0;
      const saved: any[] = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const amtVal = Number(e.amountValue) || 0;
        const rate   = Number(e.exchangeRate) || 1;
        const amtSyp = e.currency === 'usd' ? amtVal * rate : amtVal;
        totalSyp += amtSyp;
        const { rows } = await db.query(
          `INSERT INTO emergency_payment_entries
             (costs_id, method, amount_value, currency, exchange_rate, amount_syp,
              transfer_company_id, barter_description, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [meta.costsId, e.method, amtVal, e.currency || 'syp', e.currency === 'usd' ? rate : null,
           amtSyp, e.transferCompanyId ? Number(e.transferCompanyId) : null,
           e.barterDescription ?? null, i],
        );
        saved.push({ ...e, id: rows[0].id, amountSyp: amtSyp });
      }
      // Update collected_amount
      await db.query('UPDATE emergency_result_costs SET collected_amount = $1 WHERE id = $2', [totalSyp, meta.costsId]);
      await db.query('COMMIT');
      res.json({ entries: saved, totalSyp });
    } catch (err) { await db.query('ROLLBACK'); throw err; }
    finally { db.release(); }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /:taskId/installments ─────────────────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/installments:
 *   get:
 *     tags: [Emergency Results]
 *     summary: Retrieve installment plan for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     responses:
 *       200:
 *         description: Successful retrieval
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 installments:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EmergencyInstallment'
 *                 confirmed:
 *                   type: boolean
 *                 hasFirstPayment:
 *                   type: boolean
 *                 installmentsCount:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:taskId/installments', requirePermission('marketing_visits.view'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta?.costsId) return res.json({ installments: [], confirmed: false, hasFirstPayment: false });

    const { rows: costsRow } = await pool.query(
      `SELECT has_first_payment AS "hasFirstPayment",
              installments_count AS "installmentsCount",
              installments_confirmed AS "installmentsConfirmed"
         FROM emergency_result_costs WHERE id = $1`, [meta.costsId],
    );
    const { rows } = await pool.query(
      `SELECT id, installment_number AS "installmentNumber",
              due_date AS "dueDate", amount_syp AS "amountSyp",
              status, due_id AS "dueId"
         FROM emergency_installments
        WHERE costs_id = $1
        ORDER BY installment_number`,
      [meta.costsId],
    );
    res.json({
      installments: rows.map(r => ({ ...r, amountSyp: mapNum(r.amountSyp) })),
      confirmed:       costsRow[0]?.installmentsConfirmed ?? false,
      hasFirstPayment: costsRow[0]?.hasFirstPayment ?? false,
      installmentsCount: costsRow[0]?.installmentsCount ?? null,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:taskId/installments — save draft schedule ───────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/installments:
 *   put:
 *     tags: [Emergency Results]
 *     summary: Save installment draft plan for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               installments:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/EmergencyInstallment'
 *               hasFirstPayment:
 *                 type: boolean
 *               installmentsCount:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Installment draft saved successfully
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.put('/:taskId/installments', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!meta.costsId) return res.status(400).json({ error: 'يجب حفظ التكاليف أولاً' });

    const { installments, hasFirstPayment, installmentsCount } = req.body ?? {};
    if (!Array.isArray(installments)) return res.status(400).json({ error: 'installments must be array' });

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Delete unconfirmed installments only (keep confirmed/paid)
      await db.query(
        `DELETE FROM emergency_installments WHERE costs_id = $1 AND due_id IS NULL`,
        [meta.costsId],
      );
      for (const inst of installments) {
        await db.query(
          `INSERT INTO emergency_installments
             (costs_id, open_task_id, installment_number, due_date, amount_syp)
           VALUES ($1,$2,$3,$4,$5)`,
          [meta.costsId, taskId, inst.installmentNumber, inst.dueDate, Number(inst.amountSyp) || 0],
        );
      }
      await db.query(
        `UPDATE emergency_result_costs
            SET has_first_payment = $1, installments_count = $2, installments_confirmed = FALSE
          WHERE id = $3`,
        [!!hasFirstPayment, installmentsCount ?? installments.length, meta.costsId],
      );
      await db.query('COMMIT');
      res.json({ saved: installments.length });
    } catch (err) { await db.query('ROLLBACK'); throw err; }
    finally { db.release(); }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── POST /:taskId/installments/confirm ────────────────────────────────────────
/**
 * @swagger
 * /api/emergency-result/{taskId}/installments/confirm:
 *   post:
 *     tags: [Emergency Results]
 *     summary: Confirm installment plan and generate dues for the task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Open Task ID
 *     responses:
 *       200:
 *         description: Installment plan confirmed successfully
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.post('/:taskId/installments/confirm', requirePermission('marketing_visits.update_result'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const meta = await getTaskMeta(taskId);
    if (!meta) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!meta.costsId) return res.status(400).json({ error: 'يجب حفظ التكاليف أولاً' });
    if (!meta.contractId) return res.status(400).json({ error: 'لا يوجد عقد مرتبط بالمهمة' });

    // Load installments + costs + first payment total
    const { rows: instRows } = await pool.query(
      `SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate", amount_syp AS "amountSyp"
         FROM emergency_installments WHERE costs_id = $1 AND due_id IS NULL
         ORDER BY installment_number`,
      [meta.costsId],
    );
    const { rows: costRow } = await pool.query(
      `SELECT total_cost AS "totalCost",
              has_first_payment AS "hasFirstPayment"
         FROM emergency_result_costs WHERE id = $1`, [meta.costsId],
    );
    const { rows: entryRows } = await pool.query(
      `SELECT SUM(amount_syp) AS total FROM emergency_payment_entries WHERE costs_id = $1`,
      [meta.costsId],
    );

    const grandTotal      = mapNum(costRow[0]?.totalCost) ?? 0;
    const firstPaymentSyp = mapNum(entryRows[0]?.total) ?? 0;
    const installableAmount = grandTotal - firstPaymentSyp;
    const instTotal = instRows.reduce((s: number, r: any) => s + (mapNum(r.amountSyp) ?? 0), 0);

    if (Math.abs(instTotal - installableAmount) > 1) {
      return res.status(400).json({
        error: `مجموع الأقساط (${instTotal.toLocaleString()} ل.س) لا يساوي المبلغ المقسّط (${installableAmount.toLocaleString()} ل.س)`,
        instTotal, installableAmount,
      });
    }

    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      for (const inst of instRows) {
        const { rows: dueRows } = await db.query(
          `INSERT INTO dues (contract_id, type, scheduled_date, original_amount, remaining_balance, status)
           VALUES ($1, 'maintenance_installment', $2, $3, $3, 'Pending') RETURNING id`,
          [meta.contractId, inst.dueDate, mapNum(inst.amountSyp)],
        );
        await db.query(
          `UPDATE emergency_installments SET due_id = $1 WHERE id = $2`,
          [dueRows[0].id, inst.id],
        );
      }
      await db.query(
        `UPDATE emergency_result_costs SET installments_confirmed = TRUE WHERE id = $1`,
        [meta.costsId],
      );
      await db.query('COMMIT');
      res.json({ confirmed: true, duesCreated: instRows.length });
    } catch (err) { await db.query('ROLLBACK'); throw err; }
    finally { db.release(); }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
