import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/416_service_request_mediator_address_contract.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const requestTypes = ['water_check', 'emergency_maintenance', 'periodic_maintenance', 'device_request'];
const expected = new Map([
  ['water_check', 'water_check.mobile.v4'],
  ['emergency_maintenance', 'emergency_maintenance.mobile.v2'],
  ['periodic_maintenance', 'periodic_maintenance.mobile.v2'],
  ['device_request', 'device_request.mobile.v2'],
]);
const client = await pool.connect();

try {
  const before = await client.query(
    `SELECT request_type, default_form_version, external_party_policy
       FROM service_request_type_config
      WHERE request_type = ANY($1::text[])
      ORDER BY request_type`,
    [requestTypes],
  );

  await client.query('BEGIN');
  await client.query(sql);

  const migrated = await client.query<{
    request_type: string;
    default_form_version: string;
    external_party_policy: Record<string, unknown>;
  }>(
    `SELECT request_type, default_form_version, external_party_policy
       FROM service_request_type_config
      WHERE request_type = ANY($1::text[])
      ORDER BY request_type`,
    [requestTypes],
  );

  if (migrated.rowCount !== 4) throw new Error(`expected four registry rows, got ${migrated.rowCount}`);
  for (const row of migrated.rows) {
    if (row.default_form_version !== expected.get(row.request_type)) {
      throw new Error(`unexpected version for ${row.request_type}: ${row.default_form_version}`);
    }
    if (!row.external_party_policy?.mediatorAddress) {
      throw new Error(`missing mediatorAddress policy for ${row.request_type}`);
    }
  }

  await client.query('ROLLBACK');
  const after = await client.query(
    `SELECT request_type, default_form_version, external_party_policy
       FROM service_request_type_config
      WHERE request_type = ANY($1::text[])
      ORDER BY request_type`,
    [requestTypes],
  );
  if (JSON.stringify(after.rows) !== JSON.stringify(before.rows)) {
    throw new Error('rollback did not restore the registry state');
  }

  console.log(JSON.stringify({
    migration: '416 rollback dry-run OK',
    versions: Object.fromEntries(migrated.rows.map((row) => [row.request_type, row.default_form_version])),
    schemaRestored: true,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
