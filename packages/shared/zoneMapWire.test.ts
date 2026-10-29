import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZoneMapResponse } from './types.js';
import { fromZoneMapWire, toZoneMapWire } from './zoneMapWire.js';

const data: ZoneMapResponse = {
    date: '2026-10-30', branchId: 1002, coveredGeoUnitIds: [1],
    areas: [{ geoUnitId: 11, name: 'حي', level: 4, parentId: 10, hasChildren: false, inBranchCoverage: true, center: { lat: 35.1, lng: 35.9 } }],
    routes: [{ id: 5, name: 'خط', stationGeoUnitIds: [11] }],
    owners: [{ hrUserId: 7, name: 'رنيم', roleName: 'مشرفة', slotType: 'SUPERVISOR' }],
    requests: [],
    tasks: [
        {
            taskId: 1, taskType: 'periodic_maintenance', taskLabel: 'صيانة دورية', column: 'periodic', countsBy: 'device',
            clientId: 3, clientName: 'زبون', geoUnitId: 11, deviceId: 9, deviceLabel: 'SN-1', status: 'open',
            dueDate: '2026-10-01', followUpDate: null, attemptCount: 2, expectedAmount: null, ownerHrUserIds: [], overdue: true,
        },
        {
            taskId: 2, taskType: 'device_demo', taskLabel: 'عرض جهاز', column: 'demo', countsBy: 'client',
            clientId: 4, clientName: 'زبون 2', geoUnitId: null, deviceId: null, deviceLabel: null, status: 'needs_follow_up',
            dueDate: null, followUpDate: '2026-10-31', attemptCount: 0, expectedAmount: 15000, ownerHrUserIds: [7], overdue: false,
        },
    ],
};

test('zone map wire format round-trips every field', () => {
    const wire = toZoneMapWire(data);
    assert.equal(wire.taskTypes.length, 2);
    assert.deepEqual(wire.statuses, ['open', 'needs_follow_up']);
    // Survives JSON like the real response.
    assert.deepEqual(fromZoneMapWire(JSON.parse(JSON.stringify(wire))), data);
});

test('wire format is much smaller than plain objects', () => {
    const many: ZoneMapResponse = { ...data, tasks: Array.from({ length: 2000 }, (_, i) => ({ ...data.tasks[i % 2], taskId: i })) };
    const plain = JSON.stringify(many).length;
    const wire = JSON.stringify(toZoneMapWire(many)).length;
    assert.ok(wire < plain * 0.6, `wire ${wire} vs plain ${plain}`);
});
