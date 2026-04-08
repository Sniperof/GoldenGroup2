import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const mapTaskListRows = (rows: any[]) => {
  const taskLists = new Map<string, any>();

  rows.forEach((row) => {
    if (!taskLists.has(row.id)) {
      taskLists.set(row.id, {
        id: row.id,
        teamKey: row.teamKey,
        date: row.date,
        createdAt: row.createdAt,
        items: [],
      });
    }

    if (row.itemId) {
      taskLists.get(row.id).items.push({
        id: row.itemId,
        entityType: row.entityType,
        entityId: row.entityId,
        name: row.itemName,
        mobile: row.itemMobile,
        contactNumber: row.contactNumber,
        contactLabel: row.contactLabel,
        addressText: row.addressText,
        geoUnitId: row.geoUnitId,
        status: row.itemStatus,
        callOutcome: row.callOutcome,
      });
    }
  });

  return Array.from(taskLists.values());
};

router.get('/snapshot', async (_req, res) => {
  const [taskListRes, appointmentsRes, callLogsRes] = await Promise.all([
    pool.query(`
      SELECT
        tl.id,
        tl.team_key AS "teamKey",
        tl.date,
        tl.created_at AS "createdAt",
        i.id AS "itemId",
        i.entity_type AS "entityType",
        i.entity_id AS "entityId",
        i.name AS "itemName",
        i.mobile AS "itemMobile",
        i.contact_number AS "contactNumber",
        i.contact_label AS "contactLabel",
        i.address_text AS "addressText",
        i.geo_unit_id AS "geoUnitId",
        i.status AS "itemStatus",
        i.call_outcome AS "callOutcome"
      FROM telemarketing_task_lists tl
      LEFT JOIN telemarketing_task_list_items i ON i.task_list_id = tl.id
      ORDER BY tl.date DESC, tl.created_at DESC, i.id
    `),
    pool.query(`
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        customer_name AS "customerName",
        customer_address AS "customerAddress",
        customer_mobile AS "customerMobile",
        team_key AS "teamKey",
        date,
        time_slot AS "timeSlot",
        occupation,
        water_source AS "waterSource",
        notes,
        created_at AS "createdAt",
        created_by AS "createdBy"
      FROM telemarketing_appointments
      ORDER BY created_at DESC
    `),
    pool.query(`
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        task_list_id AS "taskListId",
        team_key AS "teamKey",
        outcome,
        contact_label AS "contactLabel",
        contact_number AS "contactNumber",
        notes,
        timestamp,
        called_by AS "calledBy",
        communication_method AS "communicationMethod"
      FROM telemarketing_call_logs
      ORDER BY timestamp DESC
    `),
  ]);

  res.json({
    taskLists: mapTaskListRows(taskListRes.rows),
    appointments: appointmentsRes.rows,
    callLogs: callLogsRes.rows,
  });
});

