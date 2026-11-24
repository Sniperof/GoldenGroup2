// Team types (DEC-026). A company-wide catalog of team shapes: each type has
// slots (one lead, any number of field and caller slots), the roles each slot
// accepts, and the task types the type may be assigned. Branches pick which
// types they schedule with. The seeded `standard` and `emergency` types
// reproduce the two shapes that were hard-coded before.

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import pool from '../db.js';

type Queryable = { query: PoolClient['query'] };

export const TEAM_SLOT_FUNCTIONS = ['lead', 'field', 'caller'] as const;
export type TeamSlotFunction = (typeof TEAM_SLOT_FUNCTIONS)[number];

export interface TeamTypeSlot {
  slotKey: string;
  label: string;
  slotFunction: TeamSlotFunction;
  countsOwnership: boolean;
  minMembers: number;
  maxMembers: number | null;
  roleIds: number[];
}

export interface TeamType {
  id: number;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  slots: TeamTypeSlot[];
  taskTypes: string[];
}

export interface TeamTypeInput {
  name: string;
  description: string | null;
  sortOrder: number;
  slots: TeamTypeSlot[];
  taskTypes: string[];
}

export class TeamTypeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'TEAM_TYPE_INVALID') {
    super(message);
  }
}

const SLOT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,49}$/;

function positiveIntegers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0),
  )).sort((a, b) => a - b);
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}

