import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZoneMapResponse, ZoneMapTaskItem } from '@golden-crm/shared';
import { aggregateAreas, aggregateRoutes, GeoIndex, routeContainsArea, type ZoneMapFilters } from './zoneMapAggregate.js';

// ناحية 10 (with أحياء 11, 12), ناحية 20 (حي 21).
const areas: ZoneMapResponse['areas'] = [
  { geoUnitId: 1, name: 'دمشق', level: 2, parentId: null, inBranchCoverage: true, center: null },
  { geoUnitId: 10, name: 'المزة', level: 3, parentId: 1, inBranchCoverage: true, center: { lat: 33.5, lng: 36.25 } },
  { geoUnitId: 11, name: 'المزة 86', level: 4, parentId: 10, inBranchCoverage: true, center: null },
  { geoUnitId: 12, name: 'فيلات غربية', level: 4, parentId: 10, inBranchCoverage: true, center: null },
  { geoUnitId: 20, name: 'القصاع', level: 3, parentId: 1, inBranchCoverage: true, center: null },
  { geoUnitId: 21, name: 'باب توما', level: 4, parentId: 20, inBranchCoverage: true, center: null },
];

let nextId = 1;
function task(p: Partial<ZoneMapTaskItem> & Pick<ZoneMapTaskItem, 'clientId' | 'column' | 'geoUnitId'>): ZoneMapTaskItem {
  return {
    taskId: nextId++, taskType: p.column, taskLabel: p.column, clientName: `c${p.clientId}`,
    deviceId: null, deviceLabel: null, countsBy: 'client', ownerHrUserIds: [], overdue: false, ...p,
  };
}

const tasks: ZoneMapTaskItem[] = [
  // Client 1 in حي 11: emergency + collection → ONE visit, shared.
  task({ clientId: 1, column: 'emergency', geoUnitId: 11, countsBy: 'device', deviceId: 100 }),
  task({ clientId: 1, column: 'collection', geoUnitId: 11 }),
  // Client 1 also has a device in القصاع → a second, separate visit.
  task({ clientId: 1, column: 'emergency', geoUnitId: 21, countsBy: 'device', deviceId: 101 }),
  // Client 2 in حي 12: two devices with periodic → 1 visit, 2 devices.
  task({ clientId: 2, column: 'periodic', geoUnitId: 12, countsBy: 'device', deviceId: 200 }),
  task({ clientId: 2, column: 'periodic', geoUnitId: 12, countsBy: 'device', deviceId: 201 }),
  // Demos: branch-owned (client 3), Raneem's (7), Abeer's (8).
  task({ clientId: 3, column: 'demo', geoUnitId: 10 }),
  task({ clientId: 4, column: 'demo', geoUnitId: 11, ownerHrUserIds: [7] }),
  task({ clientId: 5, column: 'demo', geoUnitId: 21, ownerHrUserIds: [8] }),
  // No known area.
  task({ clientId: 6, column: 'collection', geoUnitId: null }),
];

const data: ZoneMapResponse = {
  date: '2026-10-28', branchId: 1, coveredGeoUnitIds: [1], areas,
  routes: [{ id: 5, name: 'خط المزة', stationGeoUnitIds: [10] }, { id: 6, name: 'خط باب توما', stationGeoUnitIds: [21] }],
  owners: [{ hrUserId: 7, name: 'رنيم', roleName: null, slotType: 'SUPERVISOR' }, { hrUserId: 8, name: 'عبير', roleName: null, slotType: 'SUPERVISOR' }],
  tasks,
  requests: [{ requestId: 1, requestType: 'water_check', column: 'request_water_check', refNumber: 'R1', clientId: null, clientName: null, geoUnitId: 12 }],
};
const geo = new GeoIndex(areas);
const everything: ZoneMapFilters = {
  columns: new Set(['emergency', 'collection', 'periodic', 'demo', 'request_water_check']),
  demoBranch: true,
  demoOwnerIds: new Set([7, 8]),
};
const row = (rows: ReturnType<typeof aggregateAreas>, id: number | null) => rows.find(r => r.geoUnitId === id)!;

test('a client with several task types at one place is one visit; types count separately', () => {
  const mezzeh = row(aggregateAreas(data, geo, everything, 3), 10);
  // Visits in المزة: client1@11, client2@12, client3@10, client4@11.
  assert.equal(mezzeh.visitCount, 4);
  assert.equal(mezzeh.sharedVisitCount, 1);
  assert.equal(mezzeh.columnCounts.emergency, 1);
  assert.equal(mezzeh.columnCounts.collection, 1);
  // Device-bound type counts devices, not clients.
  assert.equal(mezzeh.columnCounts.periodic, 2);
  assert.equal(mezzeh.columnCounts.request_water_check, 1);
  assert.equal(mezzeh.requests.length, 1);
});

test('the same client at two work locations is two visits in two areas', () => {
  const rows = aggregateAreas(data, geo, everything, 3);
  assert.equal(row(rows, 20).visitCount, 2); // client1@21 + client5@21
  assert.equal(row(rows, null).visitCount, 1); // no-area row keeps the collection
});

test('grouping by حي splits a ناحية; a ناحية-level location stays on the ناحية', () => {
  const rows = aggregateAreas(data, geo, everything, 4);
  assert.equal(row(rows, 11).visitCount, 2);
  assert.equal(row(rows, 12).visitCount, 1);
  assert.equal(row(rows, 10).visitCount, 1); // client3 recorded on the ناحية itself
});

test('demo owner filter: branch demos and per-owner demos are separate', () => {
  const mezzeh = row(aggregateAreas(data, geo, everything, 3), 10);
  assert.equal(mezzeh.demoBranchCount, 1);
  assert.deepEqual(mezzeh.demoByOwner, { 7: 1 });

  const raneemOnly: ZoneMapFilters = { columns: new Set(['demo']), demoBranch: false, demoOwnerIds: new Set([7]) };
  const rows = aggregateAreas(data, geo, raneemOnly, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].geoUnitId, 10);
  assert.equal(rows[0].visitCount, 1);
});

test('route stations cover their sub-areas; route totals dedupe visits', () => {
  const [mezzehRoute, babTouma] = aggregateRoutes(data, geo, everything);
  assert.equal(mezzehRoute.total.visitCount, 4);
  assert.equal(babTouma.total.visitCount, 2);
  assert.equal(routeContainsArea([10], 12, geo), true); // حي inside the station ناحية
  assert.equal(routeContainsArea([11], 10, geo), true); // station حي inside the searched ناحية
  assert.equal(routeContainsArea([21], 10, geo), false);
});
