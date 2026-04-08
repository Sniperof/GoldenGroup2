/**
 * âš ï¸  DEPRECATED â€” DO NOT CALL IN PRODUCTION
 *
 * This file is kept as a historical reference only.
 * Schema management has been migrated to /migrations/*.sql files.
 *
 * To apply schema changes:
 *   npm run migrate
 *
 * createSchema() is intentionally a no-op so that any remaining
 * import of it in test or dev scripts does not silently mutate the
 * production database.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createSchema(): Promise<void> {
  throw new Error(
    '[schema.ts] createSchema() is disabled. ' +
    'Run database migrations with: npm run migrate'
  );
}
