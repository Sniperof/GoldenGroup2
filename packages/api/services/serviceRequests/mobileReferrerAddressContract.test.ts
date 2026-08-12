import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { validateDeviceRequestForm } from './deviceRequestFormSchema.js';
import { validateEmergencyMaintenanceForm } from './emergencyMaintenanceFormSchema.js';
import { validateGoldenWarrantyForm } from './goldenWarrantyFormSchema.js';
import { resolveMobileReferrerAddress } from './mobileWaterCheckIntake.js';
import { validatePeriodicMaintenanceForm } from './periodicMaintenanceFormSchema.js';
import { validateWaterCheckForm } from './waterCheckFormSchema.js';

const mediatorAddress = {
  referrerGovernorate: 1,
  referrerCityOrArea: 2,
  referrerSubArea: 3,
  referrerNeighborhood: 4,
  referrerDetailedAddress: 'Building 12',
  referrerMapLocation: { lat: 33.5138, lng: 36.2765 },
};

function geoDb(rows = [
  { id: 1, name: 'Damascus', level: 1, parent_id: null, status: 'active' },
  { id: 2, name: 'Central area', level: 2, parent_id: 1, status: 'active' },
  { id: 3, name: 'Central sub-area', level: 3, parent_id: 2, status: 'active' },
  { id: 4, name: 'Neighborhood', level: 4, parent_id: 3, status: 'active' },
]) {
  return { query: async () => ({ rows }) } as unknown as PoolClient;
}

test('every mediator-capable mobile form declares the mediator address fields', () => {
  const validators = [
    ['water_check', validateWaterCheckForm],
    ['emergency_maintenance', validateEmergencyMaintenanceForm],
    ['periodic_maintenance', validatePeriodicMaintenanceForm],
    ['device_request', validateDeviceRequestForm],
  ] as const;

  for (const [requestType, validate] of validators) {
    assert.equal(validate(mediatorAddress).ok, true, requestType);
  }
  assert.equal(validateGoldenWarrantyForm(mediatorAddress).ok, false, 'golden_warranty keeps mediator deferred');
});

test('mediator governorate, area, and sub-area are required together', async () => {
  await assert.rejects(
    resolveMobileReferrerAddress({ referrerGovernorate: 1 }, geoDb()),
    (error: unknown) => {
      const typed = error as Error & { status?: number; details?: { code?: string; fields?: string[] } };
      assert.equal(typed.status, 400);
      assert.equal(typed.details?.code, 'missing_referrer_address_fields');
      assert.deepEqual(typed.details?.fields, ['referrerCityOrArea', 'referrerSubArea']);
      return true;
    },
  );
});

test('mediator address is SmartGeo-validated and stored as a stable flattened snapshot', async () => {
  const address = await resolveMobileReferrerAddress(mediatorAddress, geoDb());

  assert.deepEqual(address, {
    governorate: 1,
    city_or_area: 2,
    sub_area: 3,
    neighborhood: 4,
    geo_unit_id: 4,
    detailed_address: 'Building 12',
    location: { lat: 33.5138, lng: 36.2765 },
    labels: {
      governorate: 'Damascus',
      city_or_area: 'Central area',
      sub_area: 'Central sub-area',
      neighborhood: 'Neighborhood',
    },
    governorateId: 1,
    regionId: 2,
    subdistrictId: 3,
    neighborhoodId: 4,
    detailedAddress: 'Building 12',
    mapLocation: { lat: 33.5138, lng: 36.2765 },
    addressRole: 'referrer',
  });
});

test('mediator neighborhood, detailed address, and location remain optional', async () => {
  const address = await resolveMobileReferrerAddress({
    referrerGovernorate: 1,
    referrerCityOrArea: 2,
    referrerSubArea: 3,
  }, geoDb());

  assert.equal(address.neighborhoodId, null);
  assert.equal(address.detailedAddress, '');
  assert.equal(address.mapLocation, null);
  assert.equal(address.geo_unit_id, 3);
});

test('mediator address rejects a non-contiguous SmartGeo hierarchy', async () => {
  const rows = [
    { id: 1, name: 'Damascus', level: 1, parent_id: null, status: 'active' },
    { id: 2, name: 'Central area', level: 2, parent_id: 1, status: 'active' },
    { id: 3, name: 'Wrong sub-area', level: 3, parent_id: 999, status: 'active' },
  ];

  await assert.rejects(
    resolveMobileReferrerAddress({
      referrerGovernorate: 1,
      referrerCityOrArea: 2,
      referrerSubArea: 3,
    }, geoDb(rows)),
    (error: unknown) => (error as Error & { status?: number }).status === 400,
  );
});
