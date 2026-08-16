import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NAME_NOMINATION_FORM_VERSION,
  validateNameNominationForm,
} from './nameNominationFormSchema.js';

const migration = readFileSync(
  new URL('../../../../migrations/419_name_nomination_mobile_v2_keys.sql', import.meta.url),
  'utf8',
);
const intake = readFileSync(new URL('./mobileNameNominationIntake.ts', import.meta.url), 'utf8');

test('name nomination v2 is explicit in code and registry migration', () => {
  assert.equal(NAME_NOMINATION_FORM_VERSION, 'name_nomination.mobile.v2');
  assert.match(migration, /default_form_version\s*=\s*'name_nomination\.mobile\.v2'/);
  assert.match(migration, /WHERE request_type = 'name_nomination'/);
});

test('v2 accepts the shared requester-phone and SmartGeo vocabulary', () => {
  const result = validateNameNominationForm({
    requestType: 'name_nomination',
    formVersion: NAME_NOMINATION_FORM_VERSION,
    requesterFirstName: 'سارة',
    requesterPhone: '0999999999',
    requesterPhoneHasWhatsapp: true,
    names: [{
      firstName: 'أحمد',
      governorate: 1,
      cityOrArea: 2,
      subArea: 3,
      neighborhood: 4,
      primaryPhone: '0988888888',
    }],
  });
  assert.equal(result.ok, true);
});

test('intake reads the same canonical v2 keys that the validator declares', () => {
  assert.match(intake, /body\.requesterPhone\b/);
  assert.match(intake, /body\.requesterPhoneHasWhatsapp\b/);
  assert.match(intake, /raw\.cityOrArea\b/);
  assert.match(intake, /raw\.subArea\b/);
  assert.doesNotMatch(intake, /body\.requesterPrimaryPhone\b/);
  assert.doesNotMatch(intake, /body\.requesterPrimaryPhoneHasWhatsapp\b/);
  assert.doesNotMatch(intake, /raw\.region\b/);
  assert.doesNotMatch(intake, /raw\.subdistrict\b/);
});
