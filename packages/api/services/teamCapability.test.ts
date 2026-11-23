import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTeamCapability, type CapabilityFacts } from './teamCapability.js';

type Row = Partial<CapabilityFacts> & { id: number; clientId: number; taskType: string };
const facts = (r: Row): CapabilityFacts => ({
  clientId: r.clientId,
  zoneId: r.zoneId ?? 100,
  taskType: r.taskType,
  committedToTeam: r.committedToTeam ?? false,
  excluded: r.excluded ?? false,
});
const ids = (rows: Row[]) => rows.map(r => r.id);

const COLLECTION = ['installment_collection', 'gift_delivery'];
const STANDARD = ['installment_collection', 'gift_delivery', 'periodic_maintenance', 'device_demo', 'emergency_maintenance'];
const EMERGENCY = ['emergency_maintenance'];

test('D6: a team takes a grain only when it can do every task in it', () => {
  const rows: Row[] = [
    { id: 1, clientId: 7, taskType: 'installment_collection' },              // Ahmad: clean
    { id: 2, clientId: 8, taskType: 'installment_collection' },              // Omar: mixed
    { id: 3, clientId: 8, taskType: 'periodic_maintenance' },
  ];
  const collection = applyTeamCapability(rows, COLLECTION, facts);
  assert.deepEqual(ids(collection.kept), [1]);
  assert.deepEqual(collection.blockedGrains, [{ clientId: 8, zoneId: 100, blockingTaskTypes: ['periodic_maintenance'] }]);

  const standard = applyTeamCapability(rows, STANDARD, facts);
  assert.deepEqual(ids(standard.kept), [1, 2, 3]);
  assert.deepEqual(standard.blockedGrains, []);
});

test('the grain is per location: the same client elsewhere is a separate grain', () => {
  const rows: Row[] = [
    { id: 1, clientId: 8, zoneId: 100, taskType: 'installment_collection' },
    { id: 2, clientId: 8, zoneId: 200, taskType: 'periodic_maintenance' },
  ];
  assert.deepEqual(ids(applyTeamCapability(rows, COLLECTION, facts).kept), [1]);
});

test('D7: emergency maintenance neither blocks nor is blocked', () => {
  const rows: Row[] = [
    { id: 1, clientId: 9, taskType: 'installment_collection' },
    { id: 2, clientId: 9, taskType: 'emergency_maintenance' },
  ];
  // Collection team keeps its collection; the emergency task does not block it.
  assert.deepEqual(ids(applyTeamCapability(rows, COLLECTION, facts).kept), [1]);
  // Emergency team takes the emergency task alone; the collection is not its business
  // and is not reported as a lost grain.
  const emergency = applyTeamCapability(rows, EMERGENCY, facts);
  assert.deepEqual(ids(emergency.kept), [2]);
  assert.deepEqual(emergency.blockedGrains, []);
});

test('emergency team behaves as before: only emergency maintenance', () => {
  const rows: Row[] = [
    { id: 1, clientId: 1, taskType: 'device_demo' },
    { id: 2, clientId: 2, taskType: 'emergency_maintenance' },
    { id: 3, clientId: 2, taskType: 'periodic_maintenance' },
  ];
  assert.deepEqual(ids(applyTeamCapability(rows, EMERGENCY, facts).kept), [2]);
});

test('excluded tasks never block; committed tasks are always kept', () => {
  const rows: Row[] = [
    { id: 1, clientId: 8, taskType: 'installment_collection' },
    { id: 2, clientId: 8, taskType: 'periodic_maintenance', excluded: true },
    { id: 3, clientId: 5, taskType: 'device_demo', committedToTeam: true },
  ];
  assert.deepEqual(ids(applyTeamCapability(rows, COLLECTION, facts).kept), [1, 3]);
});
