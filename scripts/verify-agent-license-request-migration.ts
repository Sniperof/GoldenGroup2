import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/418_agent_license_service_request_v1.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const client = await pool.connect();

try {
  const beforeRegistry = await client.query(
    `SELECT request_type, default_form_version, external_party_policy, mismatch_policy,
            linkage_policy, permission_policy, audit_policy
       FROM service_request_type_config
      WHERE request_type = 'agent_license'`,
  );
  const beforePermissions = await client.query(
    `SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
       FROM permissions WHERE key LIKE 'agent_license.%' ORDER BY key`,
  );
  await client.query('BEGIN');
  await client.query(sql);

  const registry = await client.query<{ default_form_version: string }>(
    `SELECT default_form_version
       FROM service_request_type_config
      WHERE request_type = 'agent_license'`,
  );
  const permissions = await client.query<{ key: string }>(
    `SELECT key FROM permissions
      WHERE key LIKE 'agent_license.%'
      ORDER BY key`,
  );

  if (registry.rows[0]?.default_form_version !== 'agent_license.mobile.v1') {
    throw new Error('agent-license registry verification failed');
  }
  if (permissions.rowCount !== 5) {
    throw new Error(`expected five agent-license permissions, got ${permissions.rowCount}`);
  }

  await client.query('ROLLBACK');
  const afterRegistry = await client.query(
    `SELECT request_type, default_form_version, external_party_policy, mismatch_policy,
            linkage_policy, permission_policy, audit_policy
       FROM service_request_type_config
      WHERE request_type = 'agent_license'`,
  );
  const afterPermissions = await client.query(
    `SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
       FROM permissions WHERE key LIKE 'agent_license.%' ORDER BY key`,
  );
  if (JSON.stringify(afterRegistry.rows) !== JSON.stringify(beforeRegistry.rows)
    || JSON.stringify(afterPermissions.rows) !== JSON.stringify(beforePermissions.rows)) {
    throw new Error('rollback did not restore the registry and permission state');
  }

  console.log(JSON.stringify({
    migration: '418 rollback dry-run OK',
    formVersion: registry.rows[0].default_form_version,
    permissionCount: permissions.rowCount,
    schemaRestored: true,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
