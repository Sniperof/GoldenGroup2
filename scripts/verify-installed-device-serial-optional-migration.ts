import fs from 'node:fs';
import pool from '../packages/api/db.js';

const filename = new URL('../migrations/436_installed_device_serial_optional.sql', import.meta.url);
const raw = fs.readFileSync(filename, 'utf8');
const sql = raw.replace(/^\uFEFF?\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
const client = await pool.connect();

async function snapshot() {
  const column = await client.query(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'installed_devices'
        AND column_name = 'serial_number'`,
  );
  const index = await client.query(
    `SELECT indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'installed_devices'
        AND indexname = 'uq_installed_devices_serial_normalized'`,
  );
  return { column: column.rows, index: index.rows };
}

try {
  const before = await snapshot();
  await client.query('BEGIN');
  await client.query(sql);

  const applied = await snapshot();
  if (applied.column[0]?.is_nullable !== 'YES') {
    throw new Error('installed_devices.serial_number is still mandatory');
  }
  const indexDefinition = String(applied.index[0]?.indexdef ?? '');
  if (!indexDefinition.includes('UNIQUE INDEX')
    || !indexDefinition.includes('lower(btrim((serial_number)::text))')
    || !indexDefinition.includes('serial_number IS NOT NULL')) {
    throw new Error('normalized non-empty serial uniqueness index is missing');
  }

  const { rows: devices } = await client.query(
    'SELECT id FROM installed_devices ORDER BY id LIMIT 2 FOR UPDATE',
  );
  let duplicateRejected: boolean | null = null;
  if (devices.length === 2) {
    await client.query(
      'UPDATE installed_devices SET serial_number = NULL WHERE id = ANY($1::int[])',
      [devices.map((row: any) => Number(row.id))],
    );
    await client.query(
      'UPDATE installed_devices SET serial_number = $2 WHERE id = $1',
      [Number(devices[0].id), 'CODEX-OPTIONAL-SERIAL-CHECK'],
    );
    await client.query('SAVEPOINT duplicate_serial_check');
    try {
      await client.query(
        'UPDATE installed_devices SET serial_number = $2 WHERE id = $1',
        [Number(devices[1].id), '  codex-optional-serial-check  '],
      );
      duplicateRejected = false;
    } catch (error: any) {
      duplicateRejected = error?.code === '23505';
      await client.query('ROLLBACK TO SAVEPOINT duplicate_serial_check');
    }
    if (duplicateRejected !== true) {
      throw new Error('normalized duplicate serial was not rejected');
    }
  }

  await client.query('ROLLBACK');
  const after = await snapshot();
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error('rollback did not restore the previous serial schema state');
  }

  console.log(JSON.stringify({
    migration: '436 rollback dry-run OK',
    serialNullable: true,
    multipleNullsAccepted: devices.length === 2,
    normalizedDuplicateRejected: duplicateRejected,
    schemaRestored: true,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