router.post('/task-lists/upsert', async (req, res) => {
  const { id, teamKey, date, createdAt, items } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM telemarketing_task_lists WHERE team_key = $1 AND date = $2 LIMIT 1`,
      [teamKey, date],
    );

    const finalTaskListId = existing.rows[0]?.id || id;

    if (existing.rows[0]) {
      await client.query(
        `UPDATE telemarketing_task_lists SET created_at = $1 WHERE id = $2`,
        [createdAt || new Date().toISOString(), finalTaskListId],
      );
    } else {
      await client.query(
        `
          INSERT INTO telemarketing_task_lists (id, team_key, date, created_at)
          VALUES ($1,$2,$3,$4)
        `,
        [finalTaskListId, teamKey, date, createdAt || new Date().toISOString()],
      );
    }

    await client.query('DELETE FROM telemarketing_task_list_items WHERE task_list_id = $1', [finalTaskListId]);

    for (const item of items || []) {
      await client.query(
        `
          INSERT INTO telemarketing_task_list_items (
            id, task_list_id, entity_type, entity_id, name, mobile, contact_number,
            contact_label, address_text, geo_unit_id, status, call_outcome
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          item.id,
          finalTaskListId,
          item.entityType,
          item.entityId,
          item.name,
          item.mobile,
          item.contactNumber || null,
          item.contactLabel || null,
          item.addressText || null,
          item.geoUnitId || null,
          item.status || 'pending',
          item.callOutcome || null,
        ],
      );
    }

    await client.query('COMMIT');
    res.json({ id: finalTaskListId, teamKey, date, createdAt: createdAt || new Date().toISOString(), items: items || [] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.patch('/task-lists/:taskListId/items/:itemId', async (req, res) => {
  const { status, callOutcome } = req.body;
  const { rows } = await pool.query(
    `
      UPDATE telemarketing_task_list_items
      SET status = $1, call_outcome = $2
      WHERE task_list_id = $3 AND id = $4
      RETURNING
        id,
        task_list_id AS "taskListId",
        entity_type AS "entityType",
        entity_id AS "entityId",
        name,
        mobile,
        contact_number AS "contactNumber",
        contact_label AS "contactLabel",
        address_text AS "addressText",
        geo_unit_id AS "geoUnitId",
        status,
        call_outcome AS "callOutcome"
    `,
    [status, callOutcome || null, req.params.taskListId, req.params.itemId],
  );

  if (!rows[0]) {
    res.status(404).json({ message: 'عنصر القائمة غير موجود' });
    return;
  }

  res.json(rows[0]);
});

router.post('/call-logs', async (req, res) => {
  const log = req.body;
  const { rows } = await pool.query(
    `
      INSERT INTO telemarketing_call_logs (
        id, entity_type, entity_id, task_list_id, team_key, outcome,
        contact_label, contact_number, notes, timestamp, called_by, communication_method
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        task_list_id AS "taskListId",
        team_key AS "teamKey",
        outcome,
        contact_label AS "contactLabel",
        contact_number AS "contactNumber",
        notes,
        timestamp,
        called_by AS "calledBy",
        communication_method AS "communicationMethod"
    `,
    [
      log.id,
      log.entityType,
      log.entityId,
      log.taskListId || null,
      log.teamKey,
      log.outcome,
      log.contactLabel || null,
      log.contactNumber || null,
      log.notes || '',
      log.timestamp || new Date().toISOString(),
      log.calledBy || null,
      log.communicationMethod || null,
    ],
  );

  res.json(rows[0]);
});

router.post('/appointments', async (req, res) => {
  const appointment = req.body;

  const conflict = await pool.query(
    `SELECT id FROM telemarketing_appointments WHERE team_key = $1 AND date = $2 AND time_slot = $3 LIMIT 1`,
    [appointment.teamKey, appointment.date, appointment.timeSlot],
  );

  if (conflict.rows[0]) {
    res.status(409).json({ message: 'هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.' });
    return;
  }

  const { rows } = await pool.query(
    `
      INSERT INTO telemarketing_appointments (
        id, entity_type, entity_id, customer_name, customer_address, customer_mobile,
        team_key, date, time_slot, occupation, water_source, notes, created_at, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        customer_name AS "customerName",
        customer_address AS "customerAddress",
        customer_mobile AS "customerMobile",
        team_key AS "teamKey",
        date,
        time_slot AS "timeSlot",
        occupation,
        water_source AS "waterSource",
        notes,
        created_at AS "createdAt",
        created_by AS "createdBy"
    `,
    [
      appointment.id,
      appointment.entityType,
      appointment.entityId,
      appointment.customerName,
      appointment.customerAddress || null,
      appointment.customerMobile || null,
      appointment.teamKey,
      appointment.date,
      appointment.timeSlot,
      appointment.occupation || '',
      appointment.waterSource || '',
      appointment.notes || '',
      appointment.createdAt || new Date().toISOString(),
      appointment.createdBy || null,
    ],
  );

  res.json(rows[0]);
});

export default router;
