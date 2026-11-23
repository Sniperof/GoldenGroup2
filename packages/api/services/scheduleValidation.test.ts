import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SchedulePayloadError,
  parseScheduleTeams,
  validateScheduledTeams,
  type ScheduleEmployeeInfo,
} from './scheduleValidation.js';
import type { TeamType } from './teamTypes.js';

const standard: TeamType = {
  id: 1, key: 'standard', name: 'فريق قياسي', description: null, isSystem: true, isActive: true, sortOrder: 10,
  slots: [
    { slotKey: 'supervisor', label: 'مشرف', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [2] },
    { slotKey: 'technician', label: 'فني', slotFunction: 'field', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [4] },
    { slotKey: 'telemarketers', label: 'مسوقون', slotFunction: 'caller', countsOwnership: false, minMembers: 0, maxMembers: 2, roleIds: [6] },
  ],
  taskTypes: [],
};
const collection: TeamType = {
  ...standard, id: 5, key: 'type_ab12cd34', name: 'فريق تحصيل', isSystem: false,
  slots: [{ slotKey: 'collector', label: 'محصّل', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [7, 2] }],
};
const catalog = new Map([[standard.key, standard], [collection.key, collection]]);

const emp = (id: number, roleId: number, extra: Partial<ScheduleEmployeeInfo> = {}): ScheduleEmployeeInfo =>
  ({ id, name: `موظف ${id}`, status: 'active', branchId: 3, roleId, canAppearInSchedule: true, ...extra });
const employees = new Map([
  [10, emp(10, 2)], [11, emp(11, 4)], [20, emp(20, 6)], [21, emp(21, 6)], [22, emp(22, 6)],
  [40, emp(40, 7)], [50, emp(50, 4, { branchId: 9 })], [51, emp(51, 4, { status: 'vacation' })],
]);

function validate(teams: any[], opts: { branchTypes?: string[]; stored?: Array<[string, string]> } = {}) {
  return validateScheduledTeams({
    teams,
    catalog,
    branchTeamTypes: new Set(opts.branchTypes ?? ['standard', collection.key]),
    storedTypeByKey: new Map(opts.stored ?? []),
    employees,
    branchId: 3,
  });
}
const errorOf = (result: ReturnType<typeof validate>) => ('error' in result ? result.error : null);

test('parse skips placeholders and gives new teams a fresh key', () => {
  let n = 4;
  const teams = parseScheduleTeams({
    teams: [
      { key: 'team_1', locked: true },
      { key: 'team_0', teamType: 'standard', members: { supervisor: [10, 10], technician: [11] } },
      { teamType: collection.key, members: { collector: [40] } },
    ],
  }, () => `team_${n++}`);
  assert.deepEqual(teams, [
    { key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11] } },
    { key: 'team_4', teamType: collection.key, members: { collector: [40] } },
  ]);
});

test('parse rejects malformed entries', () => {
  assert.throws(() => parseScheduleTeams({ teams: [{ members: {} }] }, () => 'team_0'), SchedulePayloadError);
  assert.throws(() => parseScheduleTeams({ teams: [{ key: 'x_1', teamType: 'standard' }] }, () => 'team_0'), SchedulePayloadError);
  assert.throws(() => parseScheduleTeams({ teams: [{ teamType: 'standard', members: { supervisor: ['a'] } }] }, () => 'team_0'), SchedulePayloadError);
});

test('a complete standard team and a custom team pass', () => {
  const result = validate([
    { key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11], telemarketers: [20] } },
    { key: 'team_1', teamType: collection.key, members: { collector: [40] } },
  ]);
  assert.deepEqual(result, { ok: true });
});

test('required slots, caps and unknown slots are enforced', () => {
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10] } }]))!, /يجب أن يضم فني/);
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11], telemarketers: [20, 21, 22] } }]))!, /2 أشخاص كحد أقصى/);
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11], driver: [40] } }]))!, /خانة غير معروفة/);
});

test('a slot accepts only its roles; one person sits in one slot', () => {
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [11], telemarketers: [10] } }]))!, /تكرار الموظف/);
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [40], technician: [11] } }]))!, /لا يناسب خانة مشرف/);
  // The collector slot accepts two roles (7 and 2).
  assert.deepEqual(validate([{ key: 'team_0', teamType: collection.key, members: { collector: [10] } }]), { ok: true });
});

test('employee status and branch are checked', () => {
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [50] } }]))!, /لا يتبع الفرع/);
  assert.match(errorOf(validate([{ key: 'team_0', teamType: 'standard', members: { supervisor: [10], technician: [51] } }]))!, /غير نشط/);
});

test('a type must be enabled for the branch, unless the stored team already has it', () => {
  const team = { key: 'team_3', teamType: collection.key, members: { collector: [40] } };
  assert.match(errorOf(validate([team], { branchTypes: ['standard'] }))!, /غير مفعّل لهذا الفرع/);
  assert.deepEqual(validate([team], { branchTypes: ['standard'], stored: [['team_3', collection.key]] }), { ok: true });
});
