import test from 'node:test';
import assert from 'node:assert/strict';
import { getComplaintSecondaryContact } from './complaintService.js';

test('a linked client without a secondary contact keeps the optional phone empty', () => {
  assert.equal(getComplaintSecondaryContact([], '0912345678'), null);
  assert.equal(getComplaintSecondaryContact([
    { type: 'mobile', number: '0912345678', status: 'active' },
  ], '0912345678'), null);
});

test('landline and unusable contacts are not treated as a secondary mobile', () => {
  assert.equal(getComplaintSecondaryContact([
    { type: 'landline', number: '1234567', status: 'active' },
    { type: 'mobile', number: 'not-a-phone', status: 'active' },
    { type: 'mobile', number: '0999999999', status: 'invalid' },
  ], '0912345678'), null);
});

test('a valid active secondary mobile is selected and may carry WhatsApp metadata', () => {
  const contact = getComplaintSecondaryContact([
    { type: 'mobile', number: '+963 933 456 789', status: 'preferred', hasWhatsApp: true },
  ], '0912345678');
  assert.equal(contact?.number, '+963 933 456 789');
  assert.equal(contact?.hasWhatsApp, true);
});
