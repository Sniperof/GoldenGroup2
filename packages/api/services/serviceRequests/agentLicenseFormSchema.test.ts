import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_LICENSE_FORM_VERSION, validateAgentLicenseForm } from './agentLicenseFormSchema.js';

const valid = {
  requestType: 'agent_license', formVersion: AGENT_LICENSE_FORM_VERSION,
  firstName: 'سارة', lastName: 'خليل', birthDate: '1990-01-01',
  primaryMobileNumber: '0933333333', hasCommercialRegistration: false,
  businessActivityType: 'تجارة', yearsOfExperience: 4, governorate: 1,
};

test('agent-license v1 accepts its minimal contract and every newly optional field may be absent', () => {
  assert.deepEqual(validateAgentLicenseForm(valid), { ok: true, issues: [], unknownFields: [] });
});

test('agent-license WhatsApp flags preserve optional boolean semantics and unknown fields fail closed', () => {
  assert.equal(validateAgentLicenseForm({ ...valid, primaryMobileHasWhatsapp: true,
    secondaryMobileNumber: '0944444444', secondaryMobileHasWhatsapp: false }).ok, true);
  const invalid = validateAgentLicenseForm({ ...valid, activityType: 'غير معلن' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.unknownFields, ['activityType']);
});

test('agent-license attachments accept only declared photo/document envelopes and cap the total', () => {
  assert.equal(validateAgentLicenseForm({ ...valid, attachments: [
    { uploadToken: '00000000-0000-4000-8000-000000000001', category: 'photo' },
    { uploadToken: '00000000-0000-4000-8000-000000000002', category: 'document' },
  ] }).ok, true);
  assert.equal(validateAgentLicenseForm({ ...valid, attachments: [
    { uploadToken: 'x', category: 'video' },
  ] }).ok, false);
});