function generatedKey(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

/**
 * Shape and rule checks that need no database (DEC-026 D3/D4/D5). Returns a
 * normalized input or throws TeamTypeError with an Arabic message.
 * Lead slots are forced to one required owning member; caller slots never own.
 */
export function normalizeTeamTypeInput(raw: any): TeamTypeInput {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new TeamTypeError('اسم نوع الفريق مطلوب');
  if (name.length > 100) throw new TeamTypeError('اسم نوع الفريق أطول من 100 حرف');

  const description = typeof raw?.description === 'string' && raw.description.trim()
    ? raw.description.trim()
    : null;
  const sortOrder = Number.isInteger(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : 0;

  const rawSlots: any[] = Array.isArray(raw?.slots) ? raw.slots : [];
  if (rawSlots.length === 0) throw new TeamTypeError('يجب أن يضم نوع الفريق خانة واحدة على الأقل');

  const usedKeys = new Set<string>();
  const usedLabels = new Set<string>();
  const slots: TeamTypeSlot[] = rawSlots.map((slot, index) => {
    const position = index + 1;
    const label = typeof slot?.label === 'string' ? slot.label.trim() : '';
    if (!label) throw new TeamTypeError(`الخانة ${position} بلا اسم`);
    if (label.length > 100) throw new TeamTypeError(`اسم الخانة ${position} أطول من 100 حرف`);
    if (usedLabels.has(label)) throw new TeamTypeError(`اسم الخانة «${label}» مكرر`);
    usedLabels.add(label);

    const slotFunction = slot?.slotFunction;
    if (!TEAM_SLOT_FUNCTIONS.includes(slotFunction)) {
      throw new TeamTypeError(`وظيفة الخانة «${label}» غير صالحة`);
    }

    let slotKey = typeof slot?.slotKey === 'string' ? slot.slotKey.trim() : '';
    if (slotKey && !SLOT_KEY_PATTERN.test(slotKey)) {
      throw new TeamTypeError(`مفتاح الخانة «${label}» غير صالح`);
    }
    if (!slotKey) slotKey = generatedKey('slot');
    if (usedKeys.has(slotKey)) throw new TeamTypeError(`مفتاح الخانة «${label}» مكرر`);
    usedKeys.add(slotKey);

    const roleIds = positiveIntegers(slot?.roleIds);
    if (roleIds.length === 0) throw new TeamTypeError(`الخانة «${label}» يجب أن تقبل دوراً واحداً على الأقل`);

    if (slotFunction === 'lead') {
      return { slotKey, label, slotFunction, countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds };
    }

    const minMembers = nonNegativeInteger(slot?.minMembers, 0);
    const maxMembers = slot?.maxMembers == null || slot.maxMembers === ''
      ? null
      : nonNegativeInteger(slot.maxMembers, 0);
    if (Number.isNaN(minMembers) || (maxMembers != null && Number.isNaN(maxMembers))) {
      throw new TeamTypeError(`عدد أشخاص الخانة «${label}» غير صالح`);
    }
    if (maxMembers != null && maxMembers < Math.max(minMembers, 1)) {
      throw new TeamTypeError(`أكثر عدد في الخانة «${label}» أقل من أقل عدد`);
    }

    return {
      slotKey,
      label,
      slotFunction,
      countsOwnership: slotFunction === 'field' ? slot?.countsOwnership === true : false,
      minMembers,
      maxMembers,
      roleIds,
    };
  });

  const leadCount = slots.filter(s => s.slotFunction === 'lead').length;
  if (leadCount !== 1) throw new TeamTypeError('يجب أن يضم نوع الفريق خانة رئيس واحدة بالضبط');

  const taskTypes = Array.from(new Set(
    (Array.isArray(raw?.taskTypes) ? raw.taskTypes : [])
      .filter((t: unknown) => typeof t === 'string' && t.trim())
      .map((t: string) => t.trim()),
  )).sort() as string[];
  if (taskTypes.length === 0) throw new TeamTypeError('اختر نوع مهمة واحداً على الأقل يستلمه الفريق');

  return { name, description, sortOrder, slots, taskTypes };
}

/**
 * Rules that compare an update with the stored type: a slot keeps its
 * function, a used type keeps its slots, and a system type keeps its slots and
 * allowed task types (the seeded shapes back existing days and DEC-006 D31).
 */
export function checkTeamTypeUpdate(
  existing: TeamType,
  next: TeamTypeInput,
  inUse: boolean,
): void {
  const nextByKey = new Map(next.slots.map(s => [s.slotKey, s]));

  for (const slot of existing.slots) {
    const updated = nextByKey.get(slot.slotKey);
    if (!updated) {
      if (existing.isSystem || inUse) {
        throw new TeamTypeError(`لا يمكن حذف الخانة «${slot.label}» من نوع مستخدم`, 409, 'TEAM_TYPE_SLOT_IN_USE');
      }
      continue;
    }
    if (updated.slotFunction !== slot.slotFunction) {
      throw new TeamTypeError(`لا يمكن تغيير وظيفة الخانة «${slot.label}»`, 409, 'TEAM_TYPE_SLOT_FUNCTION_LOCKED');
    }
  }

  if (existing.isSystem) {
    const before = [...existing.taskTypes].sort().join(',');
    const after = [...next.taskTypes].sort().join(',');
    if (before !== after) {
      throw new TeamTypeError('المهام المسموحة لنوع أساسي ثابتة', 409, 'TEAM_TYPE_SYSTEM_LOCKED');
    }
  }
}

const TEAM_TYPE_SELECT = `
  SELECT tt.id, tt.key, tt.name, tt.description,
         tt.is_system AS "isSystem", tt.is_active AS "isActive", tt.sort_order AS "sortOrder",
         COALESCE((
           SELECT json_agg(json_build_object(
                    'slotKey', s.slot_key,
                    'label', s.label,
                    'slotFunction', s.slot_function,
                    'countsOwnership', s.counts_ownership,
                    'minMembers', s.min_members,
                    'maxMembers', s.max_members,
                    'roleIds', COALESCE((
                      SELECT json_agg(sr.role_id ORDER BY sr.role_id)
                      FROM team_type_slot_roles sr WHERE sr.slot_id = s.id
                    ), '[]'::json)
                  ) ORDER BY s.sort_order, s.id)
           FROM team_type_slots s WHERE s.team_type_id = tt.id
         ), '[]'::json) AS slots,
         COALESCE((
           SELECT json_agg(x.task_type ORDER BY x.task_type)
           FROM team_type_task_types x WHERE x.team_type_id = tt.id
         ), '[]'::json) AS "taskTypes"
  FROM team_types tt`;

export async function listTeamTypes(db: Queryable = pool, opts: { includeInactive?: boolean } = {}): Promise<TeamType[]> {
  const { rows } = await db.query(
    `${TEAM_TYPE_SELECT}
     ${opts.includeInactive ? '' : 'WHERE tt.is_active'}
     ORDER BY tt.sort_order, tt.id`,
  );
  return rows as TeamType[];
}

export async function getTeamType(db: Queryable, id: number): Promise<TeamType | null> {
  const { rows } = await db.query(`${TEAM_TYPE_SELECT} WHERE tt.id = $1`, [id]);
  return (rows[0] as TeamType) ?? null;
}

/** A type is in use once any scheduled day carries a team of that type. */
export async function isTeamTypeInUse(db: Queryable, teamTypeId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM day_schedules ds
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(ds.teams) = 'array' THEN ds.teams ELSE '[]'::jsonb END
       ) AS team
       WHERE team->>'teamType' = (SELECT key FROM team_types WHERE id = $1)
     ) AS used`,
    [teamTypeId],
  );
  return rows[0]?.used === true;
}

async function assertReferencesExist(db: Queryable, input: TeamTypeInput): Promise<void> {
  const roleIds = Array.from(new Set(input.slots.flatMap(s => s.roleIds)));
  const { rows: roleRows } = await db.query('SELECT id FROM roles WHERE id = ANY($1::int[])', [roleIds]);
  if (roleRows.length !== roleIds.length) throw new TeamTypeError('أحد الأدوار المختارة غير موجود');

  const { rows: taskRows } = await db.query(
    'SELECT task_type FROM task_type_config WHERE task_type = ANY($1::text[])',
    [input.taskTypes],
  );
  if (taskRows.length !== input.taskTypes.length) throw new TeamTypeError('أحد أنواع المهام المختارة غير موجود');
}

async function writeSlotsAndTasks(db: Queryable, teamTypeId: number, input: TeamTypeInput): Promise<void> {
  const keys = input.slots.map(s => s.slotKey);
  await db.query(
    'DELETE FROM team_type_slots WHERE team_type_id = $1 AND NOT (slot_key = ANY($2::text[]))',
    [teamTypeId, keys],
  );

  for (const [index, slot] of input.slots.entries()) {
    const { rows } = await db.query(
      `INSERT INTO team_type_slots
         (team_type_id, slot_key, label, slot_function, counts_ownership, min_members, max_members, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (team_type_id, slot_key) DO UPDATE SET
         label = EXCLUDED.label,
         counts_ownership = EXCLUDED.counts_ownership,
         min_members = EXCLUDED.min_members,
         max_members = EXCLUDED.max_members,
         sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [teamTypeId, slot.slotKey, slot.label, slot.slotFunction, slot.countsOwnership,
        slot.minMembers, slot.maxMembers, (index + 1) * 10],
    );
    const slotId = rows[0].id;
    await db.query('DELETE FROM team_type_slot_roles WHERE slot_id = $1', [slotId]);
    await db.query(
      `INSERT INTO team_type_slot_roles (slot_id, role_id)
       SELECT $1, unnest($2::int[])`,
      [slotId, slot.roleIds],
    );
  }

  await db.query('DELETE FROM team_type_task_types WHERE team_type_id = $1', [teamTypeId]);
  await db.query(
    `INSERT INTO team_type_task_types (team_type_id, task_type)
     SELECT $1, unnest($2::text[])`,
    [teamTypeId, input.taskTypes],
  );
}

