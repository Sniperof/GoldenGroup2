import pool from '../db.js';

type Queryable = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Materialize the date-driven lifecycle transition. Applicability checks do
 * not depend on this sweep, so a delayed job can never reopen public intake.
 */
export async function runVacancyExpiryOnce(
  db: Queryable = pool,
): Promise<{ closed: number }> {
  const { rows } = await db.query(
    `WITH expired AS (
       UPDATE job_vacancies
          SET status = 'Closed',
              updated_at = NOW()
        WHERE status = 'Open'
          AND end_date < CURRENT_DATE
      RETURNING id
     ), audited AS (
       INSERT INTO audit_logs
         (entity_type, entity_id, action_type, performed_by_role,
          old_value, new_value, internal_reason)
       SELECT 'job_vacancy', id, 'Vacancy Auto-Closed', 'system',
              'Open', 'Closed', 'end_date elapsed'
         FROM expired
      RETURNING id
     )
     SELECT count(*)::int AS closed FROM expired`,
  );
  return { closed: Number(rows[0]?.closed ?? 0) };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runVacancyExpiryOnce();
    if (result.closed > 0) {
      console.log(`[vacancyExpiryJob] auto-closed ${result.closed} expired vacancies`);
    }
  } catch (error) {
    console.error('[vacancyExpiryJob] sweep failed', error);
  } finally {
    running = false;
  }
}

export function startVacancyExpiryJob(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, 60 * 60 * 1000);
  console.log('[vacancyExpiryJob] started (hourly sweep)');
  void tick();
}

export function stopVacancyExpiryJob(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
