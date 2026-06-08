type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

/**
 * Promotes a client to OP or FOP status and clears all personal assignments.
 *
 * Rules:
 * - OP overrides NULL and FOP (contract exists → highest business state)
 * - FOP only sets if currently NULL (won't demote an OP client)
 * - Both states unconditionally clear client_assignments (personal ownership ends)
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

  await db.query(
    `DELETE FROM client_assignments WHERE client_id = $1`,
    [clientId],
  );
}
