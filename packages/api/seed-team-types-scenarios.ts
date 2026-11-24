/**
 * DEC-026 scenario seed — LOCAL TEST COPY ONLY (golden_crm_teamtypes_test).
 *
 * Run:  DATABASE_URL=postgresql://postgres:***@localhost:5432/golden_crm_teamtypes_test \
 *       npx tsx seed-team-types-scenarios.ts
 *
 * Refuses to run on any other database. It:
 *   • sets the test password below on the admin and two branch managers
 *     (only inside the test copy);
 *   • builds the client situations the scenarios need in branch 1001,
 *     zone Z (جرمانا) and zone Z2 (ضاحية قدسيا), for planning day D.
 * Re-running is safe: it removes its own tasks first.
 */
import bcrypt from 'bcryptjs';
import pool from './db.js';

export const TEST_DB = 'golden_crm_teamtypes_test';
export const TEST_PASSWORD = 'TeamTypes!Test1';
export const TEST_USERS = { admin: 'superadmin', manager1001: 'Said2', manager1002: 'BManED' } as const;
export const BRANCH = 1001;
export const ZONE = 5162;   // جرمانا
export const ZONE2 = 5248;  // ضاحية قدسيا
export const DAY = '2026-11-26';
const SEED_NOTE = 'seed:team-types-scenarios';

export interface SeededClients {
  clean: number;      // collection only, Z
  mixed: number;      // collection + periodic maintenance, Z
  emergency: number;  // collection + emergency maintenance, Z
  twoLocations: number; // collection at Z + periodic maintenance at Z2
  demo: number;       // device demo only, Z
}

async function pickClients(count: number, needDevice: boolean): Promise<Array<{ id: number; deviceId: number | null }>> {
  const { rows } = await pool.query(
    `SELECT c.id, (SELECT d.id FROM installed_devices d WHERE d.customer_id = c.id ORDER BY d.id LIMIT 1) AS "deviceId"
       FROM clients c
      WHERE c.branch_id = $1 AND c.neighborhood = $2 AND c.deleted_at IS NULL AND c.do_not_contact = FALSE
        AND COALESCE(c.is_active, TRUE)
        AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.client_id = c.id
                         AND ot.status NOT IN ('completed', 'cancelled', 'closed')
                         AND COALESCE(ot.notes, '') <> $3)
        AND ($4::boolean = FALSE OR EXISTS (SELECT 1 FROM installed_devices d WHERE d.customer_id = c.id))
      ORDER BY c.id
      LIMIT $5`,
    [BRANCH, ZONE, SEED_NOTE, needDevice, count],
  );
  if (rows.length < count) throw new Error(`not enough clients (need ${count}, got ${rows.length})`);
  return rows.map(r => ({ id: Number(r.id), deviceId: r.deviceId == null ? null : Number(r.deviceId) }));
}

async function addTask(clientId: number, taskType: string, deviceId: number | null): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO open_tasks (client_id, branch_id, task_type, task_family, status, due_date, device_id, notes, origin)
     SELECT $1, $2, $3::text, ttc.task_family, 'open', $4::date, $5, $6::text, 'manual'
       FROM task_type_config ttc WHERE ttc.task_type = $3::text
     RETURNING id`,
    [clientId, BRANCH, taskType, DAY, deviceId, SEED_NOTE],
  );
  return Number(rows[0].id);
}

/** Test password on the account of an employee (test copy only); returns the username. */
export async function setTestPasswordForEmployee(employeeId: number): Promise<string> {
  const { rows: dbRows } = await pool.query('SELECT current_database() AS db');
  if (dbRows[0].db !== TEST_DB) throw new Error(`refusing to touch ${dbRows[0].db}`);
  const { rows } = await pool.query(
    'SELECT username FROM hr_users WHERE employee_id = $1 AND is_active ORDER BY id LIMIT 1', [employeeId]);
  await pool.query('UPDATE hr_users SET password_hash = $1 WHERE username = $2',
    [await bcrypt.hash(TEST_PASSWORD, 10), rows[0].username]);
  return rows[0].username;
}

export async function seedScenarios(): Promise<SeededClients> {
  const { rows: dbRows } = await pool.query('SELECT current_database() AS db');
  if (dbRows[0].db !== TEST_DB) throw new Error(`refusing to seed ${dbRows[0].db}: only ${TEST_DB}`);

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  await pool.query('UPDATE hr_users SET password_hash = $1 WHERE username = ANY($2::text[])', [hash, Object.values(TEST_USERS)]);

  // Clean previous seed runs.
  // Earlier runs may have booked their tasks: retire them (cancel) instead of deleting.
  await pool.query(`UPDATE field_visits SET status = 'cancelled' WHERE scheduled_date = $1::date AND status <> 'cancelled'`, [DAY]);
  await pool.query(`UPDATE open_tasks SET status = 'cancelled' WHERE notes = $1 AND status NOT IN ('cancelled', 'completed', 'closed')`, [SEED_NOTE]);

  const [mixed, emergency, twoLocations, clean, demo] = await pickClients(5, true);

  // Device locations: same zone for mixed/emergency, the other zone for two-locations.
  await pool.query('UPDATE installed_devices SET installation_geo_unit_id = $2 WHERE id = ANY($1::int[])', [[mixed!.deviceId, emergency!.deviceId], ZONE]);
  await pool.query('UPDATE installed_devices SET installation_geo_unit_id = $2 WHERE id = $1', [twoLocations!.deviceId, ZONE2]);
  // DEC-009 R-10 department gate: the scenario devices use a model every
  // test supervisor's department serves, so the gate does not hide them.
  await pool.query('UPDATE installed_devices SET device_model_id = 1012 WHERE id = ANY($1::int[])',
    [[mixed!.deviceId, emergency!.deviceId, twoLocations!.deviceId]]);

  await addTask(clean!.id, 'installment_collection', null);
  await addTask(mixed!.id, 'installment_collection', null);
  await addTask(mixed!.id, 'periodic_maintenance', mixed!.deviceId);
  await addTask(emergency!.id, 'installment_collection', null);
  await addTask(emergency!.id, 'emergency_maintenance', emergency!.deviceId);
  await addTask(twoLocations!.id, 'installment_collection', null);
  await addTask(twoLocations!.id, 'periodic_maintenance', twoLocations!.deviceId);
  await addTask(demo!.id, 'device_demo', null);

  return { clean: clean!.id, mixed: mixed!.id, emergency: emergency!.id, twoLocations: twoLocations!.id, demo: demo!.id };
}

if (process.argv[1]?.endsWith('seed-team-types-scenarios.ts')) {
  seedScenarios()
    .then(clients => { console.log('seeded', clients); return pool.end(); })
    .catch(err => { console.error(err); process.exit(1); });
}
