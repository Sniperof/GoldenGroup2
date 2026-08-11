import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { createInternalPeriodicMaintenanceRequest } from './internalPeriodicMaintenanceRequest.js';

function base(request: Record<string, unknown>, beneficiaryClientId: number | null = 9) {
  return {
    db: { async query() { throw new Error('unexpected database query'); } } as unknown as PoolClient,
    request,
    requesterClientId: 9,
    beneficiaryClientId,
    sourceCallLogId: '00000000-0000-4000-8000-000000000001',
    actorUserId: 4,
  };
}

test('telemarketing periodic intake requires an already registered beneficiary', async () => {
  const result = await createInternalPeriodicMaintenanceRequest(base({
    submissionType: 'refer_a_candidate',
  }, null));
  assert.deepEqual(result, { ok: false, code: 'beneficiary_client_id_required' });
});

test('telemarketing periodic intake requires an explicit request address even for a registered device', async () => {
  const result = await createInternalPeriodicMaintenanceRequest(base({
    submissionType: 'apply',
    reasonId: 2,
    reportedDeviceSelection: 'registered_device',
    installedDeviceId: 3,
  }));
  assert.deepEqual(result, { ok: false, code: 'service_address_required' });
});

test('telemarketing periodic intake rejects overlong optional serial as a client error', async () => {
  const input = base({
    submissionType: 'apply',
    serviceAddress: { governorate: 1, detailed_address: 'Damascus' },
    reasonId: 2,
    reportedDeviceSelection: 'other',
    deviceName: 'Purifier',
    serialNumber: 'x'.repeat(101),
  });
  input.db = {
    async query(sql: string) {
      if (sql.includes('FROM system_lists')) {
        return { rows: [{ id: 2, value: 'Scheduled', metadata: { code: 'scheduled' } }] };
      }
      throw new Error('unexpected database query');
    },
  } as unknown as PoolClient;
  await assert.rejects(
    createInternalPeriodicMaintenanceRequest(input),
    (error: any) => error?.status === 400 && error?.code === 'field_too_long',
  );
});
