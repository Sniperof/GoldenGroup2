import pg from 'pg';
import { DATABASE_URL } from './config/env.js';
import { auditSettingValues, getAuditContext } from './auditContext.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// ── Audit context on every connection (migration 475) ───────────────────────
// The task activity triggers read app.actor_id / app.actor_role / ... from the
// session. Settings are session-level (not SET LOCAL) because many writes run
// as single autocommit pool.query calls; every checkout therefore re-applies
// the caller's values (empty outside a request), and the last applied values
// are cached on the client so the extra round trip only happens on change.
// The context is captured when connect() is called, not when the pool hands
// the client over, since a queued checkout resumes in the releaser's context.

type AuditedClient = pg.PoolClient & { __auditSettingsKey?: string };
type ConnectCallback = (err: Error | undefined, client?: pg.PoolClient, done?: (release?: any) => void) => void;

const rawConnect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;

async function applyAuditSettings(client: AuditedClient, values: string[]): Promise<void> {
  const key = values.join('\u0000');
  if (client.__auditSettingsKey === key) return;
  await client.query(
    `SELECT set_config('app.actor_id', $1, false),
            set_config('app.actor_role', $2, false),
            set_config('app.change_context', $3, false),
            set_config('app.reference_id', $4, false),
            set_config('app.change_reason', $5, false)`,
    values,
  );
  client.__auditSettingsKey = key;
}

async function connectWithAudit(): Promise<pg.PoolClient> {
  const values = auditSettingValues(getAuditContext());
  const client = (await rawConnect()) as AuditedClient;
  try {
    await applyAuditSettings(client, values);
  } catch (err) {
    client.__auditSettingsKey = undefined;
    client.release(err as Error);
    throw err;
  }
  return client;
}

(pool as any).connect = function connect(callback?: ConnectCallback) {
  const pending = connectWithAudit();
  if (!callback) return pending;
  pending.then(
    (client) => callback(undefined, client, client.release),
    (err) => callback(err),
  );
  return undefined;
};

export default pool;
