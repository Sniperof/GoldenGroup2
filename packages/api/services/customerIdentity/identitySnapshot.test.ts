import assert from 'node:assert/strict';
import test from 'node:test';
import { pickContactDetails, resolveCustomerIdentitySnapshot } from './identitySnapshot.js';

const CLAIMS = { appAccountId: 7, clientId: 42, phone: '0952322222' };

function mockDb(row: Record<string, unknown> | null) {
  return { async query() { return { rows: row ? [row] : [] }; } };
}

const FULL_ROW = {
  first_name: 'سماح',
  father_name: 'هادي',
  last_name: 'عدنان',
  contacts: [
    { type: 'mobile', number: '0952322222', status: 'active', isPrimary: true, hasWhatsApp: true },
    { type: 'mobile', number: '0955111222', status: 'active', isPrimary: false, hasWhatsApp: false },
  ],
};

test('identity comes from the record, including the composed name', async () => {
  const snap = await resolveCustomerIdentitySnapshot(CLAIMS, mockDb(FULL_ROW));
  assert.equal(snap.firstName, 'سماح');
  assert.equal(snap.fatherName, 'هادي');
  assert.equal(snap.lastName, 'عدنان');
  assert.equal(snap.name, 'سماح هادي عدنان');
  assert.equal(snap.primaryPhone, '0952322222');
  assert.equal(snap.clientId, 42);
  assert.equal(snap.appAccountId, 7);
});

test('the primary phone is the account login number, not a contacts entry', async () => {
  const snap = await resolveCustomerIdentitySnapshot(
    { ...CLAIMS, phone: '0955111222' },
    mockDb(FULL_ROW),
  );
  assert.equal(snap.primaryPhone, '0955111222');
  // The other entry now becomes the secondary.
  assert.equal(snap.secondaryPhone, '0952322222');
});

test('an incomplete profile is refused by name, not stored empty', async () => {
  await assert.rejects(
    () => resolveCustomerIdentitySnapshot(CLAIMS, mockDb({ ...FULL_ROW, last_name: null })),
    (err: any) => {
      assert.equal(err.status, 409);
      assert.equal(err.details.code, 'customer_profile_incomplete');
      assert.deepEqual(err.details.missing, ['lastName']);
      return true;
    },
  );
  await assert.rejects(
    () => resolveCustomerIdentitySnapshot(CLAIMS, mockDb({ ...FULL_ROW, first_name: '   ', last_name: '' })),
    (err: any) => {
      assert.deepEqual(err.details.missing, ['firstName', 'lastName']);
      return true;
    },
  );
});

test('a missing client record is a 404, not a silent empty snapshot', async () => {
  await assert.rejects(
    () => resolveCustomerIdentitySnapshot(CLAIMS, mockDb(null)),
    (err: any) => err.status === 404 && err.details.code === 'linked_client_record_not_found',
  );
});

test('a father name is optional and drops out of the composed name', async () => {
  const snap = await resolveCustomerIdentitySnapshot(
    CLAIMS,
    mockDb({ ...FULL_ROW, father_name: '  ' }),
  );
  assert.equal(snap.fatherName, null);
  assert.equal(snap.name, 'سماح عدنان');
});

test('WhatsApp flags are read from the record, never guessed', () => {
  const r = pickContactDetails(FULL_ROW.contacts, '0952322222');
  assert.equal(r.primaryHasWhatsapp, true);
  assert.equal(r.secondaryPhone, '0955111222');
  assert.equal(r.secondaryHasWhatsapp, false);
});

test('a retired number is never offered as a contact', () => {
  const r = pickContactDetails(
    [{ number: '0955111222', status: 'inactive', hasWhatsApp: true }],
    '0952322222',
  );
  assert.equal(r.secondaryPhone, null);
});

test('the first eligible entry wins and malformed entries are skipped', () => {
  const r = pickContactDetails(
    [null, 'not-a-number', { number: '' }, { value: '0955111222', hasWhatsApp: true }, { number: '0956000000' }],
    '0952322222',
  );
  assert.equal(r.secondaryPhone, '0955111222');
  assert.equal(r.secondaryHasWhatsapp, true);
});

test('absent or non-array contacts degrade to no secondary', () => {
  for (const contacts of [null, undefined, {}, 'x', []]) {
    const r = pickContactDetails(contacts, '0952322222');
    assert.equal(r.secondaryPhone, null);
    assert.equal(r.primaryHasWhatsapp, false);
  }
});
