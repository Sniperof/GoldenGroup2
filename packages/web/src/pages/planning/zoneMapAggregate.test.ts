import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZoneMapResponse, ZoneMapTaskItem } from '@golden-crm/shared';
import { aggregateAreas, aggregateRoutes, GeoIndex, listTasks, routeContainsArea, type ZoneMapFilters } from './zoneMapAggregate.js';

// ناحية 10 (with أحياء 11, 12), ناحية 20 (حي 21), ناحية 30 (no أحياء → a leaf itself).
const areas: ZoneMapResponse['areas'] = [
  { geoUnitId: 1, name: 'دمشق', level: 2, parentId: null, hasChildren: true, inBranchCoverage: true, center: null },
  { geoUnitId: 10, name: 'المزة', level: 3, parentId: 1, hasChildren: true, inBranchCoverage: true, center: { lat: 33.5, lng: 36.25 } },
  { geoUnitId: 11, name: 'المزة 86', level: 4, parentId: 10, hasChildren: false, inBranchCoverage: true, center: null },
  { geoUnitId: 12, name: 'فيلات غربية', level: 4, parentId: 10, hasChildren: false, inBranchCoverage: true, center: null },
  { geoUnitId: 20, name: 'القصاع', level: 3, parentId: 1, hasChildren: true, inBranchCoverage: true, center: null },
  { geoUnitId: 21, name: 'باب توما', level: 4, parentId: 20, hasChildren: false, inBranchCoverage: true, center: null },
  { geoUnitId: 30, name: 'دمر', level: 3, parentId: 1, hasChildren: false, inBranchCoverage: true, center: null },
];

let nextId = 1;
function task(p: Partial<ZoneMapTaskItem> & Pick<ZoneMapTaskItem, 'clientId' | 'column' | 'geoUnitId'>): ZoneMapTaskItem {
  return {
    taskId: nextId++, taskType: p.column, taskLabel: p.column, clientName: `c${p.clientId}`,
    deviceId: null, deviceLabel: null, countsBy: 'client', ownerHrUserIds: [], overdue: false,
    status: 'open', dueDate: null, followUpDate: null, attemptCount: 0, expectedAmount: null, ...p,
  };
}

const tasks: ZoneMapTaskItem[] = [
  // Client 1 in حي 11: emergency + collection → ONE visit, shared.
  task({ clientId: 1, column: 'emergency', geoUnitId: 11, countsBy: 'device', deviceId: 100 }),
  task({ clientId: 1, column: 'collection', geoUnitId: 11 }),
  // Client 1 also has a device in باب توما → a second, separate visit.
  task({ clientId: 1, column: 'emergency', geoUnitId: 21, countsBy: 'device', deviceId: 101 }),
  // Client 2 in حي 12: two devices with periodic → 1 visit, 2 devices.
  task({ clientId: 2, column: 'periodic', geoUnitId: 12, countsBy: 'device', deviceId: 200 }),
  task({ clientId: 2, column: 'periodic', geoUnitId: 12, countsBy: 'device', deviceId: 201 }),
  // Demos: branch-owned (client 3, on ناحية 10 without its حي), Raneem's (7), Abeer's (8).
  task({ clientId: 3, column: 'demo', geoUnitId: 10 }),
  task({ clientId: 4, column: 'demo', geoUnitId: 11, ownerHrUserIds: [7] }),
  task({ clientId: 5, column: 'demo', geoUnitId: 21, ownerHrUserIds: [8] }),
  // A ناحية without أحياء is itself the lowest level.
  task({ clientId: 7, column: 'gift', geoUnitId: 30 }),
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
  columns: new Set(['emergency', 'collection', 'periodic', 'demo', 'gift', 'request_water_check']),
  branchOwned: true,
  ownerIds: new Set([7, 8]),
};
const row = (rows: ReturnType<typeof aggregateAreas>, id: number | null) => rows.find(r => r.geoUnitId === id)!;

test('a client with several task types at one place is one visit; types count separately', () => {
  const h11 = row(aggregateAreas(data, geo, everything), 11);
  // Visits in حي 11: client1 (emergency + collection), client4 (demo).
  assert.equal(h11.visitCount, 2);
  assert.equal(h11.sharedVisitCount, 1);
  assert.equal(h11.columnCounts.emergency, 1);
  assert.equal(h11.columnCounts.collection, 1);
  // Device-bound type counts devices, not clients.
  const h12 = row(aggregateAreas(data, geo, everything), 12);
  assert.equal(h12.visitCount, 1);
  assert.equal(h12.columnCounts.periodic, 2);
  assert.equal(h12.columnCounts.request_water_check, 1);
});