async function inTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createTeamType(raw: unknown, actorUserId: number): Promise<TeamType> {
  const input = normalizeTeamTypeInput(raw);
  return inTransaction(async db => {
    await assertReferencesExist(db, input);
    const { rows } = await db.query(
      `INSERT INTO team_types (key, name, description, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id`,
      [generatedKey('type'), input.name, input.description, input.sortOrder, actorUserId],
    );
    const id = rows[0].id as number;
    await writeSlotsAndTasks(db, id, input);
    return (await getTeamType(db, id))!;
  });
}

export async function updateTeamType(id: number, raw: unknown, actorUserId: number): Promise<TeamType> {
  const input = normalizeTeamTypeInput(raw);
  return inTransaction(async db => {
    await db.query('SELECT id FROM team_types WHERE id = $1 FOR UPDATE', [id]);
    const existing = await getTeamType(db, id);
    if (!existing) throw new TeamTypeError('نوع الفريق غير موجود', 404, 'TEAM_TYPE_NOT_FOUND');
    checkTeamTypeUpdate(existing, input, await isTeamTypeInUse(db, id));
    await assertReferencesExist(db, input);
    await db.query(
      `UPDATE team_types
       SET name = $2, description = $3, sort_order = $4, updated_by = $5, updated_at = NOW()
       WHERE id = $1`,
      [id, input.name, input.description, input.sortOrder, actorUserId],
    );
    await writeSlotsAndTasks(db, id, input);
    return (await getTeamType(db, id))!;
  });
}

