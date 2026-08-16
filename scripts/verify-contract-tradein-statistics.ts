import fs from 'node:fs';
import pool from '../packages/api/db.js';

const raw = fs.readFileSync('./migrations/396_contract_tradein_statistics.sql', 'utf8');
const migrationSql = raw
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');

const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query(migrationSql);

  const valid = await client.query(
    `INSERT INTO contracts
       (sale_type, old_contract_number, old_device_condition)
     VALUES ('tradein', 'STAT-OLD-1', 'good')
     RETURNING sale_type, old_contract_number, old_device_condition`,
  );

  await client.query('SAVEPOINT invalid_tradein');
  let invalidTradeinRejected = false;
  try {
    await client.query(`INSERT INTO contracts (sale_type) VALUES ('tradein')`);
  } catch (error: any) {
    invalidTradeinRejected = error?.code === '23514';
    await client.query('ROLLBACK TO SAVEPOINT invalid_tradein');
  }

  if (!invalidTradeinRejected) {
    throw new Error('invalid trade-in row was not rejected');
  }

  await client.query('ROLLBACK');
  console.log(JSON.stringify({
    migration: 'dry-run OK',
    valid: valid.rows[0],
    invalidTradeinRejected,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
