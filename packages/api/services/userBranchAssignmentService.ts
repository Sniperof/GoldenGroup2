import pool from '../db.js';

export type UserBranchAssignmentStatus = 'active' | 'inactive';

export type UserBranchAssignmentRecord = {
  id: number;
  userId: number;
  branchId: number;
  branchName: string;
  isPrimary: boolean;
  status: UserBranchAssignmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type BranchCatalogItem = {
  id: number;
  name: string;
  status: string;
};

export class UserBranchAssignmentError extends Error {
  constructor(
    public readonly code: 'USER_NOT_FOUND' | 'BRANCH_NOT_FOUND' | 'ASSIGNMENT_NOT_FOUND' | 'PRIMARY_BRANCH_REQUIRES_ACTIVE_ASSIGNMENT',
    message: string,
  ) {
    super(message);
    this.name = 'UserBranchAssignmentError';
  }
}

export async function listBranchCatalog(): Promise<BranchCatalogItem[]> {
  const { rows } = await pool.query(
    `SELECT id, name, status
       FROM branches
      ORDER BY created_at DESC, id DESC`,
  );

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
  }));
}

export async function listUserBranchAssignments(userId: number): Promise<UserBranchAssignmentRecord[]> {
  const { rows } = await pool.query(
    `SELECT uba.id,
            uba.user_id AS "userId",
            uba.branch_id AS "branchId",
            b.name AS "branchName",
            uba.is_primary AS "isPrimary",
            uba.status,
            uba.created_at AS "createdAt",
            uba.updated_at AS "updatedAt"
       FROM user_branch_assignments uba
       JOIN branches b ON b.id = uba.branch_id
      WHERE uba.user_id = $1
      ORDER BY
        CASE uba.status WHEN 'active' THEN 0 ELSE 1 END,
        uba.is_primary DESC,
        b.name ASC,
        uba.id ASC`,
    [userId],
  );

  return rows.map(toAssignmentRecord);
}

