export class ContactTargetLockError extends Error {
  statusCode = 409;
  ownerName: string | null;

  constructor(ownerName: string | null) {
    super(ownerName
      ? `جهة الاتصال مقفلة حاليا باسم ${ownerName}`
      : 'جهة الاتصال مقفلة باسم مستخدم آخر');
    this.name = 'ContactTargetLockError';
    this.ownerName = ownerName;
  }
}

export async function claimContactTarget(
  db: any,
  contactTargetId: number | null | undefined,
  userId: number | null | undefined,
): Promise<void> {
  if (contactTargetId == null || userId == null) return;

  const { rows } = await db.query(
    `UPDATE contact_targets
        SET locked_by_hr_user_id = COALESCE(locked_by_hr_user_id, $2),
            locked_at = COALESCE(locked_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND (locked_by_hr_user_id IS NULL OR locked_by_hr_user_id = $2)
      RETURNING id`,
    [contactTargetId, userId],
  );

  if (rows.length > 0) return;

  const owner = await db.query(
    `SELECT hu.name
       FROM contact_targets ct
       LEFT JOIN hr_users hu ON hu.id = ct.locked_by_hr_user_id
      WHERE ct.id = $1
      LIMIT 1`,
    [contactTargetId],
  );

  throw new ContactTargetLockError(owner.rows[0]?.name ?? null);
}

export async function markContactTargetFirstContact(
  db: any,
  contactTargetId: number | null | undefined,
  userId: number | null | undefined,
): Promise<void> {
  if (contactTargetId == null || userId == null) return;

  await db.query(
    `UPDATE contact_targets
        SET first_contacted_by_hr_user_id = COALESCE(first_contacted_by_hr_user_id, $2),
            first_contacted_at = COALESCE(first_contacted_at, NOW()),
            updated_at = NOW()
      WHERE id = $1`,
    [contactTargetId, userId],
  );
}
