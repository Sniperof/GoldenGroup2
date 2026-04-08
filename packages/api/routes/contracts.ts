import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const contractSelect = `
  c.id, c.contract_number AS "contractNumber", c.customer_id AS "customerId",
  c.customer_name AS "customerName", c.contract_date AS "contractDate",
  c.source_visit AS "sourceVisit", c.device_model_id AS "deviceModelId",
  c.device_model_name AS "deviceModelName", c.serial_number AS "serialNumber",
  c.maintenance_plan AS "maintenancePlan", c.base_price AS "basePrice",
  c.final_price AS "finalPrice", c.payment_type AS "paymentType",
  c.down_payment AS "downPayment", c.installments_count AS "installmentsCount",
  c.delivery_date AS "deliveryDate", c.installation_date AS "installationDate",
  c.status, c.created_at AS "createdAt"
`;

const dueSelect = `
  id, contract_id AS "contractId", type, scheduled_date AS "scheduledDate",
  adjusted_date AS "adjustedDate", original_amount AS "originalAmount",
  remaining_balance AS "remainingBalance", assigned_telemarketer_id AS "assignedTelemarketerId",
  status, escalated
`;

router.get('/', async (_req, res) => {
  const { rows: contracts } = await pool.query(`SELECT ${contractSelect} FROM contracts c ORDER BY c.id`);
  const { rows: dues } = await pool.query(`SELECT ${dueSelect} FROM dues ORDER BY contract_id, id`);
  const result = contracts.map(c => ({
    ...c,
    basePrice: Number(c.basePrice),
    finalPrice: Number(c.finalPrice),
    downPayment: Number(c.downPayment),
    dues: dues.filter(d => d.contractId === c.id).map(d => ({
      ...d,
      originalAmount: Number(d.originalAmount),
      remainingBalance: Number(d.remainingBalance),
    }))
  }));
  res.json(result);
});

router.post('/', async (req, res) => {
  const c = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO contracts (contract_number, customer_id, customer_name, contract_date,
        source_visit, device_model_id, device_model_name, serial_number, maintenance_plan,
        base_price, final_price, payment_type, down_payment, installments_count,
        delivery_date, installation_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING ${contractSelect.replace(/c\./g, '')}`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
       c.maintenancePlan, c.basePrice, c.finalPrice, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate, c.installationDate,
       c.status || 'draft']
    );
    const contract = rows[0];

    const duesResult: any[] = [];
    if (c.dues && c.dues.length > 0) {
      for (const d of c.dues) {
        const { rows: dRows } = await client.query(
          `INSERT INTO dues (contract_id, type, scheduled_date, adjusted_date,
            original_amount, remaining_balance, assigned_telemarketer_id, status, escalated)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${dueSelect}`,
          [contract.id, d.type, d.scheduledDate, d.adjustedDate,
           d.originalAmount, d.remainingBalance, d.assignedTelemarketerId || null,
           d.status || 'Pending', d.escalated || false]
        );
        duesResult.push(dRows[0]);
      }
    }

    await client.query('COMMIT');
    res.json({ ...contract, basePrice: Number(contract.basePrice), finalPrice: Number(contract.finalPrice), downPayment: Number(contract.downPayment), dues: duesResult });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const c = req.body;
  const { rows } = await pool.query(
    `UPDATE contracts SET contract_number=$1, customer_id=$2, customer_name=$3,
      contract_date=$4, source_visit=$5, device_model_id=$6, device_model_name=$7,
      serial_number=$8, maintenance_plan=$9, base_price=$10, final_price=$11,
      payment_type=$12, down_payment=$13, installments_count=$14,
      delivery_date=$15, installation_date=$16, status=$17
    WHERE id=$18 RETURNING ${contractSelect.replace(/c\./g, '')}`,
    [c.contractNumber, c.customerId, c.customerName, c.contractDate,
     c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
     c.maintenancePlan, c.basePrice, c.finalPrice, c.paymentType,
     c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate, c.installationDate,
     c.status || 'draft', req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
