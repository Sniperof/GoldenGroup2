import type { PoolClient } from 'pg';

export type VisitType = 'marketing' | 'service' | 'mixed';

export function classifyVisitTaskFamilies(families: Array<string | null | undefined>): VisitType {
  const hasMarketing = families.some((family) => family === 'marketing');
  const hasService = families.some((family) => family != null && family !== 'marketing');
  if (hasMarketing && hasService) return 'mixed';
  return hasMarketing ? 'marketing' : 'service';
}

/** Recompute the persisted visit classification from its current visit_tasks. */
export async function refreshVisitType(db: PoolClient, fieldVisitId: number): Promise<VisitType> {
  const { rows } = await db.query<{ task_family: string }>(
    `SELECT task_family FROM visit_tasks WHERE field_visit_id = $1`,
    [fieldVisitId],
  );
  // An empty field-initiated visit starts as marketing until its first task is pulled.
  const visitType = rows.length === 0
    ? 'marketing'
    : classifyVisitTaskFamilies(rows.map((row) => row.task_family));
  await db.query(
    `UPDATE field_visits SET visit_type = $2, updated_at = NOW() WHERE id = $1`,
    [fieldVisitId, visitType],
  );
  return visitType;
}
