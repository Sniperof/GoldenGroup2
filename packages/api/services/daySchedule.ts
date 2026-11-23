// Day schedule model (DEC-026 phase 2). The single place that reads the
// teams of a day. Every planning, telemarketing and booking path asks this
// module for a team by its key and for its members by FUNCTION (lead, field,
// caller, owners), never by role name or array position.
//
// Stored shape (new):   day_schedules.teams = [{ key, teamType, members: { <slotKey>: number[] } }]
// Stored shape (legacy): teams = [{ supervisor, technician, trainee, telemarketers }], solos = [{ technician, ... }]
//
// Both are read. A legacy row is normalized on read: teams[i] becomes key
// `team_i` of type `standard`, solos[i] becomes `solo_i` of type `emergency`,
// so every key already persisted elsewhere (route_assignments, task lists,
// contact targets, open_tasks...) keeps pointing at the same team. A legacy
// slot with no lead is a team cleared in place, i.e. removed.
//
// Keys stay in the `team_N` / `solo_N` format the CHECK constraints and the
// task-list ids expect, but they are explicit and never reused: removing a
// team no longer shifts the others.

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { listTeamTypes, type TeamType, type TeamTypeSlot } from './teamTypes.js';

type Queryable = { query: PoolClient['query'] };

export const STANDARD_TEAM_TYPE = 'standard';
export const EMERGENCY_TEAM_TYPE = 'emergency';
export const TEAM_KEY_PATTERN = /^(team|solo)_(\d+)$/;

export interface ScheduledTeam {
  key: string;
  /** team_types.key (stable string), not the numeric id. */
  teamType: string;
  /** slot_key → employee ids, in the order they were placed. */
  members: Record<string, number[]>;
}

export interface ResolvedTeam extends ScheduledTeam {
  type: TeamType | null;
  leadEmployeeId: number | null;
  /** Everyone who goes on the visit: lead + field slots. */
  fieldEmployeeIds: number[];
  callerEmployeeIds: number[];
  /** Members whose personally owned clients enter the team load (lead + owning field slots). */
  ownerEmployeeIds: number[];
  memberEmployeeIds: number[];
  allowedTaskTypes: string[];
}