/** Deactivate or reactivate. A type is never deleted (DEC-026 §3). */
export async function setTeamTypeActive(id: number, isActive: boolean, actorUserId: number): Promise<TeamType> {
  return inTransaction(async db => {
    const existing = await getTeamType(db, id);
    if (!existing) throw new TeamTypeError('نوع الفريق غير موجود', 404, 'TEAM_TYPE_NOT_FOUND');
    if (existing.isSystem && !isActive) {
      throw new TeamTypeError('لا يمكن تعطيل نوع أساسي', 409, 'TEAM_TYPE_SYSTEM_LOCKED');
    }
    await db.query(
      'UPDATE team_types SET is_active = $2, updated_by = $3, updated_at = NOW() WHERE id = $1',
      [id, isActive, actorUserId],
    );
    return (await getTeamType(db, id))!;
  });
}

export async function listBranchTeamTypeIds(db: Queryable, branchId: number): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT btt.team_type_id AS id
     FROM branch_team_types btt
     JOIN team_types tt ON tt.id = btt.team_type_id
     WHERE btt.branch_id = $1 AND tt.is_active
     ORDER BY tt.sort_order, tt.id`,
    [branchId],
  );
  return rows.map(r => Number(r.id));
}

/** Replace the set of types a branch schedules with (DEC-026 D2). */
export async function setBranchTeamTypes(branchId: number, rawIds: unknown, actorUserId: number): Promise<number[]> {
  const ids = positiveIntegers(rawIds);
  if (ids.length === 0) throw new TeamTypeError('اختر نوع فريق واحداً على الأقل للفرع');
  return inTransaction(async db => {
    const { rows } = await db.query(
      'SELECT id FROM team_types WHERE id = ANY($1::int[]) AND is_active',
      [ids],
    );
    if (rows.length !== ids.length) throw new TeamTypeError('أحد أنواع الفرق المختارة غير موجود أو معطل');
    await db.query(
      'DELETE FROM branch_team_types WHERE branch_id = $1 AND NOT (team_type_id = ANY($2::int[]))',
      [branchId, ids],
    );
    await db.query(
      `INSERT INTO branch_team_types (branch_id, team_type_id, enabled_by)
       SELECT $1, unnest($2::int[]), $3
       ON CONFLICT (branch_id, team_type_id) DO NOTHING`,
      [branchId, ids, actorUserId],
    );
    return listBranchTeamTypeIds(db, branchId);
  });
}
