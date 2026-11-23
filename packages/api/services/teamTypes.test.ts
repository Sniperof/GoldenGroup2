import test from 'node:test';
import assert from 'node:assert/strict';
import { TeamTypeError, checkTeamTypeUpdate, normalizeTeamTypeInput, type TeamType } from './teamTypes.js';

const collectionTeam = {
  name: 'فريق تحصيل',
  slots: [
    { slotKey: 'collector', label: 'محصّل', slotFunction: 'lead', roleIds: [7, 3] },
    { label: 'سائق', slotFunction: 'field', countsOwnership: false, minMembers: 0, maxMembers: 1, roleIds: [9] },
    { label: 'مسوقون', slotFunction: 'caller', countsOwnership: true, maxMembers: '', roleIds: [6] },
  ],
  taskTypes: ['installment_collection', 'gift_delivery', 'installment_collection'],
};

function rejects(raw: unknown, pattern: RegExp) {
  assert.throws(() => normalizeTeamTypeInput(raw), (err: unknown) =>
    err instanceof TeamTypeError && pattern.test(err.message));
}

test('a valid type is normalized: lead forced to one owning member, callers never own', () => {
  const input = normalizeTeamTypeInput(collectionTeam);
  const [lead, driver, callers] = input.slots;
  assert.deepEqual(
    { ...lead, slotKey: undefined },
    { slotKey: undefined, label: 'محصّل', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [3, 7] },
  );
  assert.equal(lead!.slotKey, 'collector');
  assert.match(driver!.slotKey, /^slot_[0-9a-f]{8}$/);
  assert.equal(driver!.maxMembers, 1);
  assert.equal(callers!.countsOwnership, false);
  assert.equal(callers!.maxMembers, null);
  assert.deepEqual(input.taskTypes, ['gift_delivery', 'installment_collection']);
});

test('exactly one lead slot is required', () => {
  rejects({ ...collectionTeam, slots: collectionTeam.slots.slice(1) }, /خانة رئيس واحدة/);
  rejects({ ...collectionTeam, slots: [...collectionTeam.slots, { label: 'رئيس 2', slotFunction: 'lead', roleIds: [1] }] }, /خانة رئيس واحدة/);
});

test('every slot accepts at least one role and has a unique label', () => {
  rejects({ ...collectionTeam, slots: [{ label: 'محصّل', slotFunction: 'lead', roleIds: [] }] }, /دوراً واحداً/);
  rejects({ ...collectionTeam, slots: [...collectionTeam.slots, { label: 'سائق', slotFunction: 'field', roleIds: [9] }] }, /مكرر/);
});

test('member bounds are checked', () => {
  rejects({ ...collectionTeam, slots: [collectionTeam.slots[0], { label: 'فني', slotFunction: 'field', minMembers: 2, maxMembers: 1, roleIds: [4] }] }, /أقل من أقل عدد/);
  rejects({ ...collectionTeam, slots: [collectionTeam.slots[0], { label: 'فني', slotFunction: 'field', minMembers: -1, roleIds: [4] }] }, /غير صالح/);
});

test('a type needs a name and at least one task type', () => {
  rejects({ ...collectionTeam, name: '  ' }, /اسم نوع الفريق مطلوب/);
  rejects({ ...collectionTeam, taskTypes: [] }, /نوع مهمة واحداً/);
});

const storedStandard: TeamType = {
  id: 1, key: 'standard', name: 'فريق قياسي', description: null, isSystem: true, isActive: true, sortOrder: 10,
  slots: [
    { slotKey: 'supervisor', label: 'مشرف', slotFunction: 'lead', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [2] },
    { slotKey: 'technician', label: 'فني', slotFunction: 'field', countsOwnership: true, minMembers: 1, maxMembers: 1, roleIds: [4] },
  ],
  taskTypes: ['device_demo', 'periodic_maintenance'],
};

function update(changes: Partial<{ slots: any[]; taskTypes: string[] }>) {
  return normalizeTeamTypeInput({
    name: 'فريق قياسي',
    slots: changes.slots ?? storedStandard.slots,
    taskTypes: changes.taskTypes ?? storedStandard.taskTypes,
  });
}

test('a slot keeps its function', () => {
  const next = update({ slots: [storedStandard.slots[0], { ...storedStandard.slots[1], slotFunction: 'caller' }] });
  assert.throws(() => checkTeamTypeUpdate({ ...storedStandard, isSystem: false }, next, false), /وظيفة الخانة/);
});

test('a used or system type keeps its slots; an unused custom type may drop one', () => {
  const next = update({ slots: [storedStandard.slots[0]] });
  assert.throws(() => checkTeamTypeUpdate(storedStandard, next, false), /لا يمكن حذف الخانة/);
  assert.throws(() => checkTeamTypeUpdate({ ...storedStandard, isSystem: false }, next, true), /لا يمكن حذف الخانة/);
  assert.doesNotThrow(() => checkTeamTypeUpdate({ ...storedStandard, isSystem: false }, next, false));
});

test('a system type keeps its allowed task types but may change roles and labels', () => {
  assert.throws(() => checkTeamTypeUpdate(storedStandard, update({ taskTypes: ['device_demo'] }), false), /ثابتة/);
  const relabeled = update({ slots: [{ ...storedStandard.slots[0], label: 'مشرفة', roleIds: [2, 5] }, storedStandard.slots[1]] });
  assert.doesNotThrow(() => checkTeamTypeUpdate(storedStandard, relabeled, true));
});
