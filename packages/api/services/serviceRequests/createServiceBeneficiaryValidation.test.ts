import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceRequest } from './createService.js';

test('rejects a request that selects both a beneficiary client and candidate', async () => {
  const result = await createServiceRequest({
    requestType: 'emergency_maintenance',
    channel: 'admin_manual',
    applicationSource: null,
    submittedPayload: {},
    requesterUserId: null,
    requesterAppAccountId: null,
    requesterClientId: null,
    requesterExternal: null,
    beneficiaryClientId: 41,
    beneficiaryCandidateId: 51,
    beneficiaryExternal: null,
    referrerUserId: null,
    referrerClientId: null,
    referrerExternal: null,
    submissionType: 'apply',
    submitterTier: 'customer',
    contractId: null,
    deviceSource: 'company_device',
    installedDeviceId: null,
    externalDeviceName: null,
    externalDeviceSerial: null,
    problemDescription: 'test',
    requestedActionTypeId: null,
    attachments: [],
    serviceAddress: { governorate: 1, detailed_address: 'test' },
    priority: 'Normal',
    branchId: 3,
    actorUserId: 8,
    actorRole: 'operator',
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'beneficiary_target_must_be_exclusive');
});