export async function upsertUserBranchAssignment(input: {
  userId: number;
  branchId: number;
  isPrimary?: boolean;
  status?: UserBranchAssignmentStatus;
}): Promise<UserBranchAssignmentRecord[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureUserExists(client, input.userId);
    await ensureBranchExists(client, input.branchId);

    const status = normalizeStatus(input.status);
    const hasActivePrimary = await userHasActivePrimary(client, input.userId);
    const shouldBecomePrimary = status === 'active' && (input.isPrimary === true || !hasActivePrimary);

    await client.query(
      `INSERT INTO user_branch_assignments (user_id, branch_id, is_primary, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, branch_id) DO UPDATE
         SET is_primary = EXCLUDED.is_primary,
             status = EXCLUDED.status,
             updated_at = NOW()`,
      [input.userId, input.branchId, shouldBecomePrimary, status],
    );

    await reconcilePrimaryBranch(client, input.userId, shouldBecomePrimary ? input.branchId : null);
    await client.query('COMMIT');

    return listUserBranchAssignments(input.userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deactivateUserBranchAssignment(input: {
  userId: number;
  branchId: number;
}): Promise<UserBranchAssignmentRecord[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureUserExists(client, input.userId);
    const existing = await getAssignmentForUpdate(client, input.userId, input.branchId);
    if (!existing) {
      throw new UserBranchAssignmentError('ASSIGNMENT_NOT_FOUND', 'إسناد الفرع غير موجود لهذا المستخدم');
    }

    await client.query(
      `UPDATE user_branch_assignments
          SET status = 'inactive',
              is_primary = FALSE,
              updated_at = NOW()
        WHERE user_id = $1
          AND branch_id = $2`,
      [input.userId, input.branchId],
    );

    await reconcilePrimaryBranch(client, input.userId, null);
    await client.query('COMMIT');

    return listUserBranchAssignments(input.userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setPrimaryUserBranchAssignment(input: {
  userId: number;
  branchId: number;
}): Promise<UserBranchAssignmentRecord[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureUserExists(client, input.userId);
    const assignment = await getAssignmentForUpdate(client, input.userId, input.branchId);
    if (!assignment) {
      throw new UserBranchAssignmentError('ASSIGNMENT_NOT_FOUND', 'إسناد الفرع غير موجود لهذا المستخدم');
    }
    if (assignment.status !== 'active') {
      throw new UserBranchAssignmentError(
        'PRIMARY_BRANCH_REQUIRES_ACTIVE_ASSIGNMENT',
        'لا يمكن تعيين فرع أساسي من Assignment غير فعال',
      );
    }

    await reconcilePrimaryBranch(client, input.userId, input.branchId);
    await client.query('COMMIT');

    return listUserBranchAssignments(input.userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type Queryable = {
  query: typeof pool.query;
};

async function ensureUserExists(client: Queryable, userId: number): Promise<void> {
  const { rows } = await client.query('SELECT id FROM hr_users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0]) {
    throw new UserBranchAssignmentError('USER_NOT_FOUND', 'المستخدم غير موجود');
  }
}

async function ensureBranchExists(client: Queryable, branchId: number): Promise<void> {
  const { rows } = await client.query('SELECT id FROM branches WHERE id = $1', [branchId]);
  if (!rows[0]) {
    throw new UserBranchAssignmentError('BRANCH_NOT_FOUND', 'الفرع غير موجود');
  }
}

async function userHasActivePrimary(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM user_branch_assignments
      WHERE user_id = $1
        AND status = 'active'
        AND is_primary = TRUE
      LIMIT 1`,
    [userId],
  );

  return Boolean(rows[0]);
}

async function getAssignmentForUpdate(
  client: Queryable,
  userId: number,
  branchId: number,
): Promise<{ status: UserBranchAssignmentStatus } | null> {
  const { rows } = await client.query(
    `SELECT status
       FROM user_branch_assignments
      WHERE user_id = $1
        AND branch_id = $2
      FOR UPDATE`,
    [userId, branchId],
  );

  if (!rows[0]) {
    return null;
  }

  return {
    status: normalizeStatus(rows[0].status),
  };
}

async function reconcilePrimaryBranch(
  client: Queryable,
  userId: number,
  preferredBranchId: number | null,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT branch_id AS "branchId",
            is_primary AS "isPrimary"
       FROM user_branch_assignments
      WHERE user_id = $1
        AND status = 'active'
      ORDER BY is_primary DESC, created_at ASC, id ASC
      FOR UPDATE`,
    [userId],
  );

  const activeAssignments = rows.map(row => ({
    branchId: Number(row.branchId),
    isPrimary: row.isPrimary === true,
  }));

  let primaryBranchId: number | null = null;
  if (
    preferredBranchId != null &&
    activeAssignments.some(assignment => assignment.branchId === preferredBranchId)
  ) {
    primaryBranchId = preferredBranchId;
  } else {
    primaryBranchId =
      activeAssignments.find(assignment => assignment.isPrimary)?.branchId ??
      activeAssignments[0]?.branchId ??
      null;
  }

  await client.query(
    `UPDATE user_branch_assignments
        SET is_primary = FALSE,
            updated_at = NOW()
      WHERE user_id = $1
        AND is_primary = TRUE`,
    [userId],
  );

  if (primaryBranchId != null) {
    await client.query(
      `UPDATE user_branch_assignments
          SET is_primary = TRUE,
              updated_at = NOW()
        WHERE user_id = $1
          AND branch_id = $2
          AND status = 'active'`,
      [userId, primaryBranchId],
    );
  }

  // LEGACY_COMPAT: hr_users.branch_id mirrors primary user_branch_assignment
  // until legacy consumers are removed.
  await client.query(
    `UPDATE hr_users
        SET branch_id = $2
      WHERE id = $1`,
    [userId, primaryBranchId],
  );
}

function normalizeStatus(value: unknown): UserBranchAssignmentStatus {
  return value === 'inactive' ? 'inactive' : 'active';
}

function toAssignmentRecord(row: Record<string, unknown>): UserBranchAssignmentRecord {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    branchId: Number(row.branchId),
    branchName: String(row.branchName),
    isPrimary: row.isPrimary === true,
    status: normalizeStatus(row.status),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}
