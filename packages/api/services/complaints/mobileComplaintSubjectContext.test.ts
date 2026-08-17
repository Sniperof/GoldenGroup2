import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicComplaintResponse } from './mobileComplaintService.js';

test('registered owner receives a visit id and safe visit snapshot fields', () => {
  const result = toPublicComplaintResponse({
    id: '91',
    publicRefNumber: 'CMP-20260817-000001',
    __fieldVisitId: '812',
    __incidentDate: '2026-08-15',
    __contextSnapshot: {
      scheduled_date: '2026-08-15',
      visit_type: 'maintenance',
      team_snapshot: { teamKey: 'team_0', supervisorEmployeeId: 77 },
    },
  }, true);

  assert.equal(result.id, 91);
  assert.deepEqual(result.subjectContext, {
    kind: 'visit',
    visitDate: '2026-08-15',
    visitType: 'maintenance',
    teamName: null,
    visitId: 812,
  });
  assert.equal('__contextSnapshot' in result, false);
  assert.equal(JSON.stringify(result).includes('supervisorEmployeeId'), false);
});

test('visitor tracking receives visit context without the internal visit id', () => {
  const result = toPublicComplaintResponse({
    id: 91,
    __fieldVisitId: 812,
    __contextSnapshot: { scheduled_date: '2026-08-15', visit_type: 'maintenance' },
  }, false);

  assert.deepEqual(result.subjectContext, {
    kind: 'visit',
    visitDate: '2026-08-15',
    visitType: 'maintenance',
    teamName: null,
  });
});

test('installed-device context exposes a customer-owned id only to the registered owner', () => {
  const row = {
    id: 92,
    __installedDeviceId: 44,
    __contextSnapshot: {
      model_name_ar: 'جهاز غولدن',
      model_name_en: 'Golden Device',
      serial_number: 'SN-90871',
      branch_id: 3,
    },
  };

  assert.deepEqual(toPublicComplaintResponse(row, true).subjectContext, {
    kind: 'installed_device',
    deviceName: 'جهاز غولدن',
    serialNumber: 'SN-90871',
    installedDeviceId: 44,
  });
  assert.deepEqual(toPublicComplaintResponse(row, false).subjectContext, {
    kind: 'installed_device',
    deviceName: 'جهاز غولدن',
    serialNumber: 'SN-90871',
  });
});

test('manual device and general complaints return stable discriminated contexts', () => {
  assert.deepEqual(toPublicComplaintResponse({
    id: 93,
    __manualDeviceNumber: 'FILTER-7',
    __lastMaintenanceDate: new Date('2026-07-10T00:00:00.000Z'),
  }, false).subjectContext, {
    kind: 'manual_device',
    deviceNumber: 'FILTER-7',
    deviceName: null,
    serialNumber: null,
    lastMaintenanceDate: '2026-07-10',
  });

  assert.deepEqual(toPublicComplaintResponse({ id: 94 }, true).subjectContext, { kind: 'general' });
});
