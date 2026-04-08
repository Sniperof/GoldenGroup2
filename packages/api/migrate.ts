/**
 * Production migration runner.
 *
 * Usage:
 *   npm run migrate
 *   # or directly:
 *   tsx server/migrate.ts
 *
 * Behaviour:
 *   1. Creates a `schema_migrations` tracking table if it doesn't exist.
 *   2. Reads all *.sql files from /migrations in lexicographic order.
 *   3. Skips files that have already been applied (tracked by filename).
 *   4. Runs each pending migration inside a transaction; rolls back on failure.
 *   5. Records successful migrations in schema_migrations.
 *
 * The runner never auto-executes on server startup — it must be invoked
 * explicitly before (or after, for maintenance) deploying a new version.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// migrations/ lives at project root: packages/api/../../migrations
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

async function runMigrations() {
  console.log('=== Golden CRM — Database Migration Runner ===\n');

  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Collect SQL files in sorted order
  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (allFiles.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    await pool.end();
    return;
  }

  // Determine which have already been applied
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  );
  const applied = new Set(rows.map(r => r.filename));

  const pending = allFiles.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log('All migrations already applied — nothing to do.\n');
    allFiles.forEach(f => console.log(`  ✓ ${f}`));
    await pool.end();
    return;
  }

  // Print status of all files
  allFiles.forEach(f => {
    if (applied.has(f)) {
      console.log(`  ✓ ${f} (already applied)`);
    } else {
      console.log(`  ○ ${f} (pending)`);
    }
  });
  console.log('');

  // Run each pending migration
  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`→ Applying ${file} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`  ✓ ${file} applied successfully\n`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} FAILED — transaction rolled back`);
      console.error('  Error:', err instanceof Error ? err.message : err);
      console.error('\nMigration aborted. Fix the error and re-run.');
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log('=== All pending migrations applied successfully ===');
  await pool.end();
}

runMigrations().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
