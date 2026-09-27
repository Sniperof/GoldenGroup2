import fs from 'node:fs';
import pool from '../packages/api/db.ts';

const filename = '468_split_supervisor_telemarketer_contact_visibility.sql';
const raw = fs.readFileSync(`migrations/${filename}`, 'utf8');
const sql = raw.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');

const alreadyApplied = await pool.query(
  'SELECT 1 FROM public.schema_migrations WHERE filename = $1',
  [filename],
);

if (alreadyApplied.rowCount) {
  console.log(`${filename}: already applied`);
  await pool.end();
  process.exit(0);
}

const dryRun = await pool.connect();
try {
  await dryRun.query('BEGIN');
  await dryRun.query(sql);
  await dryRun.query('ROLLBACK');
  console.log(`${filename}: dry-run OK`);
} catch (error) {
  await dryRun.query('ROLLBACK');
  throw error;
} finally {
  dryRun.release();
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(
    'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
    [filename],
  );
  await client.query('COMMIT');
  console.log(`${filename}: applied`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
