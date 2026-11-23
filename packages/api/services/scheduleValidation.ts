// Validation of a day schedule payload against the team types catalog
// (DEC-026 D3/D4). Pure: the route loads employees, branch types and the
// stored row, this decides.

import { TEAM_KEY_PATTERN, type ScheduledTeam, type TeamTypeCatalog } from './daySchedule.js';

export interface ScheduleEmployeeInfo {
  id: number;
  name: string | null;
  status: string;
  branchId: number | null;
  roleId: number | null;
  canAppearInSchedule: boolean;
}

export type ScheduleValidationResult = { ok: true } | { ok: false; error: string };

export class SchedulePayloadError extends Error {}

function fail(error: string): ScheduleValidationResult {
  return { ok: false, error };
}

/**
 * Parse the request body into own teams. Entries are `{ key?, teamType, members }`
 * or `{ key, locked: true }` placeholders (skipped). A missing key is filled by
 * `assignKey` (a fresh, never-used `team_N`).
 */
export function parseScheduleTeams(body: unknown, assignKey: () => string): ScheduledTeam[] {
  const raw = (body as any)?.teams;
  if (!Array.isArray(raw)) throw new SchedulePayloadError('صيغة جدول الفرق غير صحيحة');
  const teams: ScheduledTeam[] = [];
  const keys = new Set<string>();
  raw.forEach((entry: any, index: number) => {
    const position = index + 1;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SchedulePayloadError(`الفريق ${position} بصيغة غير صحيحة`);
    }
    if (entry.locked === true) return;
    if (typeof entry.teamType !== 'string' || !entry.teamType) {
      throw new SchedulePayloadError(`الفريق ${position} بلا نوع`);
    }
    let key = typeof entry.key === 'string' ? entry.key : '';
    if (key && !TEAM_KEY_PATTERN.test(key)) throw new SchedulePayloadError(`مفتاح الفريق ${position} غير صالح`);
    if (!key) key = assignKey();
    if (keys.has(key)) throw new SchedulePayloadError(`مفتاح الفريق ${key} مكرر`);
    keys.add(key);

    const members: Record<string, number[]> = {};
    const rawMembers = entry.members ?? {};
    if (typeof rawMembers !== 'object' || Array.isArray(rawMembers)) {
      throw new SchedulePayloadError(`أعضاء الفريق ${position} بصيغة غير صحيحة`);
    }
    for (const [slotKey, ids] of Object.entries(rawMembers)) {
      if (!Array.isArray(ids)) throw new SchedulePayloadError(`خانة ${slotKey} في الفريق ${position} يجب أن تكون قائمة`);
      const list: number[] = [];
      for (const id of ids) {
        if (!Number.isInteger(id) || (id as number) <= 0) {
          throw new SchedulePayloadError(`معرف موظف غير صالح في الفريق ${position}`);
        }
        if (!list.includes(id as number)) list.push(id as number);
      }
      if (list.length > 0) members[slotKey] = list;
    }
    teams.push({ key, teamType: entry.teamType, members });
  });
  return teams;
}

export function validateScheduledTeams(params: {
  teams: ScheduledTeam[];
  catalog: TeamTypeCatalog;
  /** Types enabled for the acting branch (D2). */
  branchTeamTypes: Set<string>;
  /** Stored type per key: a stored team keeps a type the branch later disabled. */
  storedTypeByKey: Map<string, string>;
  employees: Map<number, ScheduleEmployeeInfo>;
  branchId: number;
}): ScheduleValidationResult {
  const { teams, catalog, branchTeamTypes, storedTypeByKey, employees, branchId } = params;
  const placedIn = new Map<number, string>();

  for (const [index, team] of teams.entries()) {
    const position = `الفريق ${index + 1}`;
    const type = catalog.get(team.teamType);
    if (!type) return fail(`${position}: نوع الفريق غير موجود`);
    const keepsStoredType = storedTypeByKey.get(team.key) === team.teamType;
    if (!keepsStoredType && (!type.isActive || !branchTeamTypes.has(type.key))) {
      return fail(`${position}: نوع «${type.name}» غير مفعّل لهذا الفرع`);
    }

    const slotByKey = new Map(type.slots.map(slot => [slot.slotKey, slot]));
    for (const slotKey of Object.keys(team.members)) {
      if (!slotByKey.has(slotKey)) return fail(`${position}: خانة غير معروفة في نوع «${type.name}»`);
    }

    for (const slot of type.slots) {
      const ids = team.members[slot.slotKey] ?? [];
      if (ids.length < slot.minMembers) {
        return fail(slot.minMembers === 1
          ? `${position} يجب أن يضم ${slot.label}`
          : `${position}: خانة ${slot.label} تحتاج ${slot.minMembers} أشخاص على الأقل`);
      }
      if (slot.maxMembers != null && ids.length > slot.maxMembers) {
        return fail(`${position}: خانة ${slot.label} تقبل ${slot.maxMembers} أشخاص كحد أقصى`);
      }

      for (const id of ids) {
        const label = `${position} (${slot.label})`;
        const previous = placedIn.get(id);
        if (previous) return fail(`لا يمكن تكرار الموظف #${id} في أكثر من خانة (${previous} و ${label})`);
        placedIn.set(id, label);

        const employee = employees.get(id);
        if (!employee) return fail(`الموظف #${id} غير موجود`);
        const who = employee.name ? `${employee.name} (#${id})` : `#${id}`;
        if (employee.status !== 'active') return fail(`الموظف ${who} غير نشط ولا يمكن حفظه في جدول الفرق`);
        if (!employee.canAppearInSchedule) return fail(`الموظف ${who} لا يملك صلاحية الظهور في جدولة الفرق`);
        if (Number(employee.branchId) !== Number(branchId)) return fail(`الموظف ${who} لا يتبع الفرع الحالي`);
        if (employee.roleId == null || !slot.roleIds.includes(employee.roleId)) {
          return fail(`دور الموظف ${who} لا يناسب خانة ${slot.label}`);
        }
      }
    }
  }

  return { ok: true };
}