function toEmployeeId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function employeeIdList(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: number[] = [];
  for (const item of raw) {
    const id = toEmployeeId(item);
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

function isNewShape(entry: any): boolean {
  return Boolean(entry) && typeof entry === 'object' && typeof entry.key === 'string' && typeof entry.teamType === 'string';
}

function normalizeMembers(raw: unknown): Record<string, number[]> {
  const members: Record<string, number[]> = {};
  if (!raw || typeof raw !== 'object') return members;
  for (const [slotKey, ids] of Object.entries(raw as Record<string, unknown>)) {
    const list = employeeIdList(ids);
    if (list.length > 0) members[slotKey] = list;
  }
  return members;
}

/** Normalize a stored day_schedules row (either shape) into keyed teams. */
export function normalizeDaySchedule(row: { teams?: unknown; solos?: unknown } | null | undefined): ScheduledTeam[] {
  const teams: any[] = Array.isArray(row?.teams) ? (row!.teams as any[]) : [];
  const solos: any[] = Array.isArray(row?.solos) ? (row!.solos as any[]) : [];
  const result: ScheduledTeam[] = [];
  const seen = new Set<string>();

  const push = (team: ScheduledTeam) => {
    if (seen.has(team.key)) return;
    seen.add(team.key);
    result.push(team);
  };

  teams.forEach((entry, index) => {
    if (isNewShape(entry)) {
      push({ key: entry.key, teamType: entry.teamType, members: normalizeMembers(entry.members) });
      return;
    }
    const supervisor = toEmployeeId(entry?.supervisor);
    if (supervisor == null) return; // cleared in place = removed
    const members: Record<string, number[]> = { supervisor: [supervisor] };
    const technician = employeeIdList(entry?.technician);
    if (technician.length) members.technician = technician;
    const telemarketers = employeeIdList(entry?.telemarketers);
    if (telemarketers.length) members.telemarketers = telemarketers;
    push({ key: `team_${index}`, teamType: STANDARD_TEAM_TYPE, members });
  });

  solos.forEach((entry, index) => {
    if (isNewShape(entry)) {
      push({ key: entry.key, teamType: entry.teamType, members: normalizeMembers(entry.members) });
      return;
    }
    const technician = toEmployeeId(entry?.technician);
    if (technician == null) return;
    const members: Record<string, number[]> = { technician: [technician] };
    const telemarketers = employeeIdList(entry?.telemarketers);
    if (telemarketers.length) members.telemarketers = telemarketers;
    push({ key: `solo_${index}`, teamType: EMERGENCY_TEAM_TYPE, members });
  });

  return result;
}

/** Next unused `team_N` key for a day. Numbers are never reused. */
export function nextTeamKey(existingKeys: Iterable<string>): string {
  let max = -1;
  for (const key of existingKeys) {
    const match = TEAM_KEY_PATTERN.exec(key);
    if (match && match[1] === 'team') max = Math.max(max, Number(match[2]));
  }
  return `team_${max + 1}`;
}

export function findTeam<T extends ScheduledTeam>(teams: T[], key: string): T | null {
  return teams.find(team => team.key === key) ?? null;
}

function slotsByFunction(type: TeamType | null, fn: TeamTypeSlot['slotFunction']): TeamTypeSlot[] {
  return type ? type.slots.filter(slot => slot.slotFunction === fn) : [];
}

function collect(team: ScheduledTeam, slots: TeamTypeSlot[]): number[] {
  const out: number[] = [];
  for (const slot of slots) {
    for (const id of team.members[slot.slotKey] ?? []) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Resolve a team's members by function against its type definition. */
export function resolveTeam(team: ScheduledTeam, type: TeamType | null): ResolvedTeam {
  const leadSlots = slotsByFunction(type, 'lead');
  const fieldSlots = slotsByFunction(type, 'field');
  const callerSlots = slotsByFunction(type, 'caller');

  const lead = collect(team, leadSlots)[0] ?? null;
  const field = collect(team, fieldSlots);
  const callers = collect(team, callerSlots);
  const owningField = collect(team, fieldSlots.filter(slot => slot.countsOwnership));

  const fieldEmployeeIds = [...(lead != null ? [lead] : []), ...field.filter(id => id !== lead)];
  const ownerEmployeeIds = [...(lead != null ? [lead] : []), ...owningField.filter(id => id !== lead)];
  const memberEmployeeIds = [...fieldEmployeeIds, ...callers.filter(id => !fieldEmployeeIds.includes(id))];

  return {
    ...team,
    type,
    leadEmployeeId: lead,
    fieldEmployeeIds,
    callerEmployeeIds: callers,
    ownerEmployeeIds,
    memberEmployeeIds,
    allowedTaskTypes: type?.taskTypes ?? [],
  };
}

export function isEmergencyTeam(team: Pick<ScheduledTeam, 'teamType'>): boolean {
  return team.teamType === EMERGENCY_TEAM_TYPE;
}

/**
 * Legacy role view for snapshots and the ~36 readers of
 * team_snapshot.supervisorEmployeeId / technicianEmployeeId. For the seeded
 * types it is exactly the old shape. For a custom type the lead is reported as
 * the supervisor (the responsible person), and `technician` stays empty
 * unless the type has a slot keyed `technician`.
 */
export function legacyRoleView(team: ResolvedTeam): {
  supervisor: number | null;
  technician: number | null;
  trainee: number | null;
  telemarketers: number[];
} {
  const explicitSupervisor = team.members.supervisor?.[0] ?? null;
  const technician = team.members.technician?.[0] ?? null;
  const leadIsTechnician = team.leadEmployeeId != null && team.leadEmployeeId === technician;
  return {
    supervisor: explicitSupervisor ?? (leadIsTechnician ? null : team.leadEmployeeId),
    technician,
    trainee: team.members.trainee?.[0] ?? null,
    telemarketers: team.callerEmployeeIds,
  };
}

export type TeamTypeCatalog = Map<string, TeamType>;

export async function loadTeamTypeCatalog(db: Queryable = pool): Promise<TeamTypeCatalog> {
  const types = await listTeamTypes(db, { includeInactive: true });
  return new Map(types.map(type => [type.key, type]));
}

export async function loadScheduledTeams(db: Queryable, date: string, opts: { forUpdate?: boolean } = {}): Promise<ScheduledTeam[]> {
  const { rows } = await db.query(
    `SELECT teams, solos FROM day_schedules WHERE date = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [date],
  );
  return normalizeDaySchedule(rows[0]);
}

/** All teams of a day, resolved against the catalog. */
export async function loadResolvedTeams(db: Queryable, date: string, catalog?: TeamTypeCatalog): Promise<ResolvedTeam[]> {
  const [teams, types] = await Promise.all([
    loadScheduledTeams(db, date),
    catalog ? Promise.resolve(catalog) : loadTeamTypeCatalog(db),
  ]);
  return teams.map(team => resolveTeam(team, types.get(team.teamType) ?? null));
}

/** One team of a day by key, resolved; null when the day or key is unknown. */
export async function loadResolvedTeam(db: Queryable, date: string, key: string): Promise<ResolvedTeam | null> {
  const teams = await loadResolvedTeams(db, date);
  return findTeam(teams, key);
}

/**
 * Comparable identity of a team: its type and every member, sorted. Accepts a
 * keyed team, or a raw legacy slot (planning_task_exclusions.team_snapshot
 * rows written before phase 2) together with its key. Null when there is no
 * team (removed, or a placeholder).
 */
export function teamIdentity(entry: unknown, key: string): string | null {
  if (!entry || typeof entry !== 'object' || (entry as any).locked === true) return null;
  let team: ScheduledTeam | null;
  if (isNewShape(entry)) {
    team = { key, teamType: (entry as any).teamType, members: normalizeMembers((entry as any).members) };
  } else {
    const match = TEAM_KEY_PATTERN.exec(key);
    const legacy = match?.[1] === 'solo' ? { solos: [entry] } : { teams: [entry] };
    team = normalizeDaySchedule(legacy)[0] ?? null;
  }
  if (!team) return null;
  const members = Object.keys(team.members).sort().map(slot => [slot, [...team!.members[slot]!].sort((a, b) => a - b)]);
  return JSON.stringify({ teamType: team.teamType, members });
}

/** Display number of a key: team_3 → 4. */
export function teamKeyNumber(key: string): number | null {
  const match = TEAM_KEY_PATTERN.exec(key);
  return match ? Number(match[2]) + 1 : null;
}

/** «فريق فلان» / «طوارئ: فلان» / «<اسم النوع>: فلان», with a numbered fallback. */
export function teamDisplayLabel(
  team: Pick<ScheduledTeam, 'key' | 'teamType'>,
  leadName: string | null | undefined,
  typeName?: string | null,
): string {
  const name = typeof leadName === 'string' && leadName.trim() ? leadName.trim() : null;
  const number = teamKeyNumber(team.key);
  const suffix = number == null ? '' : ` #${number}`;
  if (team.teamType === STANDARD_TEAM_TYPE) return name ? `فريق ${name}` : `فريق${suffix}`;
  if (team.teamType === EMERGENCY_TEAM_TYPE) return name ? `طوارئ: ${name}` : `فريق طوارئ${suffix}`;
  const typeLabel = typeName?.trim() || 'فريق';
  return name ? `${typeLabel}: ${name}` : `${typeLabel}${suffix}`;
}

/** Serialize keyed teams to the stored (new) shape. */
export function serializeScheduledTeams(teams: ScheduledTeam[]): { teams: ScheduledTeam[]; solos: [] } {
  return {
    teams: teams.map(team => ({ key: team.key, teamType: team.teamType, members: normalizeMembers(team.members) })),
    solos: [],
  };
}