test('rows are the lowest level: أحياء, and a ناحية only when it has no أحياء', () => {
  const rows = aggregateAreas(data, geo, everything);
  assert.deepEqual(rows.map(r => r.geoUnitId).sort((a, b) => (a ?? -1) - (b ?? -1)), [null, 11, 12, 21, 30]);
  assert.equal(row(rows, 30).visitCount, 1);
  // A حي reads with its ناحية; a leaf ناحية by its own name.
  assert.equal(row(rows, 11).name, 'المزة 86 (المزة)');
  assert.equal(row(rows, 30).name, 'دمر');
});

test('work on a ناحية that has أحياء is an incomplete address → the no-area row', () => {
  const rows = aggregateAreas(data, geo, everything);
  const none = row(rows, null);
  // client6 (no address) + client3 (ناحية 10 without its حي).
  assert.equal(none.visitCount, 2);
  assert.ok(none.visits.some(v => v.clientId === 3 && v.geoUnitId === 10));
  assert.equal(rows.some(r => r.geoUnitId === 10), false);
});

test('the same client at two work locations is two visits in two areas', () => {
  const rows = aggregateAreas(data, geo, everything);
  assert.equal(row(rows, 21).visitCount, 2); // client1@21 + client5@21
  assert.ok(row(rows, 11).visits.some(v => v.clientId === 1));
});

test('demo owner filter: branch demos and per-owner demos are separate', () => {
  const h11 = row(aggregateAreas(data, geo, everything), 11);
  assert.equal(h11.demoBranchCount, 0);
  assert.deepEqual(h11.demoByOwner, { 7: 1 });
  assert.equal(row(aggregateAreas(data, geo, everything), null).demoBranchCount, 1);

  const raneemOnly: ZoneMapFilters = { columns: new Set(['demo']), branchOwned: false, ownerIds: new Set([7]) };
  const rows = aggregateAreas(data, geo, raneemOnly);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].geoUnitId, 11);
  assert.equal(rows[0].visitCount, 1);
});

test('route stations match literally: a ناحية station does not pull its أحياء', () => {
  const [mezzehRoute, babTouma] = aggregateRoutes(data, geo, everything);
  // Station 10 (ناحية المزة) serves only work recorded on 10 itself: client3's demo.
  // The visits in أحياء 11 and 12 are NOT on this route.
  assert.equal(mezzehRoute.total.visitCount, 1);
  assert.equal(mezzehRoute.total.requests.length, 0);
  assert.equal(babTouma.total.visitCount, 2); // station 21 = client1@21 + client5@21
  assert.equal(babTouma.stations[0].name, 'باب توما (القصاع)');
  assert.equal(routeContainsArea([10], 10, geo), true);
  assert.equal(routeContainsArea([11], 10, geo), true); // station حي inside the searched ناحية
  assert.equal(routeContainsArea([10], 12, geo), false); // ناحية station doesn't pass through its حي
  assert.equal(routeContainsArea([21], 10, geo), false);
});

test('ownership: every non-demo task belongs to the branch', () => {
  const ownersOnly: ZoneMapFilters = { columns: everything.columns, branchOwned: false, ownerIds: new Set([7, 8]) };
  const rows = aggregateAreas(data, geo, ownersOnly);
  // Only the two employee-owned demos remain (client4@11, client5@21).
  assert.deepEqual(rows.flatMap(r => r.visits.map(v => v.clientId)).sort(), [4, 5]);
});

test('task list: branch priority first, then the longest overdue', () => {
  const late: ZoneMapResponse = {
    ...data,
    tasks: [
      task({ clientId: 20, column: 'demo', geoUnitId: 11 }),
      task({ clientId: 21, column: 'collection', geoUnitId: 30, dueDate: '2026-10-20' }),
      task({ clientId: 22, column: 'collection', geoUnitId: 30, dueDate: '2026-10-01' }),
      task({ clientId: 23, column: 'gift', geoUnitId: 21 }),
      task({ clientId: 24, column: 'emergency', geoUnitId: 21 }),
      // Follow-up tasks are late against their follow-up date.
      task({ clientId: 25, column: 'collection', geoUnitId: 10, status: 'needs_follow_up', dueDate: '2026-01-01', followUpDate: '2026-10-27' }),
    ],
  };
  const rows = listTasks(late, geo, everything);
  assert.deepEqual(rows.map(r => r.task.clientId), [22, 21, 25, 24, 20, 23]);
  assert.equal(rows[0].daysLate, 27);
  assert.equal(rows[2].daysLate, 1);
  assert.equal(rows[2].station, 'بدون منطقة'); // ناحية with أحياء → incomplete address
  assert.deepEqual(rows[3].routeNames, ['خط باب توما']);
  // Picking a route keeps only the tasks on its stations.
  assert.deepEqual(listTasks(late, geo, everything, [21]).map(r => r.task.clientId), [24, 23]);
});
