import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/414_periodic_maintenance_service_request_v1.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const client = await pool.connect();

try {
  const before = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_requests'
          AND column_name = 'periodic_maintenance_reason_id'
     ) AS present`,
  );

  await client.query('BEGIN');
  await client.query(sql);

  const registry = await client.query<{
    request_type: string; default_form_version: string; channels: string[];
  }>(
    `SELECT request_type, default_form_version, channels
       FROM service_request_type_config
      WHERE request_type = 'periodic_maintenance'`,
  );
  const permissions = await client.query<{ key: string; allowed_scopes: string[] }>(
    `SELECT key, allowed_scopes FROM permissions
      WHERE key LIKE 'periodic_maintenance.%'
      ORDER BY key`,
  );
  const lists = await client.query<{ category: string; count: number }>(
    `SELECT category, COUNT(*)::int AS count
       FROM system_lists
      WHERE category = ANY($1::text[])
      GROUP BY category ORDER BY category`,
    [[
      'periodic_maintenance_request_reasons',
      'service_request_resolve_at_intake_periodic_maintenance',
      'service_request_rejection_periodic_maintenance',
    ]],
  );
  const indexes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      ORDER BY indexname`,
    [[
      'service_requests_unique_active_periodic_per_device',
      'open_tasks_unique_periodic_source_request',
    ]],
  );

  if (registry.rowCount !== 1 || registry.rows[0].default_form_version !== 'periodic_maintenance.mobile.v1') {
    throw new Error('periodic registry verification failed');
  }
  if (!registry.rows[0].channels.includes('mobile_app') || !registry.rows[0].channels.includes('phone')) {
    throw new Error('periodic registry channels verification failed');
  }
  if (permissions.rowCount !== 6) throw new Error(`expected 6 periodic permissions, got ${permissions.rowCount}`);
  if (lists.rowCount !== 3) throw new Error(`expected 3 periodic list categories, got ${lists.rowCount}`);
  if (indexes.rowCount !== 2) throw new Error(`expected 2 periodic uniqueness indexes, got ${indexes.rowCount}`);

  await client.query('ROLLBACK');
  const after = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_requests'
          AND column_name = 'periodic_maintenance_reason_id'
     ) AS present`,
  );
  if (after.rows[0].present !== before.rows[0].present) {
    throw new Error('rollback did not restore the pre-verification schema state');
  }

  console.log(JSON.stringify({
    migration: '414 rollback dry-run OK',
    registry: registry.rows[0],
    permissionCount: permissions.rowCount,
    listCategories: lists.rows,
    indexes: indexes.rows.map((row) => row.indexname),
    schemaRestored: true,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
