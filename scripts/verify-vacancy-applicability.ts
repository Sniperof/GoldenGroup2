import fs from 'node:fs';
import pool from '../packages/api/db.js';
import { runVacancyExpiryOnce } from '../packages/api/services/vacancyExpiryJob.js';

const migrationPath = new URL('../migrations/376_close_expired_job_vacancies.sql', import.meta.url);
const rawMigration = fs.readFileSync(migrationPath, 'utf8');
const migrationSql = rawMigration
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows: fixtureRows } = await client.query(
    `INSERT INTO job_vacancies
       (title, branch, vacancy_count, start_date, end_date, status)
     VALUES ('__DEF015_ROLLBACK__', '__TEST__', 1,
             CURRENT_DATE - 2, CURRENT_DATE - 1, 'Open')
     RETURNING id`,
  );
  const fixtureId = Number(fixtureRows[0].id);

  const { rows: beforeRows } = await client.query(
    `SELECT count(*)::int AS count
       FROM job_vacancies
      WHERE status = 'Open'
        AND end_date < CURRENT_DATE`,
  );

  await client.query(migrationSql);

  const { rows: afterRows } = await client.query(
    `SELECT count(*)::int AS count
       FROM job_vacancies
      WHERE status = 'Open'
        AND end_date < CURRENT_DATE`,
  );
  const { rows: auditRows } = await client.query(
    `SELECT count(*)::int AS count
      FROM audit_logs
      WHERE action_type = 'Vacancy Auto-Closed'
        AND internal_reason = 'end_date elapsed'
        AND entity_id = $1
        AND "timestamp" >= transaction_timestamp()`,
    [fixtureId],
  );

  const { rows: fixtureAfterRows } = await client.query(
    'SELECT status FROM job_vacancies WHERE id = $1',
    [fixtureId],
  );
  if (fixtureAfterRows[0]?.status !== 'Closed' || Number(auditRows[0]?.count ?? 0) !== 1) {
    throw new Error('Migration 376 did not close and audit the expired vacancy fixture');
  }

  const { rows: jobFixtureRows } = await client.query(
    `INSERT INTO job_vacancies
       (title, branch, vacancy_count, start_date, end_date, status)
     VALUES ('__DEF015_JOB_ROLLBACK__', '__TEST__', 1,
             CURRENT_DATE - 2, CURRENT_DATE - 1, 'Open')
     RETURNING id`,
  );
  const jobFixtureId = Number(jobFixtureRows[0].id);
  const jobResult = await runVacancyExpiryOnce(client);
  const { rows: jobAfterRows } = await client.query(
    'SELECT status FROM job_vacancies WHERE id = $1',
    [jobFixtureId],
  );
  const { rows: jobAuditRows } = await client.query(
    `SELECT count(*)::int AS count
       FROM audit_logs
      WHERE action_type = 'Vacancy Auto-Closed'
        AND internal_reason = 'end_date elapsed'
        AND entity_id = $1
        AND "timestamp" >= transaction_timestamp()`,
    [jobFixtureId],
  );
  if (
    jobResult.closed !== 1
    || jobAfterRows[0]?.status !== 'Closed'
    || Number(jobAuditRows[0]?.count ?? 0) !== 1
  ) {
    throw new Error('Vacancy expiry job did not close and audit the expired vacancy fixture');
  }

  console.log('migration 376 dry-run: OK');
  console.log('would_close:', Number(beforeRows[0]?.count ?? 0));
  console.log('remaining_expired_open:', Number(afterRows[0]?.count ?? 0));
  console.log('audit_rows_created:', Number(auditRows[0]?.count ?? 0));
  console.log('expiry_job_closed:', jobResult.closed);
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
