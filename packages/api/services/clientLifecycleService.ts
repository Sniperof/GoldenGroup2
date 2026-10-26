type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

/**
 * Promotes a client to OP or FOP status.
 *
 * Rules:
 * - OP overrides NULL and FOP (contract exists → highest business state)
 * - FOP only sets if currently NULL (won't demote an OP client)
 * - Personal owners stay (2026-10-20): ownership no longer moves to the
 *   branch at FOP/OP. Only device-demo work is the owner's; every other task
 *   belongs to the device's service branch.
 */
export async function promoteClientToLifecycleStatus(
  db: Queryable,
  clientId: number,
  status: 'OP' | 'FOP',
): Promise<void> {
  const guard =
    status === 'OP'
      ? `AND (candidate_status IS NULL OR candidate_status = 'FOP')`
      : `AND candidate_status IS NULL`;

  await db.query(
    `UPDATE clients SET candidate_status = $1 WHERE id = $2 ${guard}`,
    [status, clientId],
  );
}
