import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/415_golden_warranty_service_request_v1.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const client = await pool.connect();

try {
  const before = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_requests'
          AND column_name = 'requested_warranty_months'
     ) AS present`,
  );

  await client.query('BEGIN');
  await client.query(sql);

  const registry = await client.query<{
    request_type: string; default_form_version: string; channels: string[];
  }>(
    `SELECT request_type, default_form_version, channels
       FROM service_request_type_config
      WHERE request_type = 'golden_warranty'`,
  );
  const permissions = await client.query<{ key: string }>(
    `SELECT key FROM permissions
      WHERE key LIKE 'golden_warranty.%'
      ORDER BY key`,
  );
  const lists = await client.query<{ category: string; count: number }>(
    `SELECT category, COUNT(*)::int AS count
       FROM system_lists
      WHERE category = ANY($1::text[])
      GROUP BY category ORDER BY category`,
    [[
      'service_request_resolve_at_intake_golden_warranty',
      'service_request_rejection_golden_warranty',
    ]],
  );
  const indexes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'open_tasks_unique_golden_warranty_source_request'`,
  );

  if (registry.rowCount !== 1 || registry.rows[0].default_form_version !== 'golden_warranty.mobile.v1') {
    throw new Error('golden warranty registry verification failed');
  }
  if (!registry.rows[0].channels.includes('mobile_app') || !registry.rows[0].channels.includes('phone')) {
    throw new Error('golden warranty registry channels verification failed');
  }
  if (permissions.rowCount !== 6) throw new Error(`expected 6 golden warranty permissions, got ${permissions.rowCount}`);
  if (lists.rowCount !== 2) throw new Error(`expected 2 golden warranty list categories, got ${lists.rowCount}`);
  if (indexes.rowCount !== 1) throw new Error(`expected golden warranty source index, got ${indexes.rowCount}`);

  await client.query('ROLLBACK');
  const after = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_requests'
          AND column_name = 'requested_warranty_months'
     ) AS present`,
  );
  if (after.rows[0].present !== before.rows[0].present) {
    throw new Error('rollback did not restore the pre-verification schema state');
  }

  console.log(JSON.stringify({
    migration: '415 rollback dry-run OK',
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
