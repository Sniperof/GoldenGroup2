import assert from 'node:assert/strict';
import test from 'node:test';
import { decideWebDeviceAccess, parseAllowedSlots } from './webDeviceAccessPolicy.js';

const ALLOWED = ['SUPERVISOR', 'TECHNICIAN'];

test('an empty allow-list switches the feature off entirely', () => {
  for (const deviceClass of ['mobile', 'tablet', 'desktop'] as const) {
    const d = decideWebDeviceAccess({ deviceClass, teamSlotType: null, allowedSlots: [] });
    assert.equal(d.blocked, null, deviceClass);
    assert.equal(d.enforced, false);
  }
});

test('desktop is never restricted — it is the escape the rule points to', () => {
  const d = decideWebDeviceAccess({
    deviceClass: 'desktop', teamSlotType: null, allowedSlots: ALLOWED,
  });
  assert.equal(d.blocked, null);
  assert.equal(d.enforced, true);
});

test('allowed team slots pass on phone and tablet', () => {
  for (const slot of ALLOWED) {
    for (const deviceClass of ['mobile', 'tablet'] as const) {
      const d = decideWebDeviceAccess({ deviceClass, teamSlotType: slot, allowedSlots: ALLOWED });
      assert.equal(d.blocked, null, `${slot} on ${deviceClass}`);
    }
  }
});

test('tablets are restricted exactly like phones', () => {
  const d = decideWebDeviceAccess({
    deviceClass: 'tablet', teamSlotType: null, allowedSlots: ALLOWED,
  });
  assert.equal(d.blocked?.code, 'device_not_permitted');
});

test('a role with no team slot is blocked on restricted devices', () => {
  for (const slot of [null, undefined, '', '   ']) {
    const d = decideWebDeviceAccess({
      deviceClass: 'mobile', teamSlotType: slot, allowedSlots: ALLOWED,
    });
    assert.ok(d.blocked, `slot ${JSON.stringify(slot)} should be blocked`);
  }
});

test('a team slot outside the list is blocked', () => {
  // TELEMARKETER and TRAINEE exist in the roles CHECK constraint but are not
  // granted mobile access unless an admin adds them to the setting.
  for (const slot of ['TELEMARKETER', 'TRAINEE']) {
    const d = decideWebDeviceAccess({
      deviceClass: 'mobile', teamSlotType: slot, allowedSlots: ALLOWED,
    });
    assert.ok(d.blocked, slot);
  }
});

test('there is no exemption — the decision never reads a super-admin flag', () => {
  // The operator chose this explicitly: once enabled, nobody turns it off from
  // a phone. The function signature is the guarantee — it takes no such input.
  const d = decideWebDeviceAccess({
    deviceClass: 'mobile', teamSlotType: null, allowedSlots: ALLOWED,
  });
  assert.ok(d.blocked);
  assert.ok(d.blocked.message.includes('الحاسوب'));
});

test('slot matching is case- and whitespace-insensitive on both sides', () => {
  const d = decideWebDeviceAccess({
    deviceClass: 'mobile',
    teamSlotType: '  supervisor ',
    allowedSlots: parseAllowedSlots(' supervisor , technician '),
  });
  assert.equal(d.blocked, null);
});

test('parsing the setting tolerates blanks and stray separators', () => {
  assert.deepEqual(parseAllowedSlots(''), []);
  assert.deepEqual(parseAllowedSlots('   '), []);
  assert.deepEqual(parseAllowedSlots(',,'), []);
  assert.deepEqual(parseAllowedSlots('SUPERVISOR,,TECHNICIAN,'), ALLOWED);
  assert.deepEqual(parseAllowedSlots('supervisor'), ['SUPERVISOR']);
});
