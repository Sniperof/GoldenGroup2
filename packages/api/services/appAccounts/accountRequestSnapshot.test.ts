import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, createAccountRequest, type AccountRequestForm } from './accountRequestService.js';

const VALID_FORM: AccountRequestForm = {
  firstName: 'علي',
  fatherName: 'محمد',
  lastName: 'الخالد',
  primaryMobile: '0912345678',
  primaryMobileHasWhatsapp: true,
  secondaryMobile: '0998765432',
  secondaryMobileHasWhatsapp: false,
  governorate: 1,
  detailedAddress: 'شارع الثورة',
};

test('account request snapshot returns the full name and WhatsApp flags for create and MINE', () => {
  const snapshot = buildSnapshot(
    '42',
    'SR-20260805-0042',
    '2026-08-05T12:00:00.000Z',
    {
      first_name: 'علي',
      father_name: 'محمد',
      last_name: 'الخالد',
      primary_mobile: '0912345678',
      primary_mobile_has_whatsapp: true,
      secondary_mobile: '0998765432',
      secondary_mobile_has_whatsapp: false,
      address_labels: { governorate: 'دمشق' },
      detailed_address: 'شارع الثورة',
    },
    '0912345678',
  );

  assert.equal(snapshot.requestId, 42);
  assert.equal(snapshot.firstName, 'علي');
  assert.equal(snapshot.fatherName, 'محمد');
  assert.equal(snapshot.lastName, 'الخالد');
  assert.equal(snapshot.primaryMobileHasWhatsapp, true);
  assert.equal(snapshot.secondaryMobile, '0998765432');
  assert.equal(snapshot.secondaryMobileHasWhatsapp, false);
});

test('legacy account request snapshots remain readable with safe defaults', () => {
  const snapshot = buildSnapshot(
    7,
    'SR-20260701-0007',
    '2026-07-01T12:00:00.000Z',
    { first_name: 'لين', last_name: 'أحمد', primary_mobile: '0933333333' },
    '0933333333',
  );

  assert.equal(snapshot.fatherName, null);
  assert.equal(snapshot.primaryMobileHasWhatsapp, null);
  assert.equal(snapshot.secondaryMobile, null);
  assert.equal(snapshot.secondaryMobileHasWhatsapp, null);
});

test('account creation requires father name and the primary WhatsApp flag before database work', async () => {
  await assert.rejects(
    createAccountRequest({ handle: 'verified-handle', form: { ...VALID_FORM, fatherName: '' } }),
    (error: any) => error?.status === 400,
  );
  await assert.rejects(
    createAccountRequest({
      handle: 'verified-handle',
      form: { ...VALID_FORM, primaryMobileHasWhatsapp: undefined as unknown as boolean },
    }),
    (error: any) => error?.status === 400,
  );
});

test('account creation validates the secondary mobile and its WhatsApp flag as one pair', async () => {
  await assert.rejects(
    createAccountRequest({
      handle: 'verified-handle',
      form: { ...VALID_FORM, secondaryMobileHasWhatsapp: undefined },
    }),
    (error: any) => error?.status === 400,
  );
  await assert.rejects(
    createAccountRequest({
      handle: 'verified-handle',
      form: { ...VALID_FORM, secondaryMobile: null, secondaryMobileHasWhatsapp: true },
    }),
    (error: any) => error?.status === 400,
  );
  await assert.rejects(
    createAccountRequest({
      handle: 'verified-handle',
      form: { ...VALID_FORM, secondaryMobile: VALID_FORM.primaryMobile },
    }),
    (error: any) => error?.status === 400,
  );
});
