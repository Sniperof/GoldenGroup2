// ============================================================
// services/employeeActivityLog.ts — read side of employee_activity_log (migration 480)
// ============================================================
// The log is written only by database triggers; this module just reads it.

import pool from '../db.js';

export async function listEmployeeActivity(employeeId: number, limit = 300) {
  const { rows } = await pool.query(
    `SELECT l.id, l.event_type AS "eventType", l.field_key AS "fieldKey",
            l.old_value AS "oldValue", l.new_value AS "newValue", l.reason,
            l.reference_id AS "referenceId", l.role, l.source,
            l.created_at AS "createdAt", hu.name AS "performedByName"
       FROM employee_activity_log l
       LEFT JOIN hr_users hu ON hu.id = l.performed_by
      WHERE l.employee_id = $1
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2`,
    [employeeId, limit],
  );
  return rows;
}
