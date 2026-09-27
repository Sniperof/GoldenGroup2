import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fromPersisted, toPersisted, segmentOrder, matchesSaved, normalizeStationOrder, type Segment,
} from './routeSegments.ts';

const geo = [
    { id: 1, name: 'A', level: 3 }, { id: 2, name: 'B', level: 3 }, { id: 3, name: 'C', level: 3 },
    { id: 4, name: 'D', level: 3 }, { id: 5, name: 'E', level: 3 }, { id: 6, name: 'F', level: 3 },
    { id: 9, name: 'Z', level: 4 },
];
const pts = (ids: number[]) => ids.map((geoUnitId, order) => ({ geoUnitId, order, level: 3 }));
const routes = [{ id: 10, points: pts([1, 2, 3, 4]) }, { id: 20, points: pts([4, 5, 6]) }];

test('start after end on the route = reverse slice, persisted as min/max + reverse', () => {
    const segs: Segment[] = [{ kind: 'route', key: 'a', routeId: 10, startIdx: 3, endIdx: 1 }];
    assert.deepEqual(segmentOrder(segs, routes, geo), [4, 3, 2]);
    assert.deepEqual(toPersisted(segs).routes, [{ routeId: 10, startIdx: 1, endIdx: 3, direction: 'reverse' }]);
});

test('merged routes dedupe the shared station (first occurrence wins)', () => {
    const segs: Segment[] = [
        { kind: 'route', key: 'a', routeId: 10, startIdx: 0, endIdx: 3 },
        { kind: 'route', key: 'b', routeId: 20, startIdx: 0, endIdx: 2 },
    ];
    assert.deepEqual(segmentOrder(segs, routes, geo), [1, 2, 3, 4, 5, 6]);
});

test('a zone placed between segments round-trips to the same position', () => {
    const segs: Segment[] = [
        { kind: 'route', key: 'a', routeId: 10, startIdx: 0, endIdx: 1 },
        { kind: 'zone', key: 'z', zoneId: 9 },
        { kind: 'route', key: 'b', routeId: 20, startIdx: 0, endIdx: 2 },
    ];
    const order = segmentOrder(segs, routes, geo);
    const persisted = { ...toPersisted(segs), stationOrder: order };
    const rebuilt = fromPersisted(persisted, routes, geo);
    assert.equal(rebuilt.custom, null);
    assert.deepEqual(rebuilt.segments.map(s => (s.kind === 'zone' ? `z${s.zoneId}` : `r${s.routeId}`)), ['r10', 'z9', 'r20']);
    assert.equal(matchesSaved(persisted, { ...toPersisted(rebuilt.segments), order }, order), true);
});

test('a free order that breaks segment sequence comes back as custom', () => {
    const saved = {
        routes: [{ routeId: 10, startIdx: 0, endIdx: 3, direction: 'forward' }],
        extraZones: [],
        stationOrder: [2, 1, 3, 4],
    };
    const rebuilt = fromPersisted(saved, routes, geo);
    assert.deepEqual(rebuilt.custom, [2, 1, 3, 4]);
});

test('jsonb key order and list order never make a saved plan look dirty', () => {
    const saved = {
        routes: [{ endIdx: 3, routeId: 10, startIdx: 0, direction: 'forward' }] as any,
        extraZones: [9],
        stationOrder: [1, 2, 3, 4, 9],
    };
    const { segments, custom } = fromPersisted(saved, routes, geo);
    const ids = segmentOrder(segments, routes, geo);
    const order = custom ? normalizeStationOrder(custom, ids) : ids;
    assert.equal(matchesSaved(saved, { ...toPersisted(segments), order }, ids), true);
});
