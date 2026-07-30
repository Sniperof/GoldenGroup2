import fs from 'node:fs';
import pool from '../packages/api/db.js';

const migrationPath = new URL('../migrations/375_installed_device_serial_uniqueness.sql', import.meta.url);
const rawMigration = fs.readFileSync(migrationPath, 'utf8');
const migrationSql = rawMigration
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(migrationSql);

  const firstInsert = await client.query(
    `INSERT INTO installed_devices
       (contract_id, customer_id, device_source, serial_number, status)
     SELECT NULL, id, 'external', '__DEF014_ROLLBACK__', 'active'
       FROM clients
      ORDER BY id
      LIMIT 1
     RETURNING id`,
  );
  if (!firstInsert.rows[0]) {
    throw new Error('No client row is available for the rolled-back uniqueness probe');
  }

  await client.query('SAVEPOINT duplicate_serial_probe');
  try {
    await client.query(
      `INSERT INTO installed_devices
         (contract_id, customer_id, device_source, serial_number, status)
       SELECT NULL, id, 'external', '  __def014_rollback__  ', 'active'
         FROM clients
        ORDER BY id
        LIMIT 1`,
    );
    throw new Error('Duplicate normalized serial unexpectedly succeeded');
  } catch (error: any) {
    if (
      error?.code !== '23505'
      || error?.constraint !== 'uq_installed_devices_serial_normalized'
    ) {
      throw error;
    }
    await client.query('ROLLBACK TO SAVEPOINT duplicate_serial_probe');
  }

  console.log('migration 375 invariant probe: duplicate rejected by expected unique index');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
