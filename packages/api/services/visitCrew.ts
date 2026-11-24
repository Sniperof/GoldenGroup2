// Typed visit crew (DEC-026 + DEC-020, 2026-11-24). The crew of a visit is
// the team type's lead and field slots; callers stay with the team and are
// never replaced on a visit. A replacement crew is stored whole in
// reassigned_team_snapshot, which is the reference; the legacy reassigned_*
// columns are derived from it for their readers.

import { EMERGENCY_TEAM_TYPE, STANDARD_TEAM_TYPE, TEAM_KEY_PATTERN } from './daySchedule.js';
import type { TeamType, TeamTypeSlot } from './teamTypes.js';

export type CrewSlots = Record<string, number[]>;

export class CrewValidationError extends Error {}

function toId(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
}

function idList(value: unknown): number[] {
  const out: number[] = [];
  for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) {
    const id = toId(item);
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

function cleanSlots(raw: unknown): CrewSlots {
  const slots: CrewSlots = {};
  if (!raw || typeof raw !== 'object') return slots;
  for (const [key, ids] of Object.entries(raw as Record<string, unknown>)) {
    const list = idList(ids);
    if (list.length > 0) slots[key] = list;
  }
  return slots;
}

/** Team type of a visit snapshot; older snapshots only carry the key. */
export function snapshotTeamType(snapshot: any): string {
  if (typeof snapshot?.teamType === 'string' && snapshot.teamType) return snapshot.teamType;
  return /^solo_/.test(String(snapshot?.teamKey ?? '')) ? EMERGENCY_TEAM_TYPE : STANDARD_TEAM_TYPE;
}

/** Members by slot of a visit snapshot, from the typed fields or the legacy role fields. */
export function snapshotCrew(snapshot: any): CrewSlots {
  if (snapshot?.members && typeof snapshot.members === 'object') return cleanSlots(snapshot.members);
  const slots: CrewSlots = {};
  const type = snapshotTeamType(snapshot);
  const supervisor = toId(snapshot?.supervisorEmployeeId);
  const technician = toId(snapshot?.technicianEmployeeId);
  if (type !== EMERGENCY_TEAM_TYPE && supervisor != null) slots.supervisor = [supervisor];
  if (technician != null) slots.technician = [technician];
  const callers = idList(snapshot?.telemarketerEmployeeIds);
  if (callers.length > 0) slots.telemarketers = callers;
  return slots;
}

/**
 * The crew that will go: the typed replacement snapshot when there is one;
 * else the original with any legacy per-role replacement applied.
 */
export function effectiveCrew(visit: {
  team_snapshot: any;
  reassigned_team_snapshot?: any;
  reassigned_supervisor_id: number | null;
  reassigned_technician_id: number | null;
}): CrewSlots {
  const replaced = visit.reassigned_team_snapshot;
  if (replaced?.members && typeof replaced.members === 'object') return cleanSlots(replaced.members);
  const crew = snapshotCrew(visit.team_snapshot);
  const supervisor = toId(visit.reassigned_supervisor_id);
  const technician = toId(visit.reassigned_technician_id);
  if (supervisor != null) crew.supervisor = [supervisor];
  if (technician != null) crew.technician = [technician];
  return crew;
}

/** Lead and field slots of a type: the people who travel. */
export function crewSlots(type: TeamType): TeamTypeSlot[] {
  return type.slots.filter(slot => slot.slotFunction !== 'caller');
}

/** Comparable form of the travelling part of a crew. */
export function crewIdentity(type: TeamType, crew: CrewSlots): string {
  return JSON.stringify(crewSlots(type).map(slot => [slot.slotKey, [...(crew[slot.slotKey] ?? [])].sort((a, b) => a - b)]));
}

/**
 * D2 generalized: the requested crew keeps the type's shape. Every lead/field
 * slot within its bounds; a slot filled in the original crew can be replaced
 * but not emptied; one person holds one slot. Caller slots are copied from the
 * current crew (callers do not travel). Returns the full requested crew.
 */
export function buildRequestedCrew(type: TeamType, original: CrewSlots, current: CrewSlots, rawRequested: unknown): CrewSlots {
  const requestedRaw = cleanSlots(rawRequested);
  const travelling = new Map(crewSlots(type).map(slot => [slot.slotKey, slot]));
  const known = new Set(type.slots.map(slot => slot.slotKey));
  for (const key of Object.keys(requestedRaw)) {
    if (!known.has(key)) throw new CrewValidationError('خانة غير معروفة في نوع هذا الفريق.');
  }

  const result: CrewSlots = {};
  const seen = new Set<number>();
  for (const slot of travelling.values()) {
    const ids = requestedRaw[slot.slotKey] ?? [];
    if ((original[slot.slotKey]?.length ?? 0) > 0 && ids.length === 0) {
      throw new CrewValidationError(`لا يمكن إزالة ${slot.label} من الفريق، يمكن استبداله فقط.`);
    }
    if (ids.length < slot.minMembers) throw new CrewValidationError(`خانة ${slot.label} مطلوبة.`);
    if (slot.maxMembers != null && ids.length > slot.maxMembers) {
      throw new CrewValidationError(`خانة ${slot.label} تقبل ${slot.maxMembers} أشخاص كحد أقصى.`);
    }
    for (const id of ids) {
      if (seen.has(id)) throw new CrewValidationError('لا يمكن أن يشغل موظف واحد أكثر من خانة في الفريق.');
      seen.add(id);
    }
    if (ids.length > 0) result[slot.slotKey] = ids;
  }
  for (const slot of type.slots.filter(s => s.slotFunction === 'caller')) {
    if (current[slot.slotKey]?.length) result[slot.slotKey] = [...current[slot.slotKey]!];
  }
  return result;
}

/** People brought in by the change, with the slot each one fills. */
export function incomingMembers(type: TeamType, current: CrewSlots, requested: CrewSlots): Array<{ id: number; slot: TeamTypeSlot }> {
  const already = new Set(crewSlots(type).flatMap(slot => current[slot.slotKey] ?? []));
  return crewSlots(type).flatMap(slot =>
    (requested[slot.slotKey] ?? []).filter(id => !already.has(id)).map(id => ({ id, slot })));
}

export function validTeamKey(value: unknown): string | null {
  return typeof value === 'string' && TEAM_KEY_PATTERN.test(value) ? value : null;
}
